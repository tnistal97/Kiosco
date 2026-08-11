# Imputación de pagos a proveedores

Fase 4B. Qué obligación cancela cada peso de un pago.

---

## 1. Qué responde esta tabla, y qué no

El libro dice **cuánto** le debemos a un proveedor. No dice **cuál** de las cuatro
entregas pendientes salda un pago de $50.000, y ésa es la pregunta que se hace
cuando el proveedor llama reclamando la del 12.

```
SupplierPaymentAllocation
  paymentId  →  SupplierPayment
  receiptId  →  PurchaseReceipt
  amount
```

Un pago de $50.000 puede cancelar:

```
Recepción #10:  $20.000
Recepción #11:  $30.000
```

y queda claro qué deuda pagó.

### La imputación es DETALLE, no verdad

**El saldo sale del libro y sigue saliendo del libro aunque un pago quede sin
imputar.** La asimetría es deliberada.

Si la imputación fuera la fuente del saldo, un **anticipo** —plata entregada
antes de que exista la obligación— no se podría registrar sin inventarle una
recepción. Y una recepción inventada es una mentira que después hay que
mantener.

Consecuencia práctica: hay **dos** números y significan cosas distintas.

|                            | De dónde sale            | Qué significa                   |
| -------------------------- | ------------------------ | ------------------------------- |
| `Supplier.balance`         | el libro                 | cuánto le debemos en total      |
| pendiente de una recepción | `total − Σ imputaciones` | cuánto falta de **esa** entrega |

La suma de los pendientes **puede no dar** el saldo, y no es un error: la
diferencia es exactamente lo que hay pagado sin imputar. La pantalla lo muestra
como "sin imputar" en vez de esconderlo.

---

## 2. Imputación automática: FIFO por vencimiento

Cuando se pulsa **Aplicar automáticamente**:

```sql
ORDER BY "dueDate" ASC NULLS LAST,
         "receivedAt" ASC,
         "id" ASC
```

Que en palabras es el orden del objetivo 23:

1. **la deuda vencida más antigua** — vencida quiere decir `dueDate` en el
   pasado, y "más antigua" es `dueDate` más chica: la primera del orden;
2. **la de vencimiento más cercano** — entre las no vencidas, otra vez `dueDate`
   más chica;
3. **la recepción más antigua** — para las que no tienen vencimiento, y como
   desempate.

Los dos primeros criterios **colapsan en uno**: ordenar por `dueDate` ascendente
ya pone primero lo vencido más viejo y después lo que vence antes. Escribirlos
como dos pasos separados daría el mismo resultado con más código.

### Determinística, y probado

`NULLS LAST` y el desempate por `id` no son adorno: sin ellos, dos obligaciones
del mismo día podrían imputarse en cualquier orden y **la misma operación daría
resultados distintos en dos corridas**. Una prueba compara el reparto contra una
lista escrita a mano, con empates a propósito.

El reparto es **hasta el pendiente de cada una y hasta agotar el pago**:

```
Pago $50.000

#10  vence 05/08  pendiente $20.000  →  imputa $20.000   (quedan $30.000)
#11  vence 09/08  pendiente $45.000  →  imputa $30.000   (queda $0)
#12  vence 20/08  pendiente $18.000  →  no llega
```

Lo que sobre después de cubrir todo lo pendiente **queda sin imputar**, no se
fuerza contra nada.

---

## 3. Imputación manual

Quien tiene el permiso puede **ajustar el reparto antes de confirmar**. El
servidor revalida las dos cosas, porque el navegador no decide:

```
Σ imputaciones          <=  SupplierPayment.amount
Σ imputado a una recepción  <=  su pendiente
```

Se comprueban **dentro de la transacción**, contra el pendiente leído en ese
momento. Comprobarlo antes de abrir la transacción dejaría pasar dos pagos
simultáneos que juntos cancelan dos veces el mismo importe pendiente —el cuarto
caso de concurrencia del objetivo 34.

Una imputación de importe cero se rechaza: no imputa nada y ocupa una fila.

---

## 4. Pago sin imputar (anticipo)

**Se permite.** Un pago puede quedar total o parcialmente sin imputar:

- porque se pagó más de lo que había pendiente (con `acceptCredit`);
- porque se entregó plata a cuenta antes de que llegue la mercadería;
- porque quien pagó no quiso repartirlo todavía.

En los tres casos el saldo del proveedor baja igual —lo mueve el libro— y el
excedente aparece como crédito nuestro.

### Lo que NO hace esta fase

**Imputar un anticipo a una recepción futura.** Hoy el excedente vive como saldo
a favor y **lo consume la próxima entrega sola**, porque el libro suma:

```
saldo   -5.000        (pagamos 5.000 de más)
recepción     +50.000
saldo   +45.000       ← la entrega nueva ya vino descontada
```

Eso cubre el caso económico. Lo que no cubre es dejar escrito que _ese_ pago del
martes canceló _esa_ entrega del jueves, que es trazabilidad y no plata.

Es la decisión que el objetivo 22 pedía documentar: **se soportan imputaciones
contra obligaciones que ya existen**, y la imputación diferida queda para 4C.
Complicarla ahora habría metido un estado nuevo —"crédito disponible para
imputar"— que hay que mantener sincronizado con el saldo, y dos números que
significan casi lo mismo es exactamente el problema que este módulo evita.

No se inventan imputaciones falsas para tapar el hueco.

---

## 5. Corregir una imputación

**No se edita y no se borra.** Hay un disparador en PostgreSQL que lo impide.

Es la puerta de atrás que sin ese disparador quedaría abierta: el pago es
inmutable, pero se podría mover su imputación de una entrega a otra y cambiar
cuál figura como pagada. El saldo no se movería —la imputación no lo decide— y
por eso mismo **no se notaría**.

Si una imputación quedó mal:

| Situación                           | Qué hacer                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| se imputó a la entrega equivocada   | registrar el pago que falta contra la correcta; la otra queda con su historia |
| el proveedor reconoce el error      | nota de crédito con motivo y referencia a su documento                        |
| hay que dejar constancia y nada más | ajuste manual con motivo                                                      |

---

## 6. Las dos reglas de reconciliación

De las siete que agrega la Fase 4B, dos son de esta tabla:

```
Σ allocations de un pago        <=  SupplierPayment.amount
Σ allocations de una recepción  <=  PurchaseReceipt.total
```

Ninguna de las dos es una igualdad, y eso es el punto: sobre-imputar es
imposible, sub-imputar es legítimo.

---

## 7. Documentos relacionados

- [SUPPLIER_ACCOUNT_LEDGER.md](SUPPLIER_ACCOUNT_LEDGER.md) — de dónde sale el saldo
- [SUPPLIER_PAYMENT_FLOW.md](SUPPLIER_PAYMENT_FLOW.md) — cómo se registra el pago
- [ACCOUNTS_PAYABLE_POLICY.md](ACCOUNTS_PAYABLE_POLICY.md) — vencimientos y estados
- [PHASE3_RECONCILIATION.md](PHASE3_RECONCILIATION.md) — el motor de comprobación
