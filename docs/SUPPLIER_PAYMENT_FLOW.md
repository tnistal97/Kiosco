# Cómo se le paga a un proveedor

Fase 4B. Qué pasa, en qué orden y qué se confirma junto, cuando se registra un
pago a un proveedor.

---

## 1. Todo junto o nada

`registrarPagoAProveedor()` en
[`src/modules/suppliers/service.pagos.ts`](../src/modules/suppliers/service.pagos.ts).

Una transacción. Cinco cosas, y ocurren juntas o no ocurre ninguna:

| #   | Qué                                            | Cuándo                         |
| --- | ---------------------------------------------- | ------------------------------ |
| 1   | el turno, si la plata sale del cajón           | sólo `CASH`                    |
| 2   | el comprobante (`SupplierPayment`)             | siempre                        |
| 3   | el movimiento del libro, que baja el saldo     | siempre                        |
| 4   | las imputaciones (`SupplierPaymentAllocation`) | si hay obligaciones que cubrir |
| 5   | el egreso de caja                              | sólo `CASH`                    |

No existe forma de crear un pago sin su movimiento de cuenta: es la misma
transacción y **no hay otro camino que escriba `SupplierPayment`**.

El turno se pide **antes de mover nada**, igual que en la venta y por el mismo
motivo: rechazar el pago después de haber bajado el saldo obligaría a
devolverlo.

---

## 2. Los medios, y qué toca cada uno

```
CASH      →  baja el saldo del proveedor  Y  saca plata del cajón
TRANSFER  →  baja el saldo del proveedor.  El cajón NO se mueve
CARD      →  baja el saldo del proveedor.  El cajón NO se mueve
OTHER     →  baja el saldo del proveedor.  El cajón NO se mueve
```

Es el objetivo 15 y es la regla que más se confunde en la práctica: **una
transferencia bancaria no es el efectivo del cajón**. Anotarla en la caja haría
que el cierre del turno diera faltante todos los días.

La pantalla lo dice antes de confirmar, con todas las letras, para que quien
paga no tenga que deducirlo.

### `ACCOUNT` no existe acá

Pagarle la cuenta al proveedor con su propia cuenta no significa nada. Es la
misma exclusión que en el cobro al cliente. La base la hace cumplir con un
`CHECK` de lista blanca.

### `DEBIT_CARD` y `CREDIT_CARD` tampoco

Al proveedor se le paga con **la tarjeta del negocio**, y quien registra el pago
no siempre sabe —ni le importa— cuál de las dos era. `CARD` dice lo que se sabe.
Separarlas el día que haga falta es agregar dos valores a un `CHECK`.

Es una diferencia deliberada con el cobro al cliente, donde sí se distinguen:
ahí la tarjeta es del cliente y el débito y el crédito acreditan distinto.

---

## 3. El turno

**El efectivo sale del cajón, y del cajón de un turno.**

Lo hace cumplir `turnoParaOperar()`, el **mismo** camino por el que pasan la
venta en efectivo y el cobro a un cliente. Y eso significa que respeta
`Branch.requireOpenShift`: una sucursal que todavía no adoptó los turnos puede
pagar en efectivo sin uno, exactamente como puede vender.

### Por qué no hay un `CHECK` que lo obligue siempre

Se evaluó y se descartó. Un `CHECK` de `method <> 'CASH' OR cashShiftId IS NOT
NULL` volvería la regla absoluta y **contradiría a la sucursal**: en un local con
los turnos apagados se podría vender en efectivo pero no pagarle al proveedor en
efectivo. Es una diferencia que nadie pidió y que no protege nada — sin turnos no
hay cierre contra el cual el egreso pudiera faltar.

"Alinear con la política existente", que es lo que pide el objetivo 16, es
exactamente **no escribir esa restricción**.

Al revés no se prohíbe: un pago por transferencia _puede_ tener turno —se hizo
durante uno— y eso es información útil. Lo que no puede es afectar el efectivo, y
de eso se encarga el servicio.

---

## 4. El vínculo con la caja es una clave foránea

```
CashRegisterMovement.supplierPaymentId  →  SupplierPayment.id
```

Tercera columna de este tipo, después de `saleId` (Fase 3) y `customerPaymentId`
(Fase 4A). La reconciliación de "todo pago en efectivo tiene su egreso de caja"
une las dos tablas **por la clave foránea**, no buscando el número de
comprobante dentro de `description` con un `LIKE`.

Un `description` es para leerlo en el listado del turno. No es para unir tablas:
cambiar el texto de un mensaje no debería poder romper una comprobación de
integridad.

El importe del movimiento de caja va **negativo**: la plata sale. El signo lo
decide el servidor a partir del tipo, nunca el navegador.

---

## 5. Numeración

```
PP-00000128
```

Sale de una **secuencia de PostgreSQL**, no de `count() + 1`, por lo mismo que
`OC-` y `RC-`: dos personas pagando en el mismo segundo leerían el mismo
`count()` y el índice único rechazaría a una de las dos con un error que habla de
una restricción en vez de decir "volvé a intentar".

`nextval()` es atómico y no bloquea. **Deja huecos** —una transacción que se
deshace se lleva su número— y está bien: es una etiqueta para decir "el pago
PP-128" por teléfono, no un contador de cuántos pagos hubo.

Se pide **fuera** de la transacción a propósito: `nextval` no se deshace con un
`ROLLBACK`, así que pedirlo adentro no evitaría el hueco y sólo alargaría la
transacción.

El prefijo es `PP` de _pago a proveedor_. No es `OP` ni `PA`: ninguno se
distingue de un vistazo de `OC` en una lista donde las dos cosas aparecen juntas,
y una etiqueta que hay que leer dos veces no sirve para nombrar algo por
teléfono.

---

## 6. Pago total: el servidor revalida

La pantalla ofrece **Pagar saldo total**, y manda el importe. El servidor **no le
cree**: vuelve a leer el saldo y comprueba.

Es el objetivo 10, y no es paranoia. Entre que la pantalla se cargó y que alguien
pulsa el botón puede haber entrado una recepción nueva: el "total" que muestra el
navegador ya no es el total. Si el servidor confiara, pagaría de menos sin
avisar.

---

## 7. Sobrepago: se permite, nunca en silencio

```
Le debemos:  $20.000
Pagamos:     $25.000
Saldo:       -$5.000     ← crédito nuestro con el proveedor
```

Sin `acceptCredit`, la operación se rechaza con un **409** que dice cuánto sobra:

> A Bebidas Andinas se le deben $20.000 y esto lo dejaría en -$5.000: quedarían
> $5.000 a favor nuestro. Confirmá para registrarlo así.

Y además exige el permiso **`supplierAccounts.overpay`**. Es más estricto que el
sobrepago del cliente, que sólo pide confirmación, y la diferencia es real: ahí
el cliente pone plata de más sobre el mostrador y rechazarla sería absurdo; acá
**somos nosotros los que entregamos de más**, y eso es una decisión, no un hecho
consumado.

La comprobación ocurre **dos veces**: una antes de abrir la transacción, para
poder decir cuánto sobra sin haber tocado nada, y otra **dentro** del `UPDATE …
RETURNING`, bajo el bloqueo de fila. Sin la segunda, dos pagos simultáneos
dejarían un saldo a favor que nadie confirmó.

---

## 8. El comprobante

**Interno y no fiscal.** Dice _"Documento no fiscal"_ y en ninguna parte dice
"factura". No hay ARCA en esta fase.

Lleva:

- proveedor, número, fecha, importe y medio;
- **las obligaciones canceladas**, una por línea, con cuánto le tocó a cada una;
- saldo anterior y saldo posterior;
- quién lo registró.

El saldo anterior y el posterior salen de la fila del libro, no de una lectura
posterior: entre la escritura y una segunda lectura otra transacción puede mover
la cuenta, y el papel diría un número que nunca existió.

Es reimprimible por número.

---

## 9. Lo que se audita

Sin duplicar el libro dentro de `AuditLog`. El libro es la **historia
financiera**; la bitácora es **quién hizo la acción**.

| Evento                           | Tabla auditada                         |
| -------------------------------- | -------------------------------------- |
| cargo generado por una recepción | `PurchaseReceipt`                      |
| pago                             | `SupplierPayment`                      |
| nota de crédito                  | `SupplierAccountMovement`              |
| ajuste manual                    | `SupplierAccountMovement`              |
| sobrepago autorizado             | `SupplierPayment`, con el autorizante  |
| vencimiento modificado           | `PurchaseReceipt`, con antes y después |
| imputación manual                | `SupplierPayment`, con el reparto      |

---

## 10. Documentos relacionados

- [SUPPLIER_ACCOUNT_LEDGER.md](SUPPLIER_ACCOUNT_LEDGER.md) — el libro y sus signos
- [SUPPLIER_PAYMENT_ALLOCATION.md](SUPPLIER_PAYMENT_ALLOCATION.md) — a qué se imputa
- [ACCOUNTS_PAYABLE_POLICY.md](ACCOUNTS_PAYABLE_POLICY.md) — de dónde nace la deuda
- [CUSTOMER_PAYMENT_FLOW.md](CUSTOMER_PAYMENT_FLOW.md) — el flujo espejo, cobrando
- [CASH_SHIFT_MODEL.md](CASH_SHIFT_MODEL.md) — turnos y política de caja
- [PERMISSIONS_MATRIX.md](PERMISSIONS_MATRIX.md) — quién puede pagar
