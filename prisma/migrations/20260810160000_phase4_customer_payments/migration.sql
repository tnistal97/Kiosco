-- =========================================================================
-- Fase 4A — Pagos de clientes
--
-- Que hace:
--   1. Crea la secuencia del numero de comprobante.
--   2. Crea "CustomerPayment" con sus restricciones, claves e indices.
--
-- Riesgo: BAJO. Es ADITIVA. Crea una secuencia y una tabla nuevas.
--
-- Reversible: SI, con la misma salvedad que siempre: se lleva los pagos, que
-- son informacion nueva.
--
-- Nota: el disparador de inmutabilidad de esta tabla NO esta aca sino en la
-- migracion siguiente, junto con el del libro. Es deliberado: un pago sin su
-- movimiento de cuenta no significa nada, asi que las dos tablas se vuelven
-- inmutables en el mismo momento y por la misma razon.
--
-- Ver docs/CUSTOMER_PAYMENT_FLOW.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La secuencia del numero de comprobante
--
-- Mismo mecanismo que "PurchaseOrder_numero_seq", y por el mismo motivo:
-- `count() + 1` hace que dos personas cobrando a la vez lean el mismo numero,
-- pidan el mismo numero, y el indice unico rechace a una de las dos. Esa
-- persona ve un error que no provoco, en una operacion que hizo bien.
--
-- `nextval()` es atomico y NO BLOQUEA. Deja huecos --una transaccion que
-- despues falla se lleva su numero-- y esta bien: es la etiqueta que se le da
-- al cliente en el papel, no un contador de cuantos cobros se hicieron.
--
-- Igual que la de compras, NO es el DEFAULT de la columna: el numero se arma
-- en el servidor como 'RC-' + ocho digitos, y un DEFAULT con esa concatenacion
-- apareceria como deriva en cada `migrate diff`.
-- -------------------------------------------------------------------------
CREATE SEQUENCE "CustomerPayment_numero_seq" AS BIGINT START WITH 1 INCREMENT BY 1;


-- -------------------------------------------------------------------------
-- 2. La tabla
-- -------------------------------------------------------------------------
CREATE TABLE "CustomerPayment" (
  "id"           SERIAL       NOT NULL,
  "number"       TEXT         NOT NULL,
  "branchId"     INTEGER      NOT NULL,
  "clientId"     INTEGER      NOT NULL,
  "amount"       NUMERIC(14,2) NOT NULL,
  "method"       TEXT         NOT NULL,
  "cashShiftId"  INTEGER,
  "receivedById" INTEGER      NOT NULL,
  "reference"    TEXT,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerPayment_pkey" PRIMARY KEY ("id")
);

-- Un pago es SIEMPRE positivo. Un "pago" de -8.000 seria un cargo disfrazado
-- de cobro: bajaria el saldo en el listado de pagos y lo subiria en el libro.
-- Para cargar deuda estan la venta a cuenta y el ajuste manual, que dejan
-- rastro de lo que son.
ALTER TABLE "CustomerPayment"
  ADD CONSTRAINT "CustomerPayment_monto_check"
  CHECK ("amount" > 0);

-- Los medios con los que se puede cobrar una cuenta.
--
-- 'ACCOUNT' NO figura, y es el punto: pagar la cuenta con la cuenta no
-- significa nada --dejaria el saldo igual y generaria dos movimientos que se
-- cancelan--. 'CARD' tampoco: es un medio historico que el sistema ya no
-- ofrece, y una tabla nueva no tiene por que nacer aceptandolo.
ALTER TABLE "CustomerPayment"
  ADD CONSTRAINT "CustomerPayment_medio_check"
  CHECK ("method" IN ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER'));

CREATE UNIQUE INDEX "CustomerPayment_number_key" ON "CustomerPayment"("number");


-- -------------------------------------------------------------------------
-- 3. Claves foraneas
--
-- Todas RESTRICT: ni el cliente, ni el turno, ni quien cobro se pueden borrar
-- mientras exista un pago que los nombre. Un comprobante que apunta a un
-- cliente inexistente no se puede reclamar.
-- -------------------------------------------------------------------------
ALTER TABLE "CustomerPayment"
  ADD CONSTRAINT "CustomerPayment_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerPayment"
  ADD CONSTRAINT "CustomerPayment_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL como en el resto de las referencias a turno: es opcional, y perder
-- el turno no invalida el cobro.
ALTER TABLE "CustomerPayment"
  ADD CONSTRAINT "CustomerPayment_cashShiftId_fkey"
  FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerPayment"
  ADD CONSTRAINT "CustomerPayment_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. Indices
-- -------------------------------------------------------------------------
CREATE INDEX "CustomerPayment_clientId_createdAt_idx" ON "CustomerPayment"("clientId", "createdAt");
CREATE INDEX "CustomerPayment_branchId_createdAt_idx" ON "CustomerPayment"("branchId", "createdAt");
CREATE INDEX "CustomerPayment_cashShiftId_idx"        ON "CustomerPayment"("cashShiftId");
CREATE INDEX "CustomerPayment_receivedById_idx"       ON "CustomerPayment"("receivedById");


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP TABLE "CustomerPayment";
--   DROP SEQUENCE "CustomerPayment_numero_seq";
--
-- Advertencia: se lleva los comprobantes emitidos. Los movimientos del libro
-- que los referencian ya habrian caido con el rollback de
-- phase4_customer_accounts, que tiene que ejecutarse ANTES que este.
--
-- Exportar antes:
--   \copy (SELECT * FROM "CustomerPayment") TO 'cobros.csv' CSV HEADER
-- =========================================================================
