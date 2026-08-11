# Devoluciones: el efecto en la cuenta del proveedor

Este documento contesta tres preguntas que el circuito físico no contesta:

1. ¿a qué costo se acredita una devolución?
2. ¿qué pasa si la entrega ya estaba pagada?
3. ¿qué pasa con las imputaciones que ya existían?

Para el circuito físico —estados, topes, stock— ver
[PURCHASE_RETURN_FLOW.md](PURCHASE_RETURN_FLOW.md).

## 1. El costo es el congelado en la recepción

```
La caja entró a  $1.100
Hoy Product.cost $1.350
Se devuelven      8 cajas

Crédito:  8 × $1.100 = $8.800
NO:       8 × $1.350 = $10.800
```

El proveedor acredita **lo que cobró**. Usar el costo de hoy sería reescribir el
pasado, y además convertiría cada aumento de precios en una ganancia por
devolver.

El costo viaja desde `PurchaseReceiptItem.unitCost` a
`PurchaseReturnItem.unitCost` al **crear el borrador**, y se congela ahí. Nunca
se acepta del navegador: aceptarlo permitiría declarar que una caja de $1.100
vale $1.350, y el crédito sería por plata que el proveedor nunca cobró.

La reconciliación lo comprueba: `devolucionesContraLoRecibido` compara el costo
de cada renglón contra el de su línea de recepción y marca cualquier diferencia.

## 2. El crédito

Al confirmar se emite **un** `PURCHASE_CREDIT` negativo, por el total de la
devolución, con `returnId` apuntando a ella.

`returnId` es una **clave foránea, no un texto**. Con el texto, "¿qué crédito
emitió DV-00000124?" se contesta leyendo frases, y "¿el importe del crédito
coincide con el de la devolución?" no se puede contestar. Con la clave, las dos
son una unión, y la segunda es una de las reconciliaciones de esta fase.

**Un crédito por devolución, estructuralmente**: hay un índice único parcial
sobre `returnId`. Un reintento de la confirmación —el navegador que pierde la
respuesta y vuelve a mandar— choca contra la base y no contra una comprobación
nuestra.

### Puede dejar el saldo negativo sin pedir autorización

Igual que la nota de crédito, y por el mismo motivo: **la mercadería ya salió del
depósito**. Es un hecho consumado, no una decisión que se esté tomando ahora.
Rechazarlo obligaría a no registrar la devolución o a partirla en dos.

Lo que restringe el camino es `purchaseReturns.confirm`.

## 3. Devolver lo ya pagado

El caso del objetivo 15, entero:

```
1. Recepción   $100.000   →  saldo  100.000
2. Pago        $100.000   →  saldo        0
3. Devolución   $20.000   →  saldo  -20.000
```

**Tenemos crédito a favor.** El pago anterior **no se modifica ni se borra**: es
inmutable y sigue diciendo lo que dijo siempre. El saldo lo corrige el movimiento
nuevo, que es como se corrige todo en este sistema.

## 4. Las imputaciones NO se mueven

Y acá está la decisión que hacía falta tomar.

Después del caso de arriba, la entrega queda así:

```
Importe original      $100.000
Devoluciones           $20.000
Obligación neta        $80.000
Pagado / imputado     $100.000
Pendiente                   $0
Exceso                 $20.000   ← a favor
```

Lo imputado ($100.000) **supera** la obligación neta ($80.000).

La alternativa era reducir la imputación de $100.000 a $80.000 y liberar $20.000
del pago. Se descartó:

- **Una imputación es inmutable.** Hay un disparador que lo hace cumplir desde la
  Fase 4B, y por un buen motivo: si se pudieran editar, se podría mover plata de
  una entrega a otra sin que el saldo se moviera, y por lo tanto sin que nada se
  notara.
- **El hecho ocurrió.** El 12 de marzo se aplicaron $100.000 a esa entrega. Que
  después haya vuelto mercadería no cambia lo que se hizo ese día.
- **El saldo global ya está bien.** El libro dice $-20.000, que es la verdad. La
  imputación es detalle, no verdad; ver
  [SUPPLIER_PAYMENT_ALLOCATION.md](SUPPLIER_PAYMENT_ALLOCATION.md).

### Cómo se muestra

`pendiente` **nunca es negativo**, y `exceso` es su contracara:

```
pendiente = MAX(neto - imputado, 0)
exceso    = MAX(imputado - neto, 0)
```

Los dos números van por separado a propósito. Un pendiente negativo se suma mal
—restaría de lo que se debe por otras entregas— y además se lee como si faltara
plata cuando lo que sobra es crédito.

En pantalla, el exceso aparece en su propia línea y con su palabra: "a favor". Un
pendiente en cero, solo, haría pensar que la entrega quedó justa.

## 5. La obligación neta baja para todo lo demás

Desde la devolución, la entrega debe $80.000 y no $100.000. Eso vale para:

- la **tabla de deudas abiertas** de la ficha del proveedor;
- el **FIFO** de la imputación automática: no se le puede imputar más de $80.000;
- el **tablero** de cuentas por pagar y el **reporte** de proveedores;
- el **vencido**: una entrega devuelta entera deja de reclamarse aunque nunca se
  haya pagado.

Sólo cuentan las devoluciones **CONFIRMADAS**. Un borrador no sacó mercadería ni
emitió crédito.

## 6. La reconciliación

Tres comprobaciones nuevas, en `integrity:check`:

**Devoluciones** (`devolucionesContraSusEfectos`) — tres igualdades:

```
el importe de la devolución  ==  suma de sus renglones
lo que salió del depósito    ==  lo que la devolución dice que sale
el crédito al proveedor      ==  el importe de la devolución
```

Más una cuarta regla: un crédito que apunta a una devolución **no confirmada**
sería plata acreditada por mercadería que nunca salió.

**Cantidades devueltas** (`devolucionesContraLoRecibido`) — una desigualdad y una
igualdad:

```
suma de lo devuelto de una línea  <=  lo recibido
el costo de cada renglón          ==  el congelado en la recepción
```

**Imputaciones** (`imputacionesContraSusTopes`, ampliada) — el tope de una
entrega es su **importe original**, no el neto.

### La regla que parece faltar, y por qué no falta

El objetivo 24 pide comprobar que lo imputado no supere la obligación **neta**,
"o documentar expresamente el caso válido de exceso causado por devolución
posterior".

Está documentado —es la sección 4— y hay algo más: escrita como regla aparte
sería una comprobación **que no puede fallar nunca**. La cuenta lo dice en una
línea:

```
exceso        = imputado - (total - devuelto)
exceso > devuelto  ⟺  imputado - total + devuelto > devuelto
                   ⟺  imputado > total
```

Es decir: exactamente la regla del importe original, que sí está. Escribirlas
como dos daría el mismo código inalcanzable disfrazado de defensa que la Fase 4B
tuvo que borrar del pago, y además informaría dos veces el mismo descuadre.

Hay una prueba que **fija esa equivalencia**
(`reconciliacion-devoluciones.test.ts`). Si algún día deja de valer —porque el
neto pase a descontar algo más que las devoluciones— va a fallar, y ahí sí va a
hacer falta la segunda regla.

## 7. Los reportes no mezclan bruto con neto

```
Recibido bruto   $500.000    todo lo que entró por la puerta
Devuelto          $80.000
Compras netas    $420.000    lo que se quedó
```

Las tres en columnas separadas. Son dos preguntas distintas: cuánta mercadería
manejó el depósito, y cuánto costó el mes. Mostrar sólo el neto esconde el
movimiento; sólo el bruto miente sobre el costo.

`devuelto` se mide por la **fecha de confirmación** de la devolución, no por la
de la entrega que deshace. Una entrega de marzo devuelta en abril baja las
compras de abril: es cuando salió la mercadería y cuando nació el crédito. El
reporte de marzo ya se leyó, y reescribirlo hacia atrás haría que el mismo rango
diera números distintos según cuándo se consulte.

En el reporte de proveedores, `devuelto` es un **subconjunto** de
`notasDeCredito`: toda devolución confirmada emite un `PURCHASE_CREDIT`, así que
ya está contada ahí. Se separa porque son dos hechos distintos —uno movió
mercadería y el otro sólo papeles— y la diferencia entre las dos cifras es
exactamente el crédito que el proveedor emitió sin que nada volviera.
