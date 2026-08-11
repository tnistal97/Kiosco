# Libro de cuenta con proveedores

Fase 4B. La contraparte financiera del módulo de compras: hasta acá el sistema
sabía qué se le pidió a un proveedor, qué llegó y a qué costo, pero no cuánto se
le debe.

Es el **espejo** de [CUSTOMER_ACCOUNT_LEDGER.md](CUSTOMER_ACCOUNT_LEDGER.md), y
eso es deliberado: mismo diseño, mismo vocabulario de campos, mismas garantías.
Quien entendió el libro de clientes entiende éste sin aprender nada nuevo.

---

## 1. La invariante

```
para todo proveedor:  suma(SupplierAccountMovement.amount) == Supplier.balance
```

`Supplier.balance` es el saldo **materializado**. Se guarda para que leer un
saldo cueste una fila y no la suma de dos años de compras, pero **no es la
fuente de la verdad**. La fuente es el libro.

Es la misma relación que hay entre `BranchStock.quantity` y `StockMovement`
desde la Fase 3A, y entre `Client.balance` y `CustomerAccountMovement` desde la
4A. Tres libros, la misma forma.

La reconciliación (`npm run integrity:check`) la comprueba **por otro camino**:
suma con `SUM()` en PostgreSQL lo que el servicio sumó con `Decimal.js` en
JavaScript. Una prueba que llamara a la misma función que escribió el dato no
comprobaría nada.

---

## 2. Los signos

**La convención, y no admite ambigüedad:**

```
saldo POSITIVO  ->  LE DEBEMOS al proveedor
saldo NEGATIVO  ->  tenemos crédito NUESTRO con él
```

| Tipo                | Signo      | Qué pasó                                   |
| ------------------- | ---------- | ------------------------------------------ |
| `PURCHASE_CHARGE`   | `+120.000` | llegó mercadería y hay que pagarla         |
| `PAYMENT`           | `-40.000`  | le pagamos                                 |
| `PURCHASE_CREDIT`   | `-10.000`  | emitió una nota de crédito a favor nuestro |
| `MANUAL_ADJUSTMENT` | `+/-`      | corrección administrativa, con motivo      |

### Por qué positivo es "debemos" y no al revés

Es **la misma dirección** que en el libro de clientes, donde positivo significa
"el cliente debe". Podría haberse elegido lo contrario —"es plata que sale, va
en negativo"— y se descartó: obligaría a recordar cuál de los dos libros se está
mirando antes de interpretar un signo. Un sistema en el que el mismo símbolo
significa dos cosas según la pantalla es un sistema donde alguien va a leer mal
un número.

La regla, entonces, vale para los dos libros y se dice en una línea:
**positivo es que hay una deuda; de quién es la deuda lo dice cuál libro se está
mirando.**

### El signo lo hace cumplir PostgreSQL

Un pago que aumente la deuda no es un error que haya que buscar: es una fila que
la base **rechaza**.

```sql
CONSTRAINT "SupplierAccountMovement_tipo_signo_check" CHECK (
     ("type" = 'PURCHASE_CHARGE'   AND "amount" > 0)
  OR ("type" = 'PAYMENT'           AND "amount" < 0)
  OR ("type" = 'PURCHASE_CREDIT'   AND "amount" < 0)
  OR ("type" = 'MANUAL_ADJUSTMENT' AND "amount" <> 0)
)
```

Hace además de lista blanca: un tipo inventado no cumple ninguna rama.

### Sobre los nombres

El objetivo 1 pedía evaluar si había mejores. Se conservaron los cuatro
propuestos porque **ya encajan**: tres son el espejo exacto de los del libro de
clientes, y esa simetría vale más que cualquier mejora marginal.

`PURCHASE_CREDIT` es el único sin espejo, y tampoco se renombró:

- `SUPPLIER_CREDIT` habría sido redundante — todo este libro es de proveedores;
- `PURCHASE_RETURN` habría mentido — una nota de crédito no siempre viene de una
  devolución; llega también por una bonificación de fin de mes o por un faltante.

"Nota de crédito" es como se llama el papel que manda el proveedor, y el código
tiene que decir lo que dice el papel.

---

## 3. La única puerta

`applySupplierAccountMovement()` en
[`src/modules/suppliers/cuenta.ts`](../src/modules/suppliers/cuenta.ts).

Ninguna otra parte de `src/` escribe sobre `Supplier.balance`. Lo impide una
regla de ESLint —`PROHIBIDO_ESCRIBIR_SALDO_PROVEEDOR`, la **quinta** frontera
del proyecto— y este archivo es su única excepción declarada.

Editar el nombre, el teléfono o el plazo de pago de un proveedor sigue
permitido desde el servicio: lo único cerrado es la columna del saldo.

### El corazón: una sola sentencia

```sql
UPDATE "Supplier"
   SET "balance" = "balance" + ${delta}::numeric
 WHERE "id" = ${supplierId}
   AND "balance" + ${delta}::numeric >= 0        -- solo si el pago no fue autorizado
RETURNING ("balance" - ${delta}::numeric)::numeric(14,2) AS previo,
          "balance"::numeric(14,2)                       AS resultante
```

Aplicar el delta, comprobar la política y devolver el saldo anterior y el
resultante **en la misma sentencia**.

Eso es lo que cierra la ventana del objetivo 34. La versión ingenua —leer el
saldo, comparar en JavaScript, escribir— deja un hueco:

> Se le deben **$50.000** a un proveedor. Dos personas registran, en el mismo
> segundo, un pago de **$40.000** cada una. Las dos leen "entra", las dos deciden
> "entra", y terminamos habiéndole pagado **$80.000** por una deuda de $50.000.

Ese hueco no se cierra con más comprobaciones: se cierra **no teniéndolo**.
PostgreSQL toma el bloqueo de la fila y **reevalúa la condición después de
esperarlo**, así que la segunda ve el saldo ya bajado y su `UPDATE` no afecta
ninguna fila. El servicio lo traduce a un 409 que dice cuánto sobra.

La condición es el **espejo del límite de crédito** del cliente. Allá el tope era
`balance + delta <= creditLimit`; acá es `balance + delta >= 0`, que dice lo
mismo mirado del otro lado: _no pagues más de lo que debés sin que alguien lo
autorice_.

### Lo que esta puerta NO comprueba

**`isActive`**, y es deliberado. A un proveedor dado de baja se le puede seguir
**debiendo**, y hay que poder pagarle. Bloquear el libro por la baja atraparía la
deuda dentro del sistema sin forma de saldarla.

Lo que sí está cerrado es _comprarle_: eso lo comprueba `exigirProveedorActivo`
en la orden y en la recepción, que es donde corresponde.

Es una diferencia real con el libro de clientes, donde un cliente inactivo no
puede recibir cargos. Allá el cargo nace de una venta que se puede no hacer; acá
el cargo ya nació de mercadería que ya entró.

---

## 4. Inmutabilidad

Tres disparadores `BEFORE UPDATE OR DELETE` en PostgreSQL:

| Tabla                       | Por qué                                                 |
| --------------------------- | ------------------------------------------------------- |
| `SupplierAccountMovement`   | es el libro                                             |
| `SupplierPayment`           | ya movió un saldo y ya salió plata del cajón            |
| `SupplierPaymentAllocation` | cuelga de un pago inmutable, y sería la puerta de atrás |

Van **en la base** y no sólo en el código porque en el código protegen de los
errores propios, y acá protegen además de un `UPDATE` a mano desde `psql`.

La pregunta que responden: _"¿podría alguien borrar una deuda con un proveedor
sin que quede rastro?"_. Con esto, no: tendría que escribir otro movimiento, con
su usuario y su motivo.

La tercera es la menos obvia y la más necesaria. El pago no se puede tocar, pero
sin ese disparador se podría **mover su imputación** de una entrega a otra y
cambiar cuál de las dos figura como pagada. El saldo no se movería —la
imputación no lo decide— y por eso mismo no se notaría.

`TRUNCATE` no dispara disparadores de fila, así que el reinicio de la base de
pruebas sigue funcionando.

---

## 5. Usar el crédito a favor

Un saldo negativo no es un error: significa que el proveedor nos debe. Pasa
cuando se le paga de más y cuando una nota de crédito supera lo que quedaba
debiendo.

La próxima recepción lo consume sola, porque el libro suma:

```
saldo  -5.000   (nos hizo una nota de crédito por 10.000 y debíamos 5.000)
recepción      +50.000
saldo  +45.000
```

`creditoAplicado` explica la resta: de los $50.000, **$5.000 salieron del crédito
que ya teníamos** y $45.000 pasan a deberse. Sin ese dato el número final es
correcto y nadie entiende de dónde salió.

**No hay devolución en efectivo de un saldo a favor.** Un proveedor que nos debe
plata la descuenta de la próxima entrega; pedirle el efectivo de vuelta es una
negociación, no una operación de sistema.

---

## 6. Las cinco reglas de la reconciliación, y el punto ciego

`npm run integrity:check` agrega cinco comprobaciones (objetivo 24):

| #   | Regla                                                                                        |
| --- | -------------------------------------------------------------------------------------------- |
| 1   | `SUM(SupplierAccountMovement.amount) == Supplier.balance`                                    |
| 2   | `previousBalance + amount == resultingBalance`, fila por fila                                |
| 3   | cada fila encadena con la anterior del mismo proveedor                                       |
| 4   | cada recepción con `debtRecorded` tiene **exactamente un** `PURCHASE_CHARGE`, por su `total` |
| 5   | cada pago tiene exactamente un `PAYMENT`; en efectivo, además su egreso de caja              |

Más las dos de imputación, en
[SUPPLIER_PAYMENT_ALLOCATION.md](SUPPLIER_PAYMENT_ALLOCATION.md).

### El punto ciego, dicho en voz alta

Borrar el **último** movimiento de un proveedor y ajustar el saldo a mano es
invisible a las tres primeras reglas: el libro sigue encadenado, la suma sigue
dando el saldo. Lo que lo tapa es el **disparador de inmutabilidad**, no la
reconciliación.

Es el mismo punto ciego que tienen el libro de inventario y el de clientes, y se
escribe acá por la misma razón que allá: una defensa que uno cree tener y no
tiene es peor que una que sabe que le falta.

---

## 7. Qué pasa cuando algo sale mal

**No se edita y no se borra.** Un error se corrige con un movimiento nuevo.

| Qué pasó                                       | Qué se registra                                    |
| ---------------------------------------------- | -------------------------------------------------- |
| el proveedor mandó menos de lo facturado       | nota de crédito (`PURCHASE_CREDIT`) con motivo     |
| se cargó una recepción con el costo equivocado | nota de crédito o ajuste, con motivo               |
| había deuda anterior a esta fase               | ajuste manual (`MANUAL_ADJUSTMENT`) con motivo     |
| se pagó de más                                 | queda saldo a favor; lo consume la próxima entrega |

La devolución física de mercadería al proveedor **no está implementada** en esta
fase. Lo que hay es la corrección _financiera_ —la nota de crédito— y el
movimiento de stock por los caminos que ya existen. No se finge que sea una
devolución formal. La extensión futura está anotada en
[ACCOUNTS_PAYABLE_POLICY.md](ACCOUNTS_PAYABLE_POLICY.md), sección "lo que falta".

---

## 8. Documentos relacionados

- [SUPPLIER_PAYMENT_FLOW.md](SUPPLIER_PAYMENT_FLOW.md) — cómo se registra un pago
- [SUPPLIER_PAYMENT_ALLOCATION.md](SUPPLIER_PAYMENT_ALLOCATION.md) — qué obligación cancela cada peso
- [ACCOUNTS_PAYABLE_POLICY.md](ACCOUNTS_PAYABLE_POLICY.md) — vencimientos, plazos y estados
- [CUSTOMER_ACCOUNT_LEDGER.md](CUSTOMER_ACCOUNT_LEDGER.md) — el libro espejo, del otro lado del mostrador
- [PURCHASE_RECEIVING.md](PURCHASE_RECEIVING.md) — de dónde nace la deuda
- [INVENTORY_LEDGER.md](INVENTORY_LEDGER.md) — el primer libro del sistema
- [PHASE3_RECONCILIATION.md](PHASE3_RECONCILIATION.md) — el motor de comprobación
