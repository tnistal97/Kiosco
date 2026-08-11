# Política de cuentas por pagar

Fase 4B. Cuándo nace una deuda con un proveedor, por cuánto, cuándo vence y qué
estado tiene.

---

## 1. La deuda nace de la RECEPCIÓN

```
Proveedor → Orden de compra → Recepción → deuda
                              ^^^^^^^^^
```

**No de la orden.** Una orden de compra es un pedido: se puede cancelar, el
proveedor puede mandar la mitad, puede no mandar nada. Nada de eso se debe.

Lo que se debe es **lo que llegó**, y lo que llegó es una `PurchaseReceipt`.

### Una orden con dos entregas produce dos obligaciones

```
Orden:              5 cajas × $8.800 = $44.000

Primera recepción:  3 cajas          = $26.400   →  cargo +26.400
Segunda recepción:  2 cajas          = $17.600   →  cargo +17.600
                                                    ────────────
Saldo del proveedor                                     $44.000
```

Cada una con su **propio vencimiento**, porque llegaron en días distintos y el
plazo corre desde cada entrega. Meterlas en una sola obligación al nivel de la
orden haría que la primera venciera tarde o la segunda temprano.

---

## 2. El importe es el REAL, no el esperado

```
Orden esperada:   $100.000
Recepción real:   $104.500
Cuenta proveedor: +$104.500        ← no +100.000
```

Deuda es **lo que hay que pagar**. Si la factura vino a $104.500, se le deben
$104.500.

La diferencia contra lo pedido no desaparece: sigue línea por línea en
`PurchaseReceiptItem.expectedUnitCost`, se audita aparte desde la Fase 3C y el
reporte de compras la muestra. Pero es una _diferencia de costo_, no una deuda
menor.

`PurchaseReceipt.total` guarda ese importe, calculado por el servidor como
`sum(round(receivedQuantity × unitCost, 2))` — línea por línea y después la
suma, en ese orden y no al revés, que es como se arma una factura.

---

## 3. Una recepción, un cargo. Estructuralmente

```sql
CREATE UNIQUE INDEX "SupplierAccountMovement_un_cargo_por_recepcion"
  ON "SupplierAccountMovement"("receiptId")
  WHERE "type" = 'PURCHASE_CHARGE';
```

Un servicio que comprueba antes de escribir **no alcanza**: entre el `SELECT` y
el `INSERT` cabe otra transacción, y un reintento del navegador sobre una
petición que ya había entrado dejaría la deuda duplicada.

Una deuda duplicada no se nota. El saldo queda mal y todo lo demás parece bien.

---

## 4. El vencimiento

### Plazo del proveedor → vencimiento de la obligación

`Supplier.defaultPaymentTermDays` **sugiere**; `PurchaseReceipt.dueDate`
**congela**.

```
Recepción:   10/08
Condición:   30 días
Vence:       09/09        ← queda escrito en la recepción
```

Si mañana se le baja el plazo al proveedor a 15 días, **esa deuda sigue
venciendo el 09/09**. Es el objetivo 19, y es la diferencia entre un dato de
configuración y un hecho: el acuerdo que regía cuando llegó la mercadería no
cambia porque cambie la ficha.

### `NULL` no es una fecha

| Valor                           | Qué afirma                                        |
| ------------------------------- | ------------------------------------------------- |
| `defaultPaymentTermDays = NULL` | nadie declaró el plazo. No se sugiere vencimiento |
| `defaultPaymentTermDays = 0`    | se le paga contra entrega. Vence el mismo día     |
| `dueDate = NULL`                | nadie cargó un vencimiento para esta entrega      |

Una obligación con `dueDate = NULL` **nunca aparece como vencida** y va **última**
en la imputación automática. No se le inventa un plazo: inventarlo sería
inventar una fecha de reclamo.

Es el mismo par de afirmaciones que `Client.creditLimit` en la Fase 4A, y el
mismo error que se evita: con `DEFAULT 30`, todo proveedor nacería con un plazo
que nadie pactó.

### Esto NO es el vencimiento del producto

Es cuándo hay que pagar, no cuándo la mercadería deja de servir. El vencimiento
de producto es otra fase y otra tabla.

---

## 5. Los estados, derivados

Nunca se guardan. El objetivo 20 lo pide explícitamente y tiene razón: un
booleano `vencida` es verdadero hasta que pasa la medianoche, y a partir de ahí
miente hasta que algo lo recalcule.

```
pendiente = total − suma(imputaciones)

PAGADA     pendiente == 0
VENCIDA    pendiente > 0  y  dueDate < hoy (día comercial de la sucursal)
PARCIAL    pendiente > 0  y  ya se pagó algo
PENDIENTE  el resto
```

`VENCIDA` gana sobre `PARCIAL` a propósito: lo primero que hay que ver de una
deuda vencida a medio pagar es que está vencida.

**"Hoy" es el día comercial de la sucursal**, no el del servidor. Sale de
`Branch.timeZone` por `hoyEnSucursal()`, igual que todo lo demás desde la Fase
3D. Ver [TIMEZONE_POLICY.md](TIMEZONE_POLICY.md).

**No dependen sólo del color.** Cada estado se muestra con su palabra además del
color; la fila vencida lleva además un ícono. Un semáforo sin texto es
inaccesible para quien no distingue rojo de verde, y ilegible impreso en blanco
y negro.

---

## 6. Comprar al contado NO evita la deuda

```
Recepción:              $50.000
Pago inmediato efectivo: $20.000

PURCHASE_CHARGE  +50.000
PAYMENT          -20.000
                 ────────
saldo             30.000
```

Primero nace el cargo, después se registra el pago. **Siempre**, incluso cuando
se paga el total en el momento.

Es el objetivo 17 y es la decisión que hace que el historial sirva: si "pagado al
contado" saltara el cargo, la cuenta del proveedor no tendría ni la entrega ni el
pago, y la pregunta "¿cuánto le compramos este año?" tendría que responderse
desde otra tabla. El saldo final es el mismo; la historia, no.

---

## 7. Migración: no se inventa deuda histórica

**En producción no se genera ninguna deuda para las recepciones anteriores a
esta fase.** Es el objetivo 36 y es la decisión segura.

Una entrega de hace seis meses casi con seguridad ya se pagó —por
transferencia, en efectivo, en una cuenta que nadie llevaba en este sistema— y
darla por impaga le inventaría al almacén una deuda que no tiene.

El caso contrario —que quede deuda vieja sin registrar— se corrige con un
**ajuste manual con motivo**: una operación que existe, que deja rastro y que
hace una persona que sabe cuánto se debe de verdad.

### `debtRecorded`: la columna que hace la diferencia visible

Una recepción sin cargo puede ser dos cosas opuestas:

1. es anterior al módulo — **correcto**;
2. alguien escribió una recepción por fuera del servicio — **hay que gritarlo**.

Las dos se ven igual. `PurchaseReceipt.debtRecorded` las separa, y hace la
invariante exacta **en las dos direcciones**:

```
debtRecorded = true   <=>   existe exactamente un PURCHASE_CHARGE suyo
```

Es dato redundante —se deduce de la otra tabla— y por eso mismo la
reconciliación lo comprueba en los dos sentidos. Un booleano que se cree sin que
nadie lo controle es peor que no tenerlo.

En el seed de demostración sí se crean datos explícitos, con sus cargos y sus
vencimientos, porque ahí la deuda es inventada a propósito y se sabe.

---

## 8. Lo que falta (Fase 4C en adelante)

Anotado acá para que no se lea como un olvido:

- **Devolución física al proveedor.** Esta fase tiene la corrección _financiera_
  —la nota de crédito— y el movimiento de stock por los caminos que ya existen.
  No se finge que sea una devolución formal. La extensión natural es un tipo
  `PURCHASE_RETURN` que mueva stock y cuenta en la misma transacción.
- **Aplicar un anticipo a una recepción futura.** Hoy el excedente vive como
  saldo a favor y lo consume la próxima entrega sola; imputarlo explícitamente a
  una obligación que todavía no existe es 4C. Ver
  [SUPPLIER_PAYMENT_ALLOCATION.md](SUPPLIER_PAYMENT_ALLOCATION.md).
- **Conciliación bancaria**, **contabilidad general** y **ARCA**: fuera de alcance
  por pedido explícito.

---

## 9. Documentos relacionados

- [SUPPLIER_ACCOUNT_LEDGER.md](SUPPLIER_ACCOUNT_LEDGER.md) — el libro y sus signos
- [SUPPLIER_PAYMENT_FLOW.md](SUPPLIER_PAYMENT_FLOW.md) — cómo se paga
- [SUPPLIER_PAYMENT_ALLOCATION.md](SUPPLIER_PAYMENT_ALLOCATION.md) — a qué se imputa
- [PURCHASE_RECEIVING.md](PURCHASE_RECEIVING.md) — la recepción, paso por paso
- [CREDIT_POLICY.md](CREDIT_POLICY.md) — la política espejo, con los clientes
- [TIMEZONE_POLICY.md](TIMEZONE_POLICY.md) — de dónde sale "hoy"
