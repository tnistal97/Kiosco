# Circuito de compra

## El recorrido

```
Proveedor
  → Orden de compra          (qué se pide, a quién, a cuánto)
    → Recepción              (qué llegó de verdad, cuándo, a cuánto)
      → StockMovement        PURCHASE_RECEIPT, delta positivo
      → BranchStock          saldo actualizado
      → Product.cost         último costo recibido
      → ProductCostHistory   fila inmutable con el antes y el después
      → AuditLog             quién lo hizo
```

Cada flecha ocurre **dentro de la misma transacción** que la anterior. Si falla
el séptimo producto de diez, no queda recibido ninguno.

## Orden y recepción son dos cosas distintas

Es la decisión que estructura todo el módulo, y conviene decir por qué.

Una orden dice **lo que se pidió**. Una recepción dice **lo que llegó**. Casi
nunca son lo mismo: el proveedor manda 3 cajas el lunes y 2 el miércoles, o
manda 4 y avisa que las otras no las consigue, o factura a $1.050 lo que había
cotizado a $1.000.

Si las recepciones vivieran dentro de la orden --un campo `receivedQuantity` y
nada más-- el sistema podría decir cuánto llegó pero no **cuándo llegó cada
parte, ni a qué precio, ni quién lo recibió**. Y esa es justamente la
información que se busca cuando algo no cierra.

```
PurchaseOrder      OC-00000042 · Distribuidora X · 5 cajas · $8.800 c/u
  PurchaseReceipt  08/08 · Ana  · 3 cajas · $8.800 → +24 UNIT
  PurchaseReceipt  10/08 · Beto · 2 cajas · $8.900 → +16 UNIT  ⚠ $100 más
```

## Estados

```
DRAFT ──confirmar──→ ORDERED ──recibir parcial──→ PARTIALLY_RECEIVED
  │                     │                              │
  │                     │        ┌─────recibir el resto┘
  │                     │        ↓
  │                     └──→ RECEIVED
  │                     │
  └──cancelar──→ CANCELLED ←──cancelar──┘
```

| Estado               | Qué se puede hacer                                                    |
| -------------------- | --------------------------------------------------------------------- |
| `DRAFT`              | Todo: agregar y quitar líneas, cambiar cantidades, costos y proveedor |
| `ORDERED`            | Recibir. Las modificaciones quedan auditadas                          |
| `PARTIALLY_RECEIVED` | Recibir el resto. Ya **no** se cambia de proveedor                    |
| `RECEIVED`           | Nada destructivo. Se consulta                                         |
| `CANCELLED`          | Nada. Se conserva                                                     |

**El navegador nunca elige el estado.** Lo recalcula el servidor después de
cada recepción, comparando lo pedido con lo recibido línea por línea:

```
ninguna línea con recibido > 0        → ORDERED
alguna recibida, alguna pendiente      → PARTIALLY_RECEIVED
todas con recibido == pedido           → RECEIVED
```

### Por qué una orden parcialmente recibida se puede cancelar

Porque es lo que pasa en la realidad: llegaron 3 de 5 cajas y el proveedor
avisa que las otras 2 no las consigue. Cancelar significa **"el resto no va a
llegar"**, no "esto nunca pasó".

Lo ya recibido **no se revierte**. Las recepciones quedan, el stock queda, los
costos quedan, el historial queda. Revertir sería inventar una devolución que
no ocurrió, y la mercadería está en el depósito.

## Número de orden

```
OC-00000042
```

Lo genera el servidor con una **secuencia de PostgreSQL**, no con
`count() + 1`. La diferencia importa: dos usuarios creando una orden en el
mismo segundo leerían el mismo `count()` y pedirían el mismo número; el índice
único rechazaría a uno de los dos y esa persona vería un error que no
provocó.

`nextval()` es atómico y **no bloquea**: no espera a que la otra transacción
confirme. Un contador en una tabla, que sería la otra opción, obliga a cada
alta a esperar el `COMMIT` de la anterior.

**La secuencia deja huecos** y está bien. Una orden que se empieza y se
descarta se lleva su número. Un número de orden es una etiqueta para poder
decir "la 42" por teléfono, no un contador de cuántas compras se hicieron —
para eso está `COUNT(*)`, que es exacto.

El número es único en todo el sistema, no por sucursal. Con numeración por
sucursal existirían dos "OC-00000042" y habría que aclarar cuál cada vez que
se la nombra.

## Unidad de compra → unidad de stock

Es la conversión que da sentido al módulo, y vive en **un solo lugar**:
[`src/modules/purchases/conversion.ts`](../src/modules/purchases/conversion.ts).
Ni un componente ni una ruta la hacen a mano.

```
Coca Cola 2,25 L
  saleUnit             UNIT
  purchaseUnit         BOX
  unitsPerPurchaseUnit 8
```

| Se pide | Llega | Entra al stock |
| ------- | ----- | -------------- |
| 5 BOX   | 3 BOX | **24 UNIT**    |
|         | 2 BOX | **16 UNIT**    |

```
stockQuantity = receivedQuantity × unitsPerPurchaseUnit
```

Cuando las dos unidades coinciden, el factor es 1 y la conversión es la
identidad:

```
Queso cremoso
  saleUnit KG · purchaseUnit KG · unitsPerPurchaseUnit 1

  12,500 KG pedidos → 12,500 KG recibidos → +12,500 KG de stock
```

### La conversión puede dar una cantidad imposible

```
purchaseUnit PACK · unitsPerPurchaseUnit 2,5 · saleUnit UNIT
3 PACK × 2,5 = 7,5 UNIT
```

Media unidad no existe. **Se rechaza al confirmar la orden**, no al recibir:
descubrirlo con el camión en la puerta no le sirve a nadie. El mensaje nombra
los tres números para que se vea de dónde sale el problema.

## Costo: `unitCost` es por unidad de compra

```
1 caja de 8 Coca Cola = $8.800
unitCost = 8800          ← por CAJA
```

y el costo que llega al producto es

```
stockUnitCost = unitCost ÷ unitsPerPurchaseUnit = 8800 ÷ 8 = 1100
```

`Product.cost` queda en **$1.100**, no en $8.800. Guardar el costo de la caja
como costo del producto daría un margen negativo del 700 % en una botella que
se vende a $1.500.

Los dos números se guardan, y por eso `PurchaseReceiptItem` tiene `unitCost` y
`stockUnitCost`: el primero es lo que dice la factura, el segundo es lo que
alimenta el margen. Derivar el segundo al leer obligaría a conocer el
`unitsPerPurchaseUnit` **del día de la recepción**, que puede haber cambiado.

### La división no siempre es exacta

```
$1.000 la caja ÷ 3 unidades = $333,3333
```

Se redondea a **cuatro decimales**, que es la escala de la columna, y por eso
la escala es 4: reconstruir la caja da $999,9999 en vez de $1.000. Con dos
decimales el error sería de un centavo por unidad; con cuatro es de una
diezmilésima. La alternativa --guardar la fracción exacta-- exigiría un tipo
racional que PostgreSQL no tiene.

## Totales: el servidor es la única fuente

```
subtotal = orderedQuantity × unitCost      por línea
total    = SUM(subtotal)                   la orden
```

**No se aceptan `subtotal` ni `total` del cliente.** El navegador los calcula
para mostrarlos mientras se tipea; el servidor los recalcula y guarda los
suyos. Es la misma regla que rige el total de una venta desde la Fase 0, y por
el mismo motivo: lo que llega por la red lo escribe cualquiera.

Todo en `Decimal`. La suma de cinco subtotales en punto flotante no da el
total, y una orden que no cuadra consigo misma no se puede cotejar contra una
factura.

## Permisos

| Permiso             | dueño | admin | encargado | compras | auditor |
| ------------------- | ----- | ----- | --------- | ------- | ------- |
| `purchases.view`    | ✓     | ✓     | ✓         | ✓       | ✓       |
| `purchases.create`  | ✓     | ✓     | ✓         | ✓       |         |
| `purchases.update`  | ✓     | ✓     | ✓         | ✓       |         |
| `purchases.receive` | ✓     | ✓     | ✓         | ✓       |         |
| `purchases.cancel`  | ✓     | ✓     | ✓         | ✓       |         |

Cajero, repositor y supervisor no entran al módulo.

**El repositor no recibe mercadería**, y es la decisión menos obvia de la
tabla. Recibir cambia el costo del producto, que es información financiera; el
repositor no tiene `products.cost.view` justamente para no verla. Darle
`purchases.receive` le permitiría fijarla sin poder leerla, que es lo peor de
los dos mundos. El día que el almacén quiera que el repositor descargue el
camión, lo que hace falta es una recepción "a ciegas" que no toque el costo, y
eso es una función nueva, no un permiso más.

### No existe `purchases.cost.override`

Se evaluó y **se descartó**. Cambiar el costo al recibir ya exige
`products.cost.update`, y quien tiene ese permiso puede cambiar el costo desde
la ficha del producto de todos modos. Un tercer permiso que sólo sirve
acompañado del segundo no impide nada: sería una puerta con cerradura al lado
de una pared abierta.

La separación útil es la que ya existe: **`purchases.receive` sin
`products.cost.update` recibe al costo pedido y no puede tocarlo.**

## Lo que este circuito NO hace todavía

No hay deuda con proveedores, ni pagos, ni cuenta corriente. Una orden
recibida no genera un saldo a pagar: genera stock y costo.

No hay lotes ni vencimientos. No hay devolución a proveedor — el punto de
extensión está descrito en [PURCHASE_RECEIVING.md](PURCHASE_RECEIVING.md).

No hay promedio ponderado ni FIFO. La política de costo es **la última
recepción**, y está explicada donde se aplica.
