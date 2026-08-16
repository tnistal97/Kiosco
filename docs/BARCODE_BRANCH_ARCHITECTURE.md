# Código de barras y sucursales

> Fase 5A.2. Decisión de arquitectura **documentada, no ejecutada**: este
> documento no viene acompañado de ninguna migración. Explica qué modelo hay
> hoy, qué contradicción tiene, cuál es el destino elegido y en qué momento
> conviene llegar ahí.

---

## 1. El síntoma

La Fase 5A.1 dejó anotado un riesgo sin resolver:

> `ProductBarcode.code` es único **globalmente**, mientras que el catálogo está
> scoped por sucursal.

Con una sucursal no se nota. Con dos:

- un código cargado en la sucursal A **no se puede cargar** en la B;
- la B, al escanearlo, ve `Código no registrado`;
- si intenta crearlo, recibe un 409 que no puede resolver por su cuenta.

El mismo paquete de yerba, con el mismo código impreso, existe en las dos
sucursales del mundo real y en una sola del sistema.

---

## 2. El modelo actual, medido

No supuesto: leído del esquema y contado en la base.

### Lo que está por sucursal

| Tabla                                                    | Cómo                                       |
| -------------------------------------------------------- | ------------------------------------------ |
| `Product`                                                | `branchId Int` **NOT NULL**, FK a `Branch` |
| `BranchStock`                                            | `@@unique([branchId, productId])`          |
| `BranchLotStock`                                         | `@@unique([branchId, lotId])`              |
| `Client`                                                 | `branchId Int` NOT NULL                    |
| `Sale`, `CashShift`, `PurchaseOrder`, `StockMovement`, … | 20 modelos con `branchId`                  |

### Lo que es global

| Tabla            | Cómo                                             |
| ---------------- | ------------------------------------------------ |
| `Category`       | sin `branchId`                                   |
| `Supplier`       | sin `branchId`                                   |
| `ProductBarcode` | sin `branchId`, y `@@unique([code])`             |
| `ProductLot`     | cuelga de `productId`, que ya define la sucursal |

**El modelo ya es híbrido.** La discusión no es "global contra por sucursal":
es dónde poner una frontera que hoy está puesta en dos lugares distintos.

### La contradicción, en una línea

`BranchStock` tiene clave compuesta `(branchId, productId)`. Esa forma dice
_"un producto puede tener stock en varias sucursales"_ — es el modelo de
catálogo global. Pero `Product.branchId` dice _"este producto es de una
sucursal"_. Las dos afirmaciones no pueden ser ciertas a la vez.

Gana la segunda, y se puede comprobar:

```sql
SELECT count(*) FROM "BranchStock" bs
  JOIN "Product" p ON p.id = bs."productId"
 WHERE bs."branchId" <> p."branchId";
-- 0
```

**Cero filas cruzadas**, y no por casualidad: `applyStockMovement()` es la única
puerta que escribe `BranchStock`, y siempre con el `branchId` de la sesión,
sobre un producto que ya se cargó filtrando por esa misma sucursal. La clave
compuesta de `BranchStock` es, en la práctica, una clave simple con una columna
de adorno.

### Cómo se comporta hoy, exactamente

**Al leer** (`buscarPorCodigoExacto`): se busca por el índice único, y si el
producto encontrado es de otra sucursal se devuelve `null`. Un código ajeno se
comporta como un código inexistente — deliberado: no se le confirma a nadie que
el producto existe en otro lado.

**Al escribir** (`crearProductoRapido`): el índice único rechaza el alta y el
servicio distingue dos 409:

- el código lo tiene un producto **de esta sucursal** → se nombra el producto y
  se ofrece agregarlo a la venta;
- el código lo tiene un producto **de otra** → _"Ese código ya está registrado y
  no pertenece a esta sucursal. Pedile a un encargado que lo revise."_

El segundo mensaje es honesto y no filtra nada. Pero es un callejón: el
encargado tampoco tiene una acción en el sistema que lo resuelva.

---

## 3. Las tres preguntas

**¿`Product` es global o pertenece de verdad a una sucursal?**
Pertenece. `branchId` es NOT NULL, hay 81 referencias a esa columna en 27
archivos de `src/`, y toda lectura del catálogo filtra por ella.

**¿`ProductBarcode` debería ser global?**
Como _identificador del artículo_, sí: EAN-13 es global por diseño, y por eso
existe. El problema no es que el código sea global — es que apunta a una entidad
que no lo es.

**¿El mismo producto puede existir en dos sucursales?**
Hoy no, y no por una regla explícita sino por el índice único del código. Dos
filas `Product` con el mismo nombre en dos sucursales sí se pueden crear; lo que
no se puede es que la segunda tenga el código impreso en el envase. Es decir:
el sistema permite el duplicado **malo** (dos productos que no se saben el
mismo) y prohíbe el **útil** (que las dos cajas lean la misma etiqueta).

**¿El barcode representa producto global o producto+sucursal?**
Representa el artículo. Un código de barras es una propiedad del envase, no del
local donde está el envase.

---

## 4. Las tres opciones

### A · Catálogo global

```
Product           sin branchId
ProductBarcode    @@unique([code])          ← queda como está
BranchStock       (branchId, productId)     ← recién ahora significa algo
BranchProduct     precio, mínimo, activo, política de lote — por sucursal
```

**A favor.** Es el único modelo en el que el código de barras significa lo
mismo que en el mundo real. `BranchStock` deja de ser redundante. Un alta rápida
en la sucursal B encuentra el artículo de la A y sólo declara stock. Los
reportes consolidados —"cuánta yerba hay entre las dos"— se vuelven una suma en
vez de una conciliación por nombre.

**En contra.** Es la migración más grande que le queda al sistema: hay que
decidir qué es del artículo (nombre, unidad de venta, categoría, códigos) y qué
es de la sucursal (precio, mínimo, baja lógica, política de lote). El **precio
por sucursal** no es opcional: dos locales del mismo dueño no siempre venden al
mismo precio, y hoy `Product.price` es único. Sin `BranchProduct`, "global"
significaría precio único para todos, que es una decisión de negocio disfrazada
de refactor.

### B · Catálogo por sucursal, código único por sucursal

```
Product           branchId                  ← queda como está
ProductBarcode    @@unique([branchId, code])
```

**A favor.** Es la migración más chica: agregar `branchId` a `ProductBarcode`,
rellenarlo desde `Product.branchId` y cambiar un índice. Una tarde de trabajo,
y el callejón desaparece: cada sucursal carga sus códigos sin chocar.

**En contra.** Consagra el duplicado. El mismo artículo queda como dos productos
sin relación: dos historiales de costo, dos precios que hay que cambiar dos
veces, dos fichas que mantener, y ningún reporte consolidado posible sin
emparejar por nombre — que es exactamente lo que un código de barras existe para
evitar. Resuelve el síntoma y empeora la enfermedad.

### C · Híbrido explícito

```
Article           el artículo: nombre, unidad, categoría, códigos     ← global
ProductBarcode    articleId, @@unique([code])                          ← global
Product           branchId + articleId: precio, mínimo, activo         ← por sucursal
BranchStock       (branchId, productId)
```

Es A con otro nombre: separa lo que el mundo hace global de lo que el negocio
hace local. La diferencia con A es de vocabulario y de tamaño de migración —
`Article` nace nuevo y `Product` conserva su tabla, sus claves foráneas y todo
el historial (ventas, movimientos, costos) que ya cuelga de él.

---

## 5. Decisión

> **Destino: C, el híbrido explícito, entendido como la forma ejecutable de A.**
> **Ahora: nada. Se difiere.**

### Por qué C y no A

A y C llegan al mismo lugar; C llega sin reescribir el pasado. `Product.id` es
referenciado por `SaleItem`, `StockMovement`, `ProductCostHistory`,
`PurchaseOrderItem`, `ProductLot`, `InventoryCountLine` y otras. Vaciar
`Product` de sus atributos y moverlos a otra tabla es aditivo; **cambiar qué es
un `Product.id`** —de "artículo en una sucursal" a "artículo"— obligaría a
reescribir claves foráneas de tablas que la Fase 3A declaró inmutables y que
tienen disparadores en la base para impedir que se editen. Ese es el argumento
decisivo, y no el tamaño de la migración.

### Por qué NO ahora

1. **No afecta a staging.** Staging es de una sucursal. Con una sucursal,
   "único global" y "único por sucursal" son la misma restricción, y ningún
   camino de la aplicación se comporta distinto.
2. **Producción tiene una sucursal.** La segunda (`Almacen Norte`, id 418)
   existe en la base de desarrollo y no tiene ni un producto.
3. **La preferencia del pedido se cumple igual.** "Si el modelo ya tiene
   `BranchStock`, evaluar seriamente catálogo global" — se evaluó, y la
   conclusión es que sí, es el destino. Lo que este documento agrega es que
   `BranchStock` **no prueba** que el catálogo sea global: hoy no lo es, y esa
   tabla está a la espera de un modelo que todavía no llegó.
4. **Meter la migración ahora es lo que el pedido pide no hacer.** «No meter una
   migración grande sólo para "limpiar" el modelo.»

---

## 6. Análisis de migración, para cuando toque

Hecho ahora, mientras el modelo está fresco, para que la decisión de después no
empiece de cero.

### Paso 0 · Precondición

Una sucursal en producción, o dos con catálogos que nunca se cruzaron. Con
catálogos ya duplicados hace falta un paso de emparejado manual: dos filas con
el mismo código no pueden existir hoy, así que el emparejado sería por nombre y
lo tiene que confirmar una persona.

### Los cinco pasos, todos aditivos

1. **`CREATE TABLE "Article"`** con `id`, `name`, `saleUnit`, `purchaseUnit`,
   `unitsPerPurchaseUnit`, `categoryId`, `lotTracking`, `expirationTracking`.
   Nada que hoy sea por sucursal.
2. **Rellenar**: un `Article` por cada `Product` existente. Con una sucursal es
   una correspondencia 1 a 1 y no hay ninguna decisión que tomar.
3. **`ALTER TABLE "Product" ADD COLUMN "articleId"`**, nullable, con FK.
   Rellenar. Recién en una migración posterior, NOT NULL.
4. **`ALTER TABLE "ProductBarcode" ADD COLUMN "articleId"`**, rellenar desde
   `productId`, y **conservar `productId` durante toda la transición**. El
   índice `@@unique([code])` no se toca: sigue siendo correcto y sigue siendo
   el que sostiene el camino caliente del lector.
5. **Alta en una segunda sucursal**: `POST /api/products` con un código ya
   conocido deja de ser un 409 y pasa a ser "adoptar el artículo": se crea un
   `Product` de esta sucursal apuntando al `Article` que ya existe, con su
   propio precio y su propio stock inicial.

### Lo que hay que decidir antes de escribir la primera línea

- **Precio.** ¿Por sucursal —`Product.price`, como hoy— o del artículo con
  excepción por sucursal? Es una decisión del negocio, no del esquema.
- **Baja lógica.** ¿Una sucursal puede dar de baja un artículo que la otra
  vende? Casi seguro que sí, y entonces `isActive` se queda en `Product`.
- **Política de lote.** Va en `Article`: es una propiedad de la mercadería —el
  yogur vence en todos lados—, no del local.
- **Costo.** Hoy es `Product.cost` y se alimenta de las compras, que son por
  sucursal. Se queda en `Product`.

### Lo que NO hay que hacer

- **No borrar `ProductBarcode.productId`** hasta que todos los caminos usen
  `articleId`. Es la columna que sostiene el lector.
- **No tocar `@@unique([code])`.** Es correcto en el modelo actual y sigue
  siendo correcto en el destino. Cambiarlo a `(branchId, code)` —la opción B—
  es el único paso de este documento que sería difícil de revertir.
- **No mover `Product.id`.** Todo el historial cuelga de ahí.

---

## 7. Clasificación

**`DEFERRED MULTIBRANCH BLOCKER`**

| Pregunta                      | Respuesta                                                                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ¿Bloquea staging?             | **No.** Una sucursal.                                                                                                                         |
| ¿Bloquea producción?          | **No.** Una sucursal, y la segunda está vacía.                                                                                                |
| ¿Bloquea la segunda sucursal? | **Sí.** Es _el_ bloqueante, y hay que resolverlo antes de cargar el primer producto en ella.                                                  |
| ¿Se puede posponer sin costo? | **Sí, mientras haya una sola sucursal.** Cada producto que se cargue en una segunda sucursal antes de migrar es un emparejado manual después. |

### La señal de alarma

El día que alguien pida abrir una segunda sucursal, **este documento se lee
antes de crearla**. No después de cargarle el catálogo.

---

## Ver también

- [POS_QUICK_PRODUCT_CREATE.md](POS_QUICK_PRODUCT_CREATE.md) — los dos 409 y por
  qué dicen cosas distintas
- [PHASE3_BARCODES.md](PHASE3_BARCODES.md) — por qué los códigos salieron de
  `Product.barcode`
- [LOT_TRACKING_DESIGN.md](LOT_TRACKING_DESIGN.md) — la comparación de modelos
  que ya se hizo para lotes, con el mismo método
