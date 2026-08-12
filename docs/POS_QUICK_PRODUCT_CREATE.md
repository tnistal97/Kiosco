# Alta rápida de productos desde la caja

> Fase 5A.1. El código que no existe deja de ser un callejón sin salida.

## El problema

Escaneás un código que no está en el catálogo y aparece una línea de texto
chica, en rojo, debajo del campo: `Código 7791234567890 desconocido`. Y nada
más. No hay botón, no hay camino, no hay siguiente paso.

Lo que pasa en el mostrador, con el cliente enfrente, es una de estas tres:

1. el cajero vuelve a pasar el producto por el lector dos o tres veces, porque
   una línea de ocho píxeles se lee como «no pasó nada»;
2. busca a mano otro producto parecido y lo cobra con ese —lo que descuadra el
   stock de **dos** productos a la vez—;
3. lo cobra suelto y no queda registrado.

Las tres son peores que el problema original. Esta fase cierra ese camino.

## El flujo

```text
escaneo
  → producto no encontrado
  → estado explícito, con el código a la vista
  → alta rápida (seis campos)
  → producto creado + movimiento de inventario
  → agregado al ticket
  → el foco vuelve al lector
  → sigo vendiendo
```

## Los cinco desenlaces de un escaneo

Antes, cuatro de los cinco terminaban en la misma línea de texto. Ahora cada
uno dice qué pasó y cuál es el siguiente paso.

| Desenlace             | Qué se ve                            | Acciones                             |
| --------------------- | ------------------------------------ | ------------------------------------ |
| **Encontrado**        | La línea entra al ticket. Sin ruido. | —                                    |
| **Sin stock**         | `X está agotado`                     | —                                    |
| **No registrado**     | `Código no registrado` + el código   | **Crear producto** · Copiar · Cerrar |
| **Producto inactivo** | `Producto inactivo` + el nombre      | **Reactivar** · Copiar · Cerrar      |
| **Código inválido**   | `Código inválido` + el motivo        | Copiar · Cerrar                      |
| **Sin red**           | `No se pudo consultar el código`     | **Reintentar** · Copiar · Cerrar     |

Tres decisiones dentro de esa tabla:

- **El camino feliz no cambió.** Cuando el producto existe no aparece ningún
  bloque: sigue siendo escanear y seguir. Interrumpir el 98 % de los escaneos
  para atender al 2 % sería un peor sistema.
- **Un código inválido NO ofrece crear.** No es lo mismo «no existe» que «no
  puede existir». Ofrecer el alta para `779 12 34` sería ofrecer un camino que
  el servidor va a rechazar, y en el mostrador eso se lee como que el sistema
  está roto. La distinción la hace [`src/modules/products/barcode.ts`](../src/modules/products/barcode.ts),
  que es la **misma** regla que valida el servidor.
- **Un producto inactivo no se llama «no registrado»**, porque sería mentira,
  y porque el camino correcto es reactivarlo, no crear un duplicado que
  competiría con el original por la misma etiqueta.

## El permiso

`products.quickCreate`, separado de `products.create` y **más chico** que él.

|                          | `products.create`               | `products.quickCreate`                        |
| ------------------------ | ------------------------------- | --------------------------------------------- |
| Dónde                    | Productos                       | Caja y orden de compra                        |
| Campos                   | Once, cuatro con permiso propio | Seis                                          |
| Costo, proveedor, mínimo | Sí                              | No (el costo solo con `products.cost.update`) |
| Códigos alternativos     | Sí                              | No                                            |
| Lotes y vencimiento      | Sí                              | No: siempre `NONE`                            |

Que sea más chico es lo que lo hace útil: se le puede dar al **supervisor de
turno** —que tiene que poder destrabar una venta a las nueve de la noche— sin
darle el catálogo entero. El reparto completo y su fundamento están en
[PERMISSIONS_MATRIX.md](PERMISSIONS_MATRIX.md).

### Precio inicial ≠ precio existente

Quien puede crear fija el precio con el que el producto **nace**. Cambiar el de
uno que **ya existe** sigue necesitando `products.price.update`.

No es una excepción inventada para esta fase: es la misma regla que rige
`products.create` desde la Fase 2.4, por el mismo motivo —un producto sin precio
no se puede vender, que es justamente lo que se viene a destrabar—.

El precio se valida y se guarda en el servidor, en `Decimal`, y queda en la
bitácora con el usuario, la sucursal y el `requestId`.

## El formulario

```text
Código          prellenado y de solo lectura si vino del lector
Nombre *
Precio *        se rotula "Precio por kilogramo" si la unidad es KG o L
Categoría *     con "+ Nueva" si el usuario tiene categories.manage
Unidad de venta UNIT por omisión
Stock inicial   1 por omisión, visible y editable
Costo           solo si el usuario tiene products.cost.update
```

Lo que **no** pide: proveedor, descripción, margen, unidad de compra, stock
mínimo, códigos alternativos, lotes, vencimiento y notas. Todo eso se completa
después desde Productos. Un formulario de once campos con el cliente esperando
no lo llena nadie.

### Por qué el código escaneado no se edita

El código que se guarda tiene que ser **el que leyó el lector**. Si se pudiera
corregir a mano, el próximo escaneo del mismo producto no lo encontraría, y el
alta habría servido para nada. En el alta manual —la que se abre con `+
Producto` o con `Alt+N`— el campo sí es editable y puede quedar vacío: es el
camino del producto artesanal o el fraccionado que no tiene etiqueta.

### Por qué el stock inicial arranca en 1

Se evaluó la alternativa: dejarlo en cero y ofrecer una casilla «tengo una
unidad para vender ahora». Perdió por una razón concreta: **con cero unidades el
sistema —con razón— no deja vender**, así que el flujo terminaría en el mismo
callejón que vino a cerrar.

Uno es la suposición más chica que permite seguir. Y está **a la vista y
editable antes de confirmar**, con la unidad en la etiqueta (`Stock inicial
(kg)`), para que sea una declaración y no un supuesto silencioso. El sistema no
asume que porque hay una unidad en la mano hay veinte.

Si igual se crea con cero, no se agrega al ticket: se avisa que quedó sin stock
y se indica dónde cargarlo. **El control de stock no se debilita porque el alta
haya nacido en la caja.**

## Lo que pasa del lado del servidor

`POST /api/products/quick` → `crearProductoRapido()` → `altaDeProducto()`.

La ruta rápida **no reimplementa** el alta: traduce sus seis campos a una
entrada completa y entra por el mismo cuerpo que el formulario largo. Duplicarlo
habría dado dos transacciones que pueden separarse —una que emite el movimiento
de stock y otra que no, una que audita y otra que no— y esa es la clase de
diferencia que después nadie encuentra.

Todo en **una transacción**:

1. validar permiso y forma de la entrada;
2. `Product`;
3. `ProductBarcode` (si vino código);
4. `BranchStock` en cero;
5. movimiento **`INITIAL`** por el stock declarado, si es mayor que cero;
6. `AuditLog`.

### El stock entra por el libro

No se escribe `BranchStock.quantity = 1`. Se emite un movimiento:

```text
type               INITIAL
previousQuantity   0
delta              +5
resultingQuantity  5
reason             "Stock inicial al dar de alta el producto"
```

`INITIAL` y no `MANUAL_ADJUSTMENT`: un ajuste corrige un saldo que ya existía;
esto **es** el saldo de partida, y es exactamente lo que `INITIAL` significa
desde la Fase 3A. No se inventó un tipo nuevo porque el que hay es el correcto.

Si se declara cero, no se emite nada: la invariante `suma(movimientos) ==
cantidad` se cumple sola con la suma vacía, y un movimiento de cero unidades
ensucia el historial sin decir nada.

### Dos cajas, el mismo código

Es el caso obligatorio, y la comprobación previa —«¿está libre este código?»—
**no alcanza**: entre esa lectura y la inserción hay una ventana.

Quien cierra el caso es el índice único de `ProductBarcode.code`. Lo que agrega
esta fase es traducir ese rechazo en algo con lo que se puede seguir
trabajando:

```text
Caja A ────┐
           ├──→ una crea (201)
Caja B ────┘    la otra recibe 409 PRODUCT_ALREADY_EXISTS
                con el producto adentro
                → "Otro usuario acaba de registrar este producto"
                → [Agregar a la venta]
```

El servidor vuelve a buscar el código y responde según lo que encuentra:

| Lo que encuentra                    | Código                   | Qué se ve                                           |
| ----------------------------------- | ------------------------ | --------------------------------------------------- |
| Un producto activo de esta sucursal | `PRODUCT_ALREADY_EXISTS` | El producto, listo para agregar a la venta          |
| Uno inactivo de esta sucursal       | `PRODUCT_ALREADY_EXISTS` | Su nombre y que está dado de baja                   |
| Uno de **otra** sucursal            | `DUPLICATE_BARCODE`      | «ya está registrado y no pertenece a esta sucursal» |

El tercer caso existe porque **`ProductBarcode.code` es único globalmente pero
el catálogo está scoped por `Product.branchId`**. Un código de otra sucursal se
comporta como inexistente al buscarlo y como ocupado al crearlo. No se revela
de qué producto ni de qué sucursal se trata: quien está en la caja no puede
verlo ni resolverlo. Ver «Limitaciones conocidas».

Nunca se crea un duplicado, y un choque de código nunca es un 500: es una
condición prevista con su propio código de error.

## Teclado y foco

| Tecla       | Qué hace                             |
| ----------- | ------------------------------------ |
| `Alt` + `N` | Abre el alta manual                  |
| `Enter`     | Confirma el formulario               |
| `Escape`    | Cancela y devuelve el foco al lector |

`Alt+N` y no `Ctrl+N`: los navegadores usan `Ctrl+N` para abrir una ventana y no
se puede interceptar desde una página. No choca con los atajos que ya existían
—`F12`, `Ctrl+K`, `/` y las flechas—.

Después de **Crear y agregar**, el foco vuelve solo al campo del lector. El
cajero puede seguir `scan · scan · scan` sin tocar el mouse, que es la prueba
número 6 de `e2e/alta-rapida.spec.ts`.

Mientras el diálogo está abierto, el escáner global deja de escuchar: si no, una
lectura agregaría productos al ticket detrás del formulario.

## Productos por peso

Si la unidad es `KG` o `L`, el precio se rotula **por kilo** o **por litro**, y
después de crear el producto se abre el diálogo de peso que ya existía. **No se
agrega 1 kg automáticamente** a la venta: el peso lo pone la balanza o la
persona, no el sistema.

## Métrica operativa

Sin sistema nuevo de telemetría. La bitácora ya lo responde:

```sql
SELECT COUNT(*), date_trunc('week', "timestamp")
  FROM "AuditLog"
 WHERE "tableName" = 'Product'
   AND "origin"    = 'POST /api/products/quick'
 GROUP BY 2 ORDER BY 2 DESC;
```

Cada fila trae usuario, sucursal, código, precio, stock declarado y `requestId`.
Los productos que hubo que crear en el mostrador **son** los que faltaban en el
catálogo, así que esa consulta contesta la pregunta que importa.

**Lo que no se registra, a propósito:** los códigos desconocidos que se
escanearon y nunca se crearon. Escribir una fila por lectura fallida convertiría
el camino más caliente del sistema en un camino de escritura, y el punto 35 pide
exactamente lo contrario. Queda anotado como diferido: hacerlo bien necesita una
tabla de contadores, que es un sistema nuevo.

## Limitaciones conocidas

- **Códigos únicos globalmente, catálogo por sucursal.** Con una sola sucursal
  —el caso de hoy— no se nota. Con dos, un código cargado en la sucursal A no se
  puede cargar en la B, y la B ve un conflicto que no puede resolver. La
  respuesta lo dice sin revelar nada, pero el modelo es el que es. Resolverlo
  bien implica decidir si el catálogo es global o por sucursal, y eso es una
  decisión de arquitectura, no un ajuste.
- **Sin imágenes.** `Product` no tiene columna de imagen y el sistema no tiene
  pantalla de carga. No se agregó una en esta fase. Cuando exista, hay que
  probarla en staging antes que en producción: el Nginx productivo actual
  **bloquea `multipart/form-data`** (hallazgo de la Fase 5A).

## Pruebas

| Qué se comprueba                              | Dónde                                   |
| --------------------------------------------- | --------------------------------------- |
| La política de códigos, con ceros iniciales   | `tests/unit/codigo-de-barras.test.ts`   |
| Alta, ledger, permisos, contrato y conflictos | `tests/integration/alta-rapida.test.ts` |
| Dos cajas creando el mismo código             | `tests/concurrency/alta-rapida.test.ts` |
| Los veinte recorridos de interfaz             | `e2e/alta-rapida.spec.ts`               |
| El diálogo en 375 px                          | `e2e/movil.spec.ts`                     |
| El lector con 10.000 productos                | `tests/performance/queries.test.ts`     |
