# Trazabilidad por lote: el modelo

Este documento se escribió **antes** de tocar `schema.prisma`, porque la decisión
que hay que tomar acá cambia el significado del libro de inventario, que es la
pieza más vieja y más apoyada del sistema.

## La pregunta

Hoy el sistema sabe:

```
Yogur bebible
Stock: 18
```

Y tiene que poder saber, cuando el producto lo requiera:

```
Yogur bebible
Stock: 18

Lote YG-260801   8 unidades   vence 18/08/2026
Lote YG-260807  10 unidades   vence 05/09/2026
```

Sin dejar de saber lo primero. `BranchStock.quantity` **sigue siendo la verdad
agregada** del producto en la sucursal: es lo que mira la caja para vender, lo
que muestra el listado de stock, lo que reconcilia contra el libro desde la Fase
3A y lo que va a seguir haciendo todo eso después de esta fase.

## Tres modelos posibles

### Modelo A — el lote es una columna del movimiento; el stock por lote se deriva

`StockMovement.lotId`, y nada más. El stock de un lote es la suma de sus
movimientos:

```sql
SELECT sum("quantity") FROM "StockMovement" WHERE "lotId" = 12
```

**A favor.** Es el modelo más chico que se puede escribir y no tiene ninguna
invariante que mantener: no hay dos cifras, hay una sola y es el libro. Nada
puede divergir porque no hay nada de qué divergir.

**En contra.** La consulta de arriba es el **camino caliente de la caja**. Cada
venta de un producto con lotes necesita saber qué lotes tienen unidades y
cuántas, para elegir por FEFO; con 100.000 movimientos y un producto que lleva
dos años rotando, eso es agregar miles de filas por línea de ticket, y hay que
hacerlo **dentro de la transacción de la venta y bajo bloqueo**. Un índice sobre
`lotId` ayuda pero no cambia el orden del problema: la cuenta crece con el
historial, no con el stock.

Es el mismo motivo por el que `BranchStock` existe desde antes de este proyecto y
por el que la Fase 3A —que introdujo el libro— **no lo borró**.

**Descartado por rendimiento**, no por incorrecto. Es el modelo de referencia
contra el que se comprueba el elegido: `reconstruirStockDeLote()` hace
exactamente esa suma, y la reconciliación la compara contra la cifra
materializada.

### Modelo B — todo el stock pertenece a un lote

Cada unidad tiene lote, siempre. El stock histórico —las 18 unidades que ya
estaban antes de esta fase— se mete en un lote sintético:

```
Lote LEGACY-2026
18 unidades
sin vencimiento
```

**A favor.** Una sola regla, sin casos especiales: `SUM(lotes) == BranchStock`
para todos los productos, siempre. Las consultas no tienen que preguntar si el
producto está trazado.

**En contra, y es definitivo.** Ese lote **es una mentira con formato de dato**.
Dice que 18 unidades de yogur pertenecen a una partida identificable, y no es
cierto: nadie sabe de qué partida son. El día que ese yogur haga daño y haya que
retirar la partida, el sistema va a contestar con un código que no existe en
ninguna caja. Es exactamente el error que este proyecto viene evitando desde que
`Product.cost` migró a `NULL` en vez de a cero: **un dato inventado se ve igual
que un dato real**, y alguien va a tomar una decisión mirándolo.

**Descartado.** El pedido lo prohíbe expresamente y coincide con el criterio del
sistema.

### Modelo C — stock por lote materializado + ledger de lote — **ELEGIDO**

```
BranchLotStock(branchId, lotId, quantity)    ← materializado, como BranchStock
StockMovement.lotId                          ← el libro, ahora por lote
LotAssignment                                ← el segundo ledger, ver más abajo
```

Es **el mismo patrón que ya gobierna el stock del producto**, un nivel más
abajo: una cifra materializada para poder consultarla barata, y un libro que la
explica fila por fila. Lo que la Fase 3A hizo con `BranchStock`, esta fase lo
hace con `BranchLotStock`.

Y el stock que no pertenece a ningún lote **no se inventa: se nombra**.

## Lo no trazado

```
sinAsignar = BranchStock.quantity − Σ BranchLotStock.quantity
```

**Es derivado, no es una columna.** Y esa es la respuesta a "no quiero dos cifras
que puedan divergir sin reconciliación": no hay dos cifras. Hay una sola cifra
por producto (`BranchStock.quantity`), una por lote (`BranchLotStock.quantity`),
y lo no trazado es exactamente **lo que los lotes no explican**. Una resta no
puede desactualizarse.

Guardarlo en una columna `untrackedQuantity` daría el problema que el pedido
señala: dos números que se escriben en momentos distintos y que empiezan a
diferir el día que alguien se olvide de actualizar uno de los dos.

En pantalla aparece con su nombre y sin disfraz:

```
Yogur bebible          18
  Lote YG-260801        8   vence 18/08/2026
  Lote YG-260807        6   vence 05/09/2026
  Sin asignar a lote    4   ← no es un lote
```

`Sin asignar` no se puede vender por FEFO —no tiene vencimiento que ordenar— ni
devolver a un proveedor —no se sabe de qué entrega vino—. Se puede vender de un
producto `OPTIONAL`, ajustar, contar en un inventario y asignar a un lote.

## Las invariantes, y quién las comprueba

```
I1   BranchLotStock.quantity == Σ StockMovement.quantity(lote) + Σ LotAssignment.quantity(lote)
I2   Σ BranchLotStock.quantity(producto, sucursal) <= BranchStock.quantity
I3   BranchLotStock.quantity >= 0
I4   sinAsignar == 0   para todo producto con lotTracking = REQUIRED
```

- **I1** es la de la Fase 3A un nivel abajo: la cifra materializada es la suma de
  su libro. La comprueba `integrity:check`.
- **I2** es una **desigualdad**, y ahí está todo el diseño: los lotes explican
  _parte_ del stock. La igualdad sólo vale cuando el producto está enteramente
  trazado, que es I4.
- **I3** la hace cumplir la misma sentencia que descuenta, igual que
  `BranchStock`: `quantity + delta >= 0` dentro del `UPDATE`.
- **I4** es lo que hace que `REQUIRED` signifique algo. Se establece al activar el
  tracking —no se puede activar sin cerrar la cuenta— y se conserva porque desde
  entonces todo movimiento del producto lleva lote.

## Por qué hace falta un segundo ledger

Al activar el tracking sobre un producto que ya tiene 20 unidades hay que decir
de qué lotes son. Esa operación **no cambia el stock**: había 20 y siguen
habiendo 20. Lo que cambia es la _atribución_.

El pedido lo dice y coincide con lo correcto: no se puede fabricar un
`StockMovement` de `+20` seguido de otro de `−20` para satisfacer el modelo. El
libro de inventario diría que entraron y salieron veinte unidades, y no pasó ni
una cosa ni la otra; cualquier reporte de movimientos por tipo quedaría
contaminado con operaciones que nunca ocurrieron.

Entonces: **`LotAssignment`**, un ledger propio y chico.

```
LotAssignment(id, branchId, productId, lotId, quantity, userId, reason, createdAt)
```

Es un hecho distinto y merece una fila distinta: _el 11 de agosto, Ana declaró
que 8 de las 20 unidades que había pertenecen al lote YG-260801_. No es una
entrada de mercadería, no es una salida, no es un ajuste. Es una atribución, y
tiene autor, fecha y motivo como todo lo demás en este sistema.

`quantity` va **con signo**, igual que el libro de inventario: una atribución
equivocada no se edita ni se borra, se compensa con su opuesta. La fila es
inmutable, con disparador.

## Por qué `BranchLotStock` y no una columna en `ProductLot`

Porque **la cantidad depende de la sucursal** y el lote no. El mismo lote
`YG-260801` puede tener 8 unidades en el local del centro y 3 en el de la
avenida: es la misma partida física repartida en dos depósitos.

`ProductLot` es la partida —su código, su vencimiento, su fecha de elaboración—;
`BranchLotStock` es cuánto de esa partida hay en cada lugar. Es la misma
separación que hay entre `Product` y `BranchStock`, y por el mismo motivo.

## La única puerta, otra vez

`applyStockMovement()` sigue siendo el único lugar de `src/` que escribe sobre
`BranchStock`, y **pasa a ser también el único que escribe sobre
`BranchLotStock`**. Le entra un `lotId` opcional y hace las dos cosas en la misma
transacción, con la misma técnica: `UPDATE ... WHERE quantity + delta >= 0
RETURNING`.

La regla de ESLint se extiende: `BranchLotStock` entra en `PROHIBIDO_ESCRIBIR_STOCK`
y `LotAssignment` en una frontera nueva. Si el lote se pudiera escribir desde
afuera, I1 dejaría de significar algo el primer día.

## El orden de los bloqueos

Una venta que cruza dos lotes toma dos bloqueos de fila en `BranchLotStock`, más
el de `BranchStock`. Con dos cajas vendiendo lo mismo al mismo tiempo, tomarlos
en distinto orden es un interbloqueo.

**El contrato: `BranchStock` primero —lo toma `applyStockMovement`— y los lotes
por `lotId` ascendente.** Como cada línea de venta se aplica entera antes de
pasar a la siguiente, y las líneas ya venían ordenadas por `productId` desde la
Fase 0.5, el orden global queda determinado.

FEFO **no** ordena los bloqueos: FEFO decide de qué lote sale la mercadería, y
esa decisión se toma antes, leyendo. Cuando llega el momento de escribir, las
líneas resueltas se reordenan por `lotId`. Son dos órdenes distintos y mezclarlos
es el interbloqueo.

## Qué no cambia

- `BranchStock.quantity` sigue siendo la verdad agregada, y sigue siendo lo que
  la caja consulta para saber si puede vender.
- Un producto con `lotTracking = NONE` —que es **todo el catálogo existente**—
  se comporta exactamente igual que antes. Ni una consulta más, ni una columna
  distinta, ni un lote vacío.
- Las cinco invariantes de la Fase 3A siguen valiendo sin tocar una letra.
- `StockMovement` sigue siendo inmutable.

## Documentos hermanos

- [LOT_EXPIRATION_POLICY.md](LOT_EXPIRATION_POLICY.md) — vencimientos, políticas
  por producto y por qué son dos banderas y no una.
- [FEFO_POLICY.md](FEFO_POLICY.md) — el orden de salida, y qué promete y qué no.
- [PHYSICAL_INVENTORY.md](PHYSICAL_INVENTORY.md) — el inventario físico.
- [INVENTORY_LEDGER.md](INVENTORY_LEDGER.md) — el libro de inventario, de la Fase
  3A, que esta fase extiende sin reemplazar.
