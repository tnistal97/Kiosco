# Inventario físico

## Qué es, y en qué se diferencia de un ajuste

El ajuste manual existe desde la Fase 3A: un producto, una persona, "quedan 30".

Un inventario físico es otra cosa: **un recorrido**. Tiene estados, se cuenta a
ciegas, se cuenta mientras el local vende, alguien mira las diferencias antes de
que existan, y se aplican todas juntas o ninguna.

## Los cinco estados

```
DRAFT ──contar──▶ COUNTING ──cerrar──▶ REVIEW ──aplicar──▶ APPLIED
  │                   │                   │
  └──────────────cancelar──────────────────┘  ▶ CANCELLED
```

**`REVIEW` es el que hace útil a todos los demás.** El conteo terminó y todavía
no tocó el stock. Sin ese estado, contar y corregir serían el mismo acto y nadie
podría mirar las diferencias antes de que existieran.

`DRAFT → COUNTING` no se aprieta: pasa cuando entra el primer conteo. Un estado
que cambia solo cuando pasa algo dice más que uno que hay que declarar aparte.

**`APPLIED` y `CANCELLED` son inmutables**, con disparador en la base. Es la
misma inmutabilidad condicional que las devoluciones de la Fase 4C.

## Las líneas

Se generan al crear la sesión, con **un solo `INSERT ... SELECT`**: un inventario
de todo el catálogo son miles de filas, y traerlas a JavaScript para volver a
mandarlas de a una convertiría "crear el inventario" en una operación de minutos.

Se genera:

- una línea por **(producto, lote con unidades)**;
- una línea por **producto con `lotId` nulo**.

Esa última no es decorativa. Es tres cosas a la vez: el stock no atribuido de un
producto `OPTIONAL`, la línea única de un producto `NONE`, y el lugar donde van
las unidades que aparecen sin partida conocida.

Entran los productos **activos**: contar uno dado de baja es contar algo que ya
no se repone.

## Conteo a ciegas

`blindCount`, **verdadero por omisión**.

Mientras la sesión está contando, la API **no devuelve** lo esperado ni la
diferencia. No es que la pantalla los esconda: no salen del servidor.

El motivo es el punto entero del mecanismo: ver "el sistema espera 18" antes de
contar hace que la respuesta sea 18. Un conteo influido por el número esperado no
es un conteo, es una confirmación.

Al cerrar el conteo aparecen los dos, que es cuando hay que mirarlos.

## Los tres números de una línea

```
snapshotQuantity   cuánto había cuando EMPEZÓ la sesión   (informativo)
expectedAtCount    cuánto había cuando SE CONTÓ           (decide)
countedQuantity    lo que se contó con la mano
variance           countedQuantity − expectedAtCount
```

`variance` se guarda, con un `CHECK` que obliga a que los tres concuerden —igual
que `previousQuantity`, `quantity` y `resultingQuantity` en el libro de
inventario—. Guardarla hace baratas la pantalla de revisión y la reconciliación;
el `CHECK` impide que sea un cuarto número que alguien pueda escribir aparte.

`snapshotQuantity` no decide nada. Está para poder leer la línea: "empezó con 10,
cuando contaste había 8, contaste 7".

Ver [INVENTORY_COUNT_CONCURRENCY.md](INVENTORY_COUNT_CONCURRENCY.md) para de
dónde sale `expectedAtCount`.

## Segundo conteo

`recountThreshold` en la sesión. Nula es sin doble conteo.

Si `|variance| > umbral`, la línea queda en `RECOUNT` y hay que contarla de
nuevo. El primer conteo **no se pisa**: queda en `firstCountQuantity`, porque si
el primero dijo 4 y el segundo 17, esa diferencia es información sobre el conteo.

Se pide **una vez**. Pedirlo indefinidamente convertiría una diferencia real en
un bucle del que no se sale.

Es un número y una comprobación, no un motor de reglas: el mismo criterio que
`Branch.cashDifferenceThreshold`.

## Unidades sin partida identificada

Aparecen 3 unidades físicas de un producto que exige lote y nadie sabe de qué
partida son.

**No se inventa un código.** Nada de `UNKNOWN123`: sería exactamente el dato
falso con formato de dato real que este proyecto viene evitando desde que
`Product.cost` migró a `NULL` en vez de a cero.

La línea sin lote queda en **`UNRESOLVED`** y **la sesión no se puede aplicar**.
Para resolverla hay que decir de qué partida son: las unidades se suman a la
línea de ese lote y la línea sin partida queda en cero.

Si quien contó concluye que se equivocó, vuelve a contar esa línea en cero por el
camino normal —que deja las dos cifras registradas— en vez de descartarla.

## Aplicar

**Todo o nada.** Si una línea falla, no se aplica ninguna: una corrección de
inventario a medias es peor que ninguna, porque deja el depósito con la mitad de
los números corregidos y sin forma de saber cuál mitad.

**Se aplica el DELTA, nunca el número contado.** Es la regla del objetivo 28:

```
esperado al contar   8
contado              7
diferencia          -1

después del conteo se vende una unidad más → stock 7

aplicar:  INVENTORY_COUNT −1   →  7 → 6
NO:       stock = 7                       ← habría borrado esa venta
```

Una línea con diferencia cero **no emite movimiento**: un movimiento de cero
unidades ensucia el historial sin decir nada.

## `INVENTORY_COUNT`

Tipo propio en el libro, y **de los dos signos**. Eso es exactamente por qué no
es un `LOSS`: un sobrante contado no es una pérdida negativa, y mezclarlos haría
que el reporte de mermas mienta.

Es distinto de `MANUAL_ADJUSTMENT` —que también nace de un recuento— porque este
viene de un recorrido con conteo a ciegas, revisión y aplicación en bloque, y se
puede rastrear hasta su sesión: `referenceType = 'InventoryCountSession'`.

Y **no figura entre los tipos de ajuste manual**: si estuviera, cualquiera con
`stock.adjust` podría escribir la diferencia de un inventario que nadie contó.

## Alcance

`ALL`, `CATEGORY` o `SELECTION`.

**No hay ubicaciones ni posiciones físicas.** Este sistema no tiene un modelo de
depósito, y fabricar uno para poder decir "pasillo 3" sería inventar datos que
nadie cargó. Queda fuera de alcance, a propósito.

## Los cinco permisos

| Permiso                  | Quién                                    |
| ------------------------ | ---------------------------------------- |
| `inventoryCounts.view`   | todos los que miran                      |
| `inventoryCounts.create` | quien arma la sesión                     |
| `inventoryCounts.count`  | quien recorre el depósito                |
| `inventoryCounts.review` | quien cierra el conteo                   |
| `inventoryCounts.apply`  | quien convierte las diferencias en stock |

Cinco y no uno, porque un inventario tiene cuatro momentos que casi nunca hace la
misma persona, y **el sentido entero del mecanismo es que quien cuenta no sea
quien decide que la diferencia se aplique**.

Por eso el repositor tiene `create` y `count` pero no `review` ni `apply`, y el
supervisor al revés. Si contar y aplicar fueran el mismo permiso, cualquiera
podría hacer desaparecer mercadería escribiendo un número más chico.

## La reconciliación

`integrity:check`, comprobación **Inventarios físicos**:

```
variance  ==  Σ movimientos INVENTORY_COUNT     por (sesión, producto, lote)
```

Por producto **y lote**, no por sesión: dos líneas del mismo producto que se
compensaran entre sí darían una suma correcta con los dos movimientos mal.

Detecta las cuatro formas de que la aplicación salga mal —la diferencia que no se
aplicó, el movimiento duplicado, la cantidad incorrecta y la sesión aplicada dos
veces— porque las cuatro dan la misma desigualdad.

Más una segunda regla que mira del otro lado: un `INVENTORY_COUNT` que referencia
una sesión **no aplicada** es stock movido por un inventario que nadie aprobó.

## Qué no hace esta fase

- **No se revierte un inventario aplicado.** Se cuenta de nuevo.
- **No hay ubicaciones.** Ver arriba.
- **No hay conteo por lector de códigos**: se escribe la cantidad. El lector
  ayudaría, y es una función aparte.
- Una sesión abandonada **no caduca** y aparece en el listado hasta que alguien
  la cancele.
