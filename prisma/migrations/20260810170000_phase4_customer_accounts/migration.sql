-- =========================================================================
-- Fase 4A — Libro de cuenta corriente
--
-- Que hace:
--   1. Crea "CustomerAccountMovement" con sus restricciones, claves e indices.
--   2. Crea el disparador que hace la tabla inmutable.
--   3. Hace inmutable tambien "CustomerPayment".
--   4. Comprueba que el saldo de todo cliente cierre contra el libro.
--
-- Riesgo: BAJO. Es ADITIVA. Crea una tabla nueva y dos disparadores; no
-- modifica ninguna columna existente y no borra nada.
--
-- Reversible: SI, con la salvedad del punto 5 del rollback: la marcha atras
-- PIERDE EL LIBRO, y con el la explicacion de por que cada cliente debe lo que
-- debe. El saldo (`Client`.`balance`) sobrevive, pero queda sin respaldo.
--
-- LA INVARIANTE DEL MODULO, que es todo el punto de la fase:
--
--   para todo cliente:  suma(CustomerAccountMovement.amount) == Client.balance
--
-- SIGNOS. Positivo aumenta la deuda:
--
--   SALE_CHARGE        +20.000   se le fio
--   PAYMENT             -8.000   pago
--   SALE_CANCEL        -20.000   se anulo lo que se le habia fiado
--   MANUAL_ADJUSTMENT   +/-      correccion administrativa, con motivo
--
-- Ver docs/CUSTOMER_ACCOUNT_LEDGER.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La tabla
-- -------------------------------------------------------------------------
CREATE TABLE "CustomerAccountMovement" (
  "id"               SERIAL       NOT NULL,
  "branchId"         INTEGER      NOT NULL,
  "clientId"         INTEGER      NOT NULL,
  "type"             TEXT         NOT NULL,
  "amount"           NUMERIC(14,2) NOT NULL,
  "previousBalance"  NUMERIC(14,2) NOT NULL,
  "resultingBalance" NUMERIC(14,2) NOT NULL,
  "saleId"           INTEGER,
  "paymentId"        INTEGER,
  "userId"           INTEGER      NOT NULL,
  "reason"           TEXT,
  "authorizedById"   INTEGER,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CustomerAccountMovement_pkey" PRIMARY KEY ("id")
);

-- Los tres numeros tienen que concordar. Que una fila diga que 20.000 menos
-- 8.000 son 11.000 deja de ser improbable y pasa a ser imposible.
--
-- Es la misma restriccion que "StockMovement_saldos_check", y aca protege algo
-- distinto: en el stock impide inventar mercaderia; aca impide inventar deuda.
ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_saldos_check"
  CHECK ("resultingBalance" = "previousBalance" + "amount");

-- NO hay CHECK de "saldo no negativo", a diferencia del libro de stock, y la
-- diferencia es real: un stock negativo es imposible --no se pueden tener -3
-- botellas-- pero un saldo negativo es un hecho corriente. Significa que el
-- cliente tiene plata a favor, y pasa cada vez que paga de mas o que se le
-- anula una venta que ya habia pagado. Prohibirlo obligaria a mentir sobre uno
-- de los dos casos.

-- Tipo y signo, en la misma restriccion. Hace de lista blanca --un tipo
-- inventado no cumple ninguna rama-- y ademas impide la incoherencia: un pago
-- que aumente la deuda, un cargo que la baje, un movimiento de cero.
ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_tipo_signo_check"
  CHECK (
       ("type" = 'SALE_CHARGE'       AND "amount" > 0)
    OR ("type" = 'PAYMENT'           AND "amount" < 0)
    OR ("type" = 'SALE_CANCEL'       AND "amount" < 0)
    OR ("type" = 'MANUAL_ADJUSTMENT' AND "amount" <> 0)
  );

-- Un ajuste manual SIN MOTIVO no se puede auditar despues, y es justamente el
-- unico tipo que no tiene un hecho detras que lo explique: los otros tres
-- apuntan a una venta o a un pago.
ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_motivo_check"
  CHECK ("type" <> 'MANUAL_ADJUSTMENT' OR length(btrim(COALESCE("reason", ''))) > 0);

-- Cada tipo apunta a lo que le corresponde y a nada mas.
--
--   SALE_CHARGE / SALE_CANCEL   tienen venta y no tienen pago
--   PAYMENT                     tiene pago y no tiene venta
--   MANUAL_ADJUSTMENT           no tiene ninguno de los dos
--
-- Sin esto se podria escribir un pago que dice venir de una venta, y el
-- extracto del cliente contaria una historia que no ocurrio.
ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_origen_check"
  CHECK (
       ("type" IN ('SALE_CHARGE', 'SALE_CANCEL') AND "saleId" IS NOT NULL AND "paymentId" IS NULL)
    OR ("type" = 'PAYMENT'                       AND "paymentId" IS NOT NULL AND "saleId" IS NULL)
    OR ("type" = 'MANUAL_ADJUSTMENT'             AND "saleId" IS NULL AND "paymentId" IS NULL)
  );


-- -------------------------------------------------------------------------
-- 2. Claves foraneas
-- -------------------------------------------------------------------------
ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "CustomerPayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CustomerAccountMovement"
  ADD CONSTRAINT "CustomerAccountMovement_authorizedById_fkey"
  FOREIGN KEY ("authorizedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 3. Indices
--
-- Uno por consulta real: el extracto del cliente, el reporte de la sucursal, y
-- "que movio esta venta" / "que movio este recibo", que es lo que permite
-- reconciliar sin recorrer la tabla entera.
-- -------------------------------------------------------------------------
CREATE INDEX "CustomerAccountMovement_clientId_createdAt_idx"
  ON "CustomerAccountMovement"("clientId", "createdAt");
CREATE INDEX "CustomerAccountMovement_branchId_createdAt_idx"
  ON "CustomerAccountMovement"("branchId", "createdAt");
CREATE INDEX "CustomerAccountMovement_saleId_idx"
  ON "CustomerAccountMovement"("saleId");
CREATE INDEX "CustomerAccountMovement_paymentId_idx"
  ON "CustomerAccountMovement"("paymentId");
CREATE INDEX "CustomerAccountMovement_userId_idx"
  ON "CustomerAccountMovement"("userId");


-- -------------------------------------------------------------------------
-- 4. Inmutabilidad del libro
--
-- Un movimiento no se edita y no se borra. Los errores se corrigen con otro
-- movimiento, igual que en un libro contable y igual que en el de stock.
--
-- Va en la base y no solo en el codigo porque en el codigo protege de los
-- errores propios, y aca protege ademas de un UPDATE a mano desde psql. La
-- pregunta que responde: "¿podria alguien bajarle la deuda a un cliente sin
-- que quede rastro?". Con esto, no: tendria que escribir otro movimiento, con
-- su usuario y su motivo.
--
-- TRUNCATE no dispara disparadores de fila, asi que el reinicio de la base de
-- pruebas sigue funcionando.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "customer_account_movement_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Los movimientos de cuenta corriente son inmutables (intento de % sobre el id %). '
    'Para corregir un error, registra otro movimiento.',
    TG_OP, OLD."id";
END $$;

CREATE TRIGGER "CustomerAccountMovement_inmutable"
  BEFORE UPDATE OR DELETE ON "CustomerAccountMovement"
  FOR EACH ROW EXECUTE FUNCTION "customer_account_movement_inmutable"();


-- -------------------------------------------------------------------------
-- 5. Inmutabilidad del pago
--
-- Un cobro tampoco se edita ni se borra, por el mismo motivo que una recepcion
-- de mercaderia: ya movio un saldo y ya se le dio un comprobante al cliente.
-- Editarlo dejaria el libro contando una historia y el papel que tiene el
-- cliente en la mano contando otra.
--
-- Va en ESTA migracion y no en la anterior a proposito: hasta que existe el
-- libro, un pago no tiene consecuencias, y la inmutabilidad protege justamente
-- la consecuencia.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "customer_payment_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Los pagos de clientes son inmutables (intento de % sobre el id %). '
    'Para corregir un error, registra un ajuste de cuenta con su motivo.',
    TG_OP, OLD."id";
END $$;

CREATE TRIGGER "CustomerPayment_inmutable"
  BEFORE UPDATE OR DELETE ON "CustomerPayment"
  FOR EACH ROW EXECUTE FUNCTION "customer_payment_inmutable"();


-- -------------------------------------------------------------------------
-- 6. Comprobacion posterior
--
-- La invariante del libro tiene que cumplirse ya mismo. Sobre una base recien
-- migrada es trivialmente cierta --no hay clientes, o los hay en cero y sin
-- movimientos-- y por eso mismo vale la pena dejarla escrita: es la unica
-- forma de que una re-aplicacion sobre una base que YA tenia clientes no pase
-- inadvertida.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  descuadres integer;
BEGIN
  SELECT count(*) INTO descuadres
    FROM "Client" c
    LEFT JOIN (
      SELECT "clientId", sum("amount") AS total
        FROM "CustomerAccountMovement"
       GROUP BY "clientId"
    ) m ON m."clientId" = c."id"
   WHERE c."balance" <> COALESCE(m.total, 0);

  IF descuadres > 0 THEN
    RAISE EXCEPTION
      'El libro de cuenta corriente no cuadra en % cliente(s) despues de migrar. '
      'No se aplica la migracion.', descuadres;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP TRIGGER "CustomerPayment_inmutable" ON "CustomerPayment";
--   DROP FUNCTION "customer_payment_inmutable"();
--   DROP TRIGGER "CustomerAccountMovement_inmutable" ON "CustomerAccountMovement";
--   DROP FUNCTION "customer_account_movement_inmutable"();
--   DROP TABLE "CustomerAccountMovement";
--
-- Advertencia: la marcha atras PIERDE EL LIBRO. Los movimientos no estan en
-- ningun otro lado --son informacion nueva, no una copia-- y con ellos se
-- pierde la explicacion de cada saldo: queda el numero y no el por que. Un
-- cliente que reclame "yo pague 8.000 el martes" no va a tener contra que
-- comprobarlo.
--
-- El saldo (`Client`.`balance`) sobrevive intacto porque nunca dejo de
-- mantenerse. Exportar el libro antes:
--   \copy (SELECT * FROM "CustomerAccountMovement" ORDER BY "id")
--     TO 'cuenta_corriente.csv' CSV HEADER
-- =========================================================================
