# Devoluciones a proveedor: el circuito

## Qué es una devolución acá

Un **hecho físico** con consecuencias financieras: sale mercadería del depósito y
vuelve al proveedor, que nos acredita lo que nos había cobrado por ella.

Por eso es una entidad con renglones y no un movimiento del libro. Hay que poder
decir qué producto volvió, cuánto y a qué costo, y eso no entra en una fila de
`SupplierAccountMovement`.

## Lo que NO es

Una **corrección financiera sin mercadería** —una diferencia de facturación, un
descuento pactado después, un faltante que el proveedor reconoce— ya tiene su
camino desde la Fase 4B y se llama **nota de crédito**.

La separación es limpia y conviene tenerla presente:

|                 | Mueve stock | Mueve saldo | Referencia                            |
| --------------- | ----------- | ----------- | ------------------------------------- |
| Devolución      | Sí          | Sí          | Siempre una entrega concreta          |
| Nota de crédito | No          | Sí          | Ninguna, o un documento del proveedor |

## Siempre apunta a una entrega

`PurchaseReturn.purchaseReceiptId` **no es opcional**, y cada renglón apunta a un
`PurchaseReceiptItem`.

No es una limitación: es la definición. Devolver es deshacer parte de una entrega
concreta, y de esa entrega salen las tres cosas que no se pueden inventar:

1. **el costo con el que entró** —lo que el proveedor acredita—;
2. **cuánto entró** —el tope de lo que puede volver—;
3. **en qué unidad** —"2 cajas" son 16 unidades si la caja trae 8—.

Sin la referencia, las tres habría que preguntárselas a alguien, y las tres
terminarían saliendo de `Product.cost`, que es el costo de **hoy**.

## Los tres estados

```
DRAFT  ──confirmar──▶  CONFIRMED
  │
  └────cancelar────▶  CANCELLED
```

**DRAFT no mueve nada.** Ni stock ni saldo. Es un papel que se está armando, y
por eso dos borradores pueden pedir la misma mercadería sin chocar: el tope de lo
retornable se consume al **confirmar**, que es cuando la mercadería sale.

Reservarlo en el borrador obligaría a liberar reservas abandonadas —un problema
entero— para resolver algo que no ocurre: entre armar una devolución y
confirmarla pasan minutos.

**CONFIRMED es inmutable**, con disparador en la base. Es la primera
inmutabilidad _condicional_ del sistema: la regla se lee en una línea —se puede
escribir sobre una fila mientras su estado sea `DRAFT`— y la transición
`DRAFT → CONFIRMED` pasa porque se mira el estado **viejo**.

**CANCELLED solo se alcanza desde DRAFT.** Una devolución confirmada no se
cancela: la mercadería ya volvió y el crédito ya está en la cuenta del proveedor.
Si el proveedor la devuelve, eso es una entrega nueva —con su recepción, su costo
y su cargo— y no un botón que borra la anterior.

## Los dos topes, y por qué hacen falta los dos

```
1. lo recibido menos lo ya devuelto   (histórico)
2. el stock que hay hoy                (físico)
```

El ejemplo que da sentido al segundo: se recibieron 10, se vendieron 8, quedan 2.
El proveedor pide 5 de vuelta. **Se rechaza**, aunque históricamente hayan
entrado 10: esas unidades ya no están.

Los dos se muestran en pantalla por separado, porque son dos motivos distintos de
no poder devolver y decir sólo "no se puede" obliga a adivinar cuál de los dos es.

### Cómo se hacen cumplir

El **primero**, al confirmar, con dos sentencias:

1. `SELECT ... FOR UPDATE` sobre las líneas de la recepción, por id ascendente.
2. **Recién después**, la suma de lo ya devuelto.

Tienen que ser dos. En una sola, la suma se evaluaría con la instantánea tomada
**antes** de esperar el bloqueo, y dos confirmaciones simultáneas verían "quedan
10" y las dos devolverían 8. Ver la nota en `confirmarDevolucion`.

Se usa la línea de la recepción como **punto de encuentro** y nada más: es
inmutable y no se le puede sumar un contador, así que el bloqueo protege la suma,
no la fila.

El **segundo** lo hace cumplir `applyStockMovement`, con su propia condición
`quantity + delta >= 0` dentro de la misma sentencia que descuenta. No hay
comprobación nuestra: si no hay unidades, el libro rechaza la salida y devuelve
el mensaje con el saldo real.

## Qué pasa al confirmar, en orden

1. Se carga la devolución y se comprueba que esté en `DRAFT`.
2. Se **bloquean** las líneas de la recepción, por id ascendente.
3. Se suma lo ya devuelto y se comprueba el tope histórico, renglón por renglón.
4. Por cada renglón: `applyStockMovement` con tipo `PURCHASE_RETURN`, negativo,
   referenciando la devolución. Acá se hace cumplir el tope físico.
5. La devolución pasa a `CONFIRMED`. **Antes** del crédito, para que el crédito ya
   vea una devolución confirmada: la obligación neta de la entrega la calculan
   varias consultas mirando `status = 'CONFIRMED'`.
6. `applySupplierAccountMovement` con tipo `PURCHASE_CREDIT`, negativo, con
   `returnId`.
7. La bitácora, con el crédito y lo que salió adentro.

**Todo en una transacción.** Si el tercer producto de cinco no tiene stock, no
sale ninguno y no se emite ningún crédito.

## `PURCHASE_RETURN`: por qué un tipo propio

Un `MANUAL_ADJUSTMENT` diría que faltan ocho unidades. Un `PURCHASE_RETURN` dice
que ocho unidades volvieron al proveedor.

Esa diferencia es el único dato que después permite preguntar cuánto se devolvió
en el trimestre y separarlo de lo que se perdió. Es el mismo motivo por el que
`LOSS` y `BREAKAGE` no son el mismo tipo.

Y **no figura entre los tipos de ajuste manual**: si estuviera, cualquiera con
`stock.adjust` podría sacar mercadería "devuelta al proveedor" sin devolución,
sin costo y sin crédito. Hay una prueba que comprueba que el único emisor sea
`service.returns.ts`.

## El motivo

Enum de cinco valores —`DAMAGED`, `WRONG_PRODUCT`, `QUALITY`, `OVER_DELIVERY`,
`OTHER`— **y** una nota libre. Los dos, no uno.

El enum existe para poder **preguntar**: "cuánto devolvimos por rotura este
trimestre", "qué proveedor nos manda más producto equivocado". Con texto libre
esa pregunta se contesta leyendo cien frases.

La nota existe porque el enum no alcanza. Con el enum solo, todo lo que no encaja
termina en `OTHER` y el motivo real se pierde; por eso `OTHER` **exige** nota.

## Permisos

| Permiso                   | Qué habilita                                    |
| ------------------------- | ----------------------------------------------- |
| `purchaseReturns.view`    | Ver devoluciones y lo retornable de una entrega |
| `purchaseReturns.create`  | Armar, editar y descartar el borrador           |
| `purchaseReturns.confirm` | Sacar la mercadería y emitir el crédito         |

**Compras tiene los tres**, incluido `confirm`, a diferencia de
`supplierAccounts.credit`, que no tiene. La asimetría es deliberada: las dos
bajan la deuda sin que salga plata, pero la devolución deja mercadería saliendo
del depósito —con su movimiento en el libro de inventario, su reconciliación y su
efecto en el recuento— y la nota de crédito no deja más rastro que un papel. Se
puede inventar una nota de crédito; no se puede inventar una devolución sin que
falte el stock.

**El repositor ve y no arma.** Verlas le sirve: es quien aparta la mercadería que
se va. Armarlas es elegir renglones **y ver su costo** —de ahí sale el crédito— y
el repositor no tiene `products.cost.view` desde la Fase 3B, a propósito.

## Numeración

`DV-00000124`, desde una secuencia de PostgreSQL. No de `count() + 1`: dos
devoluciones creadas en el mismo segundo leerían el mismo contador y el índice
único rechazaría a una de las dos.

Deja huecos —un borrador descartado se lleva su número— y está bien: es una
etiqueta para decir "la 124" por teléfono, no un contador de nada.

## Dónde se ve

- **Detalle de una compra** → botón `Devolver mercadería` por entrega, y las
  columnas Recibido / Devuelto / Neto por renglón.
- **/devoluciones** → el listado de la sucursal, con filtro por estado.
- **/devoluciones/:id** → el detalle, con el botón de confirmar y su advertencia.
- **Ficha del proveedor** → sección "Devoluciones".
- **Reportes → Compras** → recibido bruto, devuelto y compras netas.

Para el efecto sobre la deuda y las imputaciones, ver
[PURCHASE_RETURN_ACCOUNTING.md](PURCHASE_RETURN_ACCOUNTING.md).
