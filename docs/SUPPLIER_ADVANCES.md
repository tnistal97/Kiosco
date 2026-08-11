# Anticipos a proveedores

## La pregunta que contesta este documento

Le entregamos $50.000 a un proveedor **antes** de que llegue la mercadería.
¿Dónde vive esa plata hasta que llega?

## Lo que un anticipo NO es

No es una entidad nueva. No hay tabla `SupplierAdvance`, no hay estado
`ANTICIPO`, no hay un campo `esAnticipo`.

Un anticipo es **un pago con saldo sin aplicar**, y nada más. Es la misma fila de
`SupplierPayment` que cualquier otro pago, con la única diferencia de que la suma
de sus imputaciones es menor que su importe.

Esa decisión hace falta explicarla, porque la alternativa es tentadora. Si el
anticipo fuera una entidad aparte habría dos formas de que un proveedor tenga
crédito nuestro —un anticipo, o un pago que sobró— y toda consulta tendría que
mirar las dos. Peor: habría que decidir, en el momento de pagar, en cuál de las
dos cajas entra la plata, y esa decisión se toma **antes** de saber si va a hacer
falta. Un pago de $50.000 sobre una deuda de $30.000 ¿es un pago con $20.000 que
sobran, o un pago de $30.000 y un anticipo de $20.000? Las dos respuestas son
razonables, y esa es exactamente la señal de que la pregunta está mal hecha.

Con un solo concepto la pregunta desaparece: hay un pago de $50.000, se le
imputaron $30.000, le quedan $20.000 disponibles.

## Los dos números derivados

```
allocatedAmount   = SUM(SupplierPaymentAllocation.amount) del pago
unallocatedAmount = SupplierPayment.amount - allocatedAmount
```

**Ninguno de los dos se guarda.** No hay columnas con esos nombres, y hay una
prueba que lo comprueba leyendo `information_schema`.

El motivo es el de siempre en este sistema: un número guardado que se deduce de
otra tabla es un número que puede mentir. Con la suma, `unallocatedAmount` no
puede quedar desactualizado, porque no existe hasta que alguien pregunta.

La invariante que sí se comprueba, en `integrity:check`:

```
SUM(imputaciones de un pago)  <=  el importe del pago
```

Es una **desigualdad**, no una igualdad, y eso es el punto: sub-imputar es
legítimo —eso es tener un anticipo— y sobre-imputar es imposible.

## Cómo se registra

`POST /api/suppliers/:id/pagos` con `imputacion: 'ninguna'`.

Las tres opciones de imputación son:

|              | Qué hace                                                                      |
| ------------ | ----------------------------------------------------------------------------- |
| `automatica` | Reparte FIFO entre las obligaciones abiertas. Lo que sobra queda sin imputar. |
| `manual`     | El reparto lo declara quien paga, entrega por entrega.                        |
| `ninguna`    | **No imputa nada.** Es el anticipo.                                           |

`ninguna` no es lo mismo que `manual` con la lista vacía, aunque el resultado sea
idéntico. Con la lista vacía, la bitácora dice "imputación manual, cero líneas" y
tres meses después nadie sabe si fue una decisión o un olvido. Con `ninguna`,
dice `ninguna`.

Y hay una diferencia real de comportamiento: `automatica` consumiría las deudas
abiertas que hubiera, que es exactamente lo que un anticipo **no** quiere hacer.

## Un anticipo exige `supplierAccounts.overpay`

Registrar un anticipo deja el saldo del proveedor negativo, así que pasa por la
misma puerta que cualquier sobrepago: `acceptCredit: true` **y** el permiso.

Que sea el mismo permiso es deliberado. Entregar plata que no se debe es la misma
decisión se llame como se llame, y darle un permiso propio al anticipo abriría el
camino de siempre: quien no puede sobrepagar, sobrepaga llamándolo anticipo.

## Aplicarlo después: la imputación diferida

`POST /api/suppliers/:id/pagos/:pagoId/imputar`, permiso
`supplierAccounts.allocate`.

**NO MUEVE EL SALDO.** Es la regla central del módulo y conviene decirla dos
veces: el saldo del proveedor bajó cuando se entregó la plata, en marzo. Volver a
bajarlo en agosto, al aplicarlo a una entrega, restaría dos veces la misma plata.

Lo único que cambia una imputación es **qué entrega figura como saldada**. El
saldo lo lleva el libro; la imputación es detalle. Ver
[SUPPLIER_PAYMENT_ALLOCATION.md](SUPPLIER_PAYMENT_ALLOCATION.md).

Por eso este camino no llama a `applySupplierAccountMovement` y no puede: escribe
una tabla de detalle, no el libro. Hay una prueba que cuenta los movimientos
antes y después de imputar y exige que sean los mismos.

## Aplicarlo al recibir

Al confirmar una recepción, si el proveedor tiene pagos sin imputar, la pantalla
muestra:

```
Crédito disponible del proveedor
$15.000
[ ] Aplicar automáticamente a esta entrega
```

**La casilla arranca apagada.** Aplicarlo en silencio haría que el saldo baje sin
que quien recibe entienda por qué, y que un anticipo reservado para otra compra
desaparezca sin aviso.

Si se marca, el consumo es **FIFO de pagos**: el más antiguo primero, y el `id`
como desempate. Es un criterio distinto del FIFO de deudas —que ordena por
vencimiento— porque la pregunta es otra: allá es "cuál hay que pagar antes"; acá
es "cuál de mis anticipos uso primero", y la respuesta natural es el que lleva
más tiempo esperando.

Los dos criterios son **determinísticos** y están probados, incluido el caso en
que la fecha y el `id` van en direcciones opuestas.

## Los dos topes, y por qué necesitan bloqueos

```
lo que se imputa  <=  lo que le queda al pago
lo que se imputa  <=  lo que le falta a la entrega
```

En el resto del sistema una condición así viaja **dentro** de la sentencia que
escribe: `balance + delta >= 0`, `quantity + delta >= 0`. Acá no se puede,
porque el tope no está en la fila que se escribe: es la suma de otra tabla.

La solución está en `src/modules/suppliers/imputacion.ts` y son **dos
sentencias**:

1. `SELECT ... FOR UPDATE` sobre la fila del pago. Nada más: esperar el turno.
2. **Recién después**, la suma de sus imputaciones.

Que sean dos importa, y de una forma que pasa todas las pruebas de a una: bajo
`READ COMMITTED` la instantánea se toma al **empezar** la sentencia, así que la
transacción que espera el bloqueo sumaría con una foto anterior a la escritura de
la que estaba esperando. Las dos leerían "queda todo" y las dos imputarían.
PostgreSQL reevalúa la **fila** bloqueada después de esperarla, pero no las
subconsultas.

Esto no es teoría: la primera versión de este módulo tenía el bloqueo y la suma
en una sola sentencia, pasaba todas las pruebas de integración, y la prueba de
concurrencia la encontró en la primera vuelta.

El orden de los bloqueos es parte del contrato: **primero los pagos, después las
entregas, los dos por id ascendente.** Dos peticiones que tomen los mismos
bloqueos en distinto orden se traban entre sí para siempre.

## Qué NO hace esta fase

- **No se devuelve un anticipo en efectivo.** Si un proveedor cierra y nos queda
  crédito, hoy se registra con un ajuste manual y su motivo.
- **No se reserva un anticipo para una compra futura concreta.** El crédito es
  del proveedor, no de una orden.
- **No caduca.** Un anticipo de hace dos años sigue disponible, y aparece en la
  lista de pagos sin imputar hasta que alguien lo aplique.

## Dónde se ve

- **Ficha del proveedor** → "Pagos sin imputar", con importe, ya imputado y
  disponible, y el botón `Imputar`.
- **Ficha del proveedor** → métrica "Pagos sin imputar", junto al saldo. Son dos
  números distintos: el saldo puede estar en cero y haber igual un anticipo sin
  aplicar, porque la deuda que lo compensa está en otra entrega.
- **Reporte de proveedores** → "Anticipos sin imputar", en la foto de hoy.
