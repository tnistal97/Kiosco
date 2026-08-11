# Libro de cuenta corriente

**Fase 4A.** El saldo de un cliente deja de ser un número y pasa a ser el
resultado de un libro.

---

## 1. La invariante

```
para todo cliente:  suma(CustomerAccountMovement.amount) == Client.balance
```

`Client.balance` sigue existiendo —leer un saldo tiene que costar una fila y no
una suma de dos años— pero **no es la fuente de la verdad**: es el saldo
materializado del libro. Es la misma relación que `BranchStock.quantity` tiene
con `StockMovement` desde la Fase 3A.

La comprobación vive en `npm run integrity:check`, bajo el nombre **Clientes**,
y suma con `SUM()` en PostgreSQL. El servicio suma con `Decimal.js` en
JavaScript. Que los dos caminos den lo mismo es lo que hace que la comprobación
signifique algo: una prueba que llama a la función que escribió el dato sólo
comprueba que la función es igual a sí misma.

---

## 2. Los signos

**Positivo = el cliente debe. Negativo = tiene plata a favor.**

Se eligió así y no al revés porque es como se habla en el mostrador: _"Juan debe
20.000"_ es el caso corriente, y el caso corriente tiene que ser el que se lee
sin signo.

| Tipo                | Signo | Qué es                            | Quién lo emite                |
| ------------------- | ----- | --------------------------------- | ----------------------------- |
| `SALE_CHARGE`       | **+** | Se le fió                         | Una venta con línea `ACCOUNT` |
| `PAYMENT`           | **−** | Pagó                              | `CustomerPayment`, y nada más |
| `SALE_CANCEL`       | **−** | Se anuló lo que se le había fiado | La anulación de esa venta     |
| `MANUAL_ADJUSTMENT` | **±** | Corrección administrativa         | `accounts.adjust`, con motivo |

Un pago que aumente la deuda no es un error que haya que buscar: es una fila que
PostgreSQL rechaza (`CustomerAccountMovement_tipo_signo_check`).

Un saldo **negativo** no es un error. Pasa cada vez que alguien paga de más y,
sobre todo, cuando se anula una venta que ya había pagado. Por eso —a diferencia
del libro de stock, que sí lo tiene— **no hay un CHECK de "no negativo"**: un
stock de −3 botellas es imposible; un saldo a favor es un hecho corriente.

---

## 3. La única puerta

`applyAccountMovement()`, en `src/modules/clients/cuenta.ts`.

Ninguna otra parte de `src/` escribe sobre `Client.balance`. Lo impide una regla
de ESLint (`PROHIBIDO_ESCRIBIR_SALDO`) con dos selectores: cualquier escritura
de la propiedad `balance` en una llamada sobre `client`, y cualquier SQL crudo
con `UPDATE "Client"`. La única excepción declarada es el propio archivo.

Editar el nombre, el teléfono o el límite sigue permitido desde el servicio: lo
único cerrado es la columna del saldo.

### El corazón: una sola sentencia

```sql
UPDATE "Client"
   SET "balance" = "balance" + $delta
 WHERE "id" = $id
   AND "branchId" = $branch
   AND "isActive" = true
   AND "isCreditEnabled" = true
   AND ("creditLimit" IS NULL OR "balance" + $delta <= "creditLimit")
RETURNING ("balance" - $delta) AS previo, "balance" AS resultante
```

Aplicar el delta, comprobar la política de crédito y devolver los dos saldos
ocurren **en la misma sentencia**. Eso es lo que cierra la ventana:

> Cliente con saldo 40.000 y límite 50.000. Dos cajas intentan fiarle 8.000 al
> mismo tiempo. La versión ingenua —leer, comparar en JavaScript, escribir—
> deja que las dos lean _"hay lugar"_, las dos decidan _"entra"_, y el saldo
> termine en 56.000.

Ese hueco no se cierra con más comprobaciones: se cierra no teniéndolo.
PostgreSQL toma el bloqueo de la fila y **reevalúa la condición después de
esperarlo**, así que la segunda ve el saldo ya cargado. Hay una prueba que lo
corre cinco veces (`tests/concurrency/cuenta-corriente.test.ts`).

El límite **no** frena un pago, una anulación ni un ajuste que reduce la deuda.
Si lo hiciera, un cliente que se pasó del límite no podría salir de ahí.

---

## 4. Inmutabilidad

Dos disparadores en PostgreSQL:

| Tabla                     | Disparador                            |
| ------------------------- | ------------------------------------- |
| `CustomerAccountMovement` | `BEFORE UPDATE OR DELETE` → excepción |
| `CustomerPayment`         | `BEFORE UPDATE OR DELETE` → excepción |

Van en la base y no sólo en el código porque en el código protegen de los
errores propios, y ahí protegen además de un `UPDATE` a mano desde `psql`. La
pregunta que responden: _"¿podría alguien bajarle la deuda a un cliente sin que
quede rastro?"_. No: tendría que escribir otro movimiento, con su usuario y su
motivo.

`TRUNCATE` no dispara disparadores de fila, así que el reinicio de la base de
pruebas sigue funcionando.

Y cinco restricciones `CHECK`:

| Restricción           | Qué impide                                                                |
| --------------------- | ------------------------------------------------------------------------- |
| `saldos_check`        | Que una fila diga que 20.000 − 8.000 son 11.000                           |
| `tipo_signo_check`    | Un pago que aumente la deuda, un cargo que la baje, un movimiento de cero |
| `motivo_check`        | Un ajuste manual sin motivo                                               |
| `origen_check`        | Un pago que diga venir de una venta, o al revés                           |
| `Client_limite_check` | Un límite de crédito negativo                                             |

---

## 5. Usar el saldo a favor

**No hay un método `CREDIT_BALANCE`, y es deliberado.**

Un cliente con −2.000 que compra 5.000 a cuenta termina en +3.000. El libro ya
hizo la resta: cargar a cuenta **es** usar el crédito. Agregar un segundo medio
de pago para expresarlo crearía una segunda forma de escribir el mismo
movimiento, y dos formas de escribir lo mismo es exactamente lo que produce
deriva.

Lo que sí es explícito es la **explicación**. `applyAccountMovement` devuelve
`creditoAplicado`, derivado de los dos saldos que la fila ya guarda:

```
-2.000 → +3.000   se usaron 2.000   (había 2.000 a favor)
-5.000 → -1.000   se usaron 4.000   (había 5.000, se usó parte)
     0 → +5.000   se usaron 0
```

La venta responde `account.creditApplied`, y la pantalla puede decir _"de los
$5.000, $2.000 salen del saldo a favor"_ sin una entidad de más.

---

## 6. Las tres reglas de la reconciliación, y el punto ciego

Igual que el libro de inventario:

1. `Σ movimientos = Client.balance` — el saldo cierra
2. `previo + delta = resultante` — cada fila cierra sola
3. `previo = resultante del anterior` — no falta ninguna fila

La tercera es la que detecta una fila **borrada del medio**: borrarla deja el
saldo mal (la 1 lo ve), pero borrarla _y ajustar el saldo a mano_ la esquivaría.
La cadena no.

**El punto ciego, escrito:** borrar el **último** movimiento y ajustar
`Client.balance` no lo detecta ninguna de las tres. Contra eso protege el
disparador de inmutabilidad, no la reconciliación. Hay una prueba que lo
documenta —`DOCUMENTA EL PUNTO CIEGO`— y que falla si algún día deja de ser
cierto, lo cual obligaría a actualizar este documento.

---

## 7. Qué pasa cuando se anula una venta que ya se pagó

Es el caso difícil, y la política está escrita antes de que ocurra:

```
venta fiada        +20.000   saldo  20.000
el cliente paga     -8.000   saldo  12.000
se anula la venta  -20.000   saldo  -8.000
```

Quedan **$8.000 a favor** del cliente. Es lo correcto: esa plata la puso de
verdad, y la mercadería volvió.

La anulación revierte **exactamente lo que la venta había cargado**, no _"lo que
quede"_. El pago anterior no se toca ni se reinterpreta: es un hecho, y ya tiene
su comprobante en la mano del cliente. Cualquier otra política obligaría al
sistema a decidir de quién es esa plata, y no es una decisión suya.

La comprobación **Anulaciones de cuenta** verifica que los movimientos _de esa
venta_ sumen cero. No verifica que el saldo del cliente vuelva a lo que era —no
tiene por qué—, y hay una prueba que se asegura de que ese caso legítimo no se
informe como descuadre.

---

## 8. Documentos relacionados

- [`CUSTOMER_MODEL.md`](CUSTOMER_MODEL.md) — qué es un cliente y qué no se le exige
- [`CREDIT_POLICY.md`](CREDIT_POLICY.md) — límite, override y fiado cortado
- [`CUSTOMER_PAYMENT_FLOW.md`](CUSTOMER_PAYMENT_FLOW.md) — el cobro y el comprobante
- [`PHASE3_RECONCILIATION.md`](PHASE3_RECONCILIATION.md) — las trece comprobaciones
- [`INVENTORY_LEDGER.md`](INVENTORY_LEDGER.md) — el libro del que este copia su forma
