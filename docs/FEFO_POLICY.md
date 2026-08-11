# FEFO: de qué lote sale la mercadería

## FEFO no es FIFO

```
FIFO   First In,      First Out   → sale primero lo que llegó primero
FEFO   First Expired, First Out   → sale primero lo que vence antes
```

No son lo mismo y confundirlos tira mercadería. El yogur que llegó el lunes puede
vencer en septiembre y el que llegó el miércoles el 18 de agosto: FIFO vendería el
de septiembre y dejaría vencer el otro.

Este sistema usa **FEFO** para el stock por lote. FIFO se sigue usando en otro
lugar y para otra cosa: para elegir qué deuda cancela un pago a proveedor, donde
la pregunta es "cuál vence antes" en el sentido financiero. Ver
[SUPPLIER_PAYMENT_ALLOCATION.md](SUPPLIER_PAYMENT_ALLOCATION.md).

## El orden, exacto

```sql
ORDER BY (l."expirationDate" IS NULL),   -- 1. los que vencen, antes
         l."expirationDate" ASC,          -- 2. el más próximo primero
         l."createdAt" ASC,               -- 3. el que entró antes
         l."id" ASC                       -- 4. desempate estable
```

**1 y 2 juntos** son la regla: primero los lotes con fecha, ordenados por
proximidad; después los sin fecha. En PostgreSQL `NULL` ordena al final con
`ASC NULLS LAST`, pero el `IS NULL` explícito dice la intención en el texto y no
depende de la opción por omisión del motor.

Que los **sin fecha vayan al final** es una decisión y admite el argumento
contrario —"si no sé cuándo vence, sacalo cuanto antes"—. Se eligió lo otro
porque un lote sin fecha es, casi siempre, un producto que **no vence**
(`expirationTracking = NONE`), y sacarlo antes que uno que vence en tres días es
exactamente el error que FEFO existe para evitar. Cuando conviven fechados y sin
fechar en el mismo producto, lo urgente siempre es el fechado.

**3 y 4** hacen que el orden sea **determinístico**. Dos lotes que vencen el
mismo día tienen que salir siempre en el mismo orden: sin esos dos criterios, dos
consultas idénticas devolverían repartos distintos y ninguna prueba podría fijar
el resultado.

## Los vencidos quedan afuera

FEFO **nunca** elige un lote vencido. No es un filtro de la pantalla: es parte de
la consulta, del lado del servidor.

```
Disponible: 10       BranchStock.quantity
Vencido:     3       lotes con expirationDate < hoy
Vendible:    7       lo que FEFO puede tomar
```

Una venta de 5 sobre ese stock **se rechaza**, aunque `BranchStock` diga 10. La
comprobación es del servidor y no de la caja: mirar sólo el agregado haría que el
POS crea que alcanza y lo descubra al cobrar.

`hoy` es **hoy en la sucursal** (`Branch.timeZone`), no hoy en el servidor. Ver
[LOT_EXPIRATION_POLICY.md](LOT_EXPIRATION_POLICY.md).

## Lo que FEFO promete, y lo que no

Esto hay que decirlo sin adornos, porque es la limitación real del mecanismo:

> **El sistema no sabe qué lote agarró el cajero.** Si las dos partidas tienen el
> mismo código de barras —y lo tienen casi siempre— el lector devuelve el mismo
> número para las dos.

FEFO no es una lectura física: es una **política operativa de rotación**. Lo que
el sistema afirma es "de acá tendría que haber salido", no "de acá salió".

Esa afirmación es útil igual, y por dos motivos:

1. **Es la que se quiere que sea verdad.** El depósito se ordena para que salga
   primero lo que vence antes, y el sistema descuenta con el mismo criterio. Si
   el local respeta la rotación, la cifra es correcta.
2. **Es la única alternativa razonable a no saber nada.** Sin FEFO, el stock por
   lote no se podría descontar, y entonces no habría stock por lote.

Lo que **no** se hace es esconderlo. Está escrito acá, está en la pantalla del
lote —"reparto por política de rotación"— y es el motivo del punto siguiente.

## Elegir el lote a mano

Existe, exige permiso (`lots.adjust`) y **no está en el flujo normal de la caja**.

Que un cajero tenga que elegir partida en cada producto convertiría una venta de
quince artículos en quince decisiones, y la respuesta sería siempre la primera
opción: un tramite que nadie lee es peor que no tenerlo.

Sirve para lo que sirve de verdad: **corregir**. Alguien se dio cuenta de que la
mercadería que se llevó era del otro lote, o hay que sacar de una partida
concreta por un motivo puntual. Entonces se elige, y queda auditado.

En el POS aparece sólo cuando el producto tiene lotes y quien atiende tiene el
permiso. Para todos los demás, y para todo producto sin rastreo, el flujo es
exactamente el de siempre.

## Cómo se aplica, y por qué el orden importa dos veces

FEFO decide **leyendo**; el stock se descuenta **escribiendo**. Son dos momentos
y dos órdenes distintos:

```
1. LEER    los lotes vendibles, en orden FEFO      → el reparto
2. ESCRIBIR ese reparto, ordenado por lotId        → los bloqueos
```

Escribir en orden FEFO sería el interbloqueo clásico: dos cajas vendiendo los
mismos dos productos en distinto orden se traban entre sí. Reordenar por `lotId`
antes de escribir es lo que garantiza que todas las transacciones tomen los
bloqueos en el mismo orden.

Es la misma regla que la Fase 0.5 puso para los productos (`consolidar` los
ordena por `productId`) y la que la Fase 4C puso para pagos y entregas. Ver
[LOT_TRACKING_DESIGN.md](LOT_TRACKING_DESIGN.md).

Y el reparto **se recalcula dentro de la transacción**, nunca se acepta del
navegador: entre que la pantalla muestra el stock y el usuario cobra, otra caja
puede haber vaciado el lote.

## La anulación NO recalcula

Una venta anulada devuelve la mercadería **a los mismos lotes de los que salió**,
leyendo `SaleItemLotAllocation`.

Recalcular FEFO en la anulación sería un error silencioso y grave: diez días
después, el lote que vencía mañana ya venció, y FEFO elegiría otro. Las tres
unidades volverían a una partida que nunca las tuvo, y el lote vencido quedaría
con un faltante que nadie puede explicar.

## Qué sigue usando el agregado

`BranchStock.quantity` sigue siendo la verdad del producto y sigue siendo lo que
`applyStockMovement` protege con su `quantity + delta >= 0`. FEFO decide **de
dónde**, no **cuánto**: si el reparto sale mal, la venta falla igual por el
agregado.

Las dos condiciones se aplican en la misma transacción y las dos tienen que dar.
