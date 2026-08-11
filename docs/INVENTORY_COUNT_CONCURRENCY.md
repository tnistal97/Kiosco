# Contar sin cerrar el local

## El problema

```
Se inicia el inventario   el sistema dice 10
Se vende                  -2
El operario cuenta         8
```

**Eso no es una diferencia de −2.** Lo esperado cuando contó eran 8, y contó 8:
la diferencia es cero.

Un inventario que compare contra el stock del inicio da diferencias falsas de
todo lo que se vendió mientras se contaba. Y la alternativa —cerrar el local para
inventariar— es un inventario que no se hace nunca.

## La solución: `expectedAtCount`

Cada línea guarda **cuánto esperaba el sistema en el momento de contar**, no al
empezar. Se escribe en la misma transacción que guarda el conteo.

```
variance = countedQuantity − expectedAtCount
```

## De dónde sale ese número

El objetivo lo plantea así:

```
expectedAtCount = snapshot + movimientos ocurridos entre snapshot y countedAt
```

y admite "una estrategia matemáticamente equivalente". Este sistema usa la
equivalente, y conviene decir por qué **no es un atajo sino lo correcto**.

Se lee **el saldo actual** —`BranchStock.quantity`, o `BranchLotStock.quantity`
cuando la línea tiene lote— dentro de la transacción que escribe el conteo.

Esa lectura **es** la suma pedida. Por la invariante de la Fase 3A:

```
BranchStock.quantity == Σ StockMovement.quantity
```

Y por lo tanto:

```
saldo_ahora == snapshot + Σ movimientos posteriores al snapshot
```

Que es exactamente la fórmula del objetivo.

## Por qué es MEJOR que sumar por fecha

La diferencia aparece bajo concurrencia, y es real.

Sumar `StockMovement` filtrando por `createdAt > snapshotAt` usa el **orden de
los relojes**. Una transacción que empezó antes puede confirmar después: su fila
tiene una marca de tiempo vieja y aparece en la base recién más tarde. Sumando
por fecha, esa venta se cuenta o no según el instante exacto en que corra la
consulta, y dos ejecuciones seguidas dan números distintos.

Leer el saldo usa el **orden de los commits**, que es el único que describe lo que
de verdad hay en el depósito. Y como la lectura ocurre dentro de la transacción
que escribe la línea, es atómica: no hay ventana entre "cuánto había" y "quedó
registrado que había eso".

Además es una consulta por línea en vez de una agregación sobre el historial.

## Contar mientras se vende: qué se garantiza y qué no

**Se garantiza** que la diferencia registrada es contra el stock del instante en
que se guardó el conteo.

**No se garantiza** que sea contra el stock del instante en que el operario miró
la góndola. Entre que cuenta con la mano y aprieta el botón pueden pasar
segundos, y en esos segundos puede haber una venta.

Eso es una limitación **física**, no del modelo: ningún sistema puede saber
cuándo alguien miró un estante. Lo que sí se puede es acortar la ventana —cargar
el conteo apenas se cuenta— y eso es lo que la pantalla favorece: una caja de
texto por línea, sin un botón "guardar todo" al final del recorrido.

## Aplicar: el delta, no el número

```
esperado al contar    8
contado               7
diferencia           -1

después del conteo se vende una unidad más  →  stock 7

aplicar:  INVENTORY_COUNT −1   →   7 → 6
```

Escribir `stock = 7` habría **borrado esa venta**. La corrección es de una
unidad, y una unidad es lo que se aplica, sobre el stock que haya en ese momento.

Es la misma regla que gobierna todo el sistema desde la Fase 3A: el stock no se
fija, se mueve.

## Dos inventarios sobre el mismo producto

Se permite. Prohibirlo obligaría a serializar el depósito entero, que es la
versión burocrática de cerrar el local.

Lo que **no** puede pasar es que los dos apliquen la misma diferencia:

```
Sesión A cuenta 9 sobre 10  →  diferencia -1
Sesión B cuenta 9 sobre 10  →  diferencia -1     (la misma unidad que falta)

A aplica  →  stock 9
B aplica  →  stock 8         ← MAL: falta una unidad, no dos
```

La regla que lo detecta es precisa: **una línea cuyo `countedAt` es anterior a un
`INVENTORY_COUNT` ya aplicado por OTRA sesión sobre el mismo producto no se puede
aplicar.** Significa que la corrección de alguien más llegó después de que esta
sesión contara, y por lo tanto su diferencia está vencida.

Se rechaza con `COUNT_SUPERSEDED` y el mensaje dice qué inventario la pisó y qué
hay que hacer: volver a contar los productos afectados.

## Por qué hacen falta DOS sentencias

La comprobación de arriba es una **suma sobre otra tabla**, así que no cabe
dentro del `UPDATE` que escribe. Se hace con bloqueo, y el orden importa:

```
1.  SELECT ... FOR UPDATE  sobre las filas de BranchStock.  NADA MÁS.
2.  RECIÉN DESPUÉS, buscar los INVENTORY_COUNT ajenos, en su propia sentencia.
```

Que sean dos no es estilo. Bajo `READ COMMITTED` la instantánea se toma **al
empezar la sentencia**, así que la transacción que espera el bloqueo buscaría con
una foto anterior a la escritura de la que estaba esperando: las dos verían "no
hay corrección ajena" y las dos aplicarían. PostgreSQL reevalúa la **fila**
bloqueada después de esperarla, pero no las subconsultas.

Es la misma lección que la Fase 4C aprendió en las imputaciones de pagos, donde
la primera versión pasaba las 24 pruebas de integración y la de concurrencia la
encontró en la primera vuelta. Ver [SUPPLIER_ADVANCES.md](SUPPLIER_ADVANCES.md).

El bloqueo se toma sobre `BranchStock` **por `productId` ascendente**: es el
punto de encuentro de las dos transacciones y el orden es parte del contrato.

## Las pruebas

`tests/concurrency/lotes.test.ts`, cuarto caso: dos sesiones cuentan 9 sobre 10 y
aplican a la vez. Una entra, la otra devuelve `COUNT_SUPERSEDED`, y el stock
termina en 9 y no en 8.

`tests/integration/inventario-fisico.test.ts` recorre el ejemplo entero del
objetivo, con la venta en el medio y la segunda venta antes de aplicar.
