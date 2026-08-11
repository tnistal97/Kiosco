-- =========================================================================
-- Fase 4B — Libro de cuenta con proveedores
--
-- Que hace:
--   1. Crea "SupplierAccountMovement" con sus restricciones, claves e indices.
--   2. Impide, ESTRUCTURALMENTE, que una recepcion genere deuda dos veces.
--   3. Crea el disparador que hace la tabla inmutable.
--   4. Hace inmutable tambien "SupplierPayment".
--   5. Comprueba que el saldo de todo proveedor cierre contra el libro.
--
-- Riesgo: BAJO. Es ADITIVA. Crea una tabla nueva y dos disparadores; no
-- modifica ninguna columna existente y no borra nada.
--
-- Reversible: SI, con la salvedad del rollback: la marcha atras PIERDE EL
-- LIBRO, y con el la explicacion de por que le debemos a cada proveedor lo que
-- le debemos. El saldo ("Supplier"."balance") sobrevive, pero queda sin
-- respaldo.
--
-- LA INVARIANTE DEL MODULO, que es todo el punto de la fase:
--
--   para todo proveedor:  suma(SupplierAccountMovement.amount) == Supplier.balance
--
-- SIGNOS. Positivo aumenta lo que LE DEBEMOS:
--
--   PURCHASE_CHARGE   +120.000   llego mercaderia y hay que pagarla
--   PAYMENT            -40.000   le pagamos
--   PURCHASE_CREDIT    -10.000   nos hizo una nota de credito
--   MANUAL_ADJUSTMENT    +/-     correccion administrativa, con motivo
--
-- Ver docs/SUPPLIER_ACCOUNT_LEDGER.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La tabla
-- -------------------------------------------------------------------------
CREATE TABLE "SupplierAccountMovement" (
  "id"               SERIAL        NOT NULL,
  "branchId"         INTEGER       NOT NULL,
  "supplierId"       INTEGER       NOT NULL,
  "type"             TEXT          NOT NULL,
  "amount"           NUMERIC(14,2) NOT NULL,
  "previousBalance"  NUMERIC(14,2) NOT NULL,
  "resultingBalance" NUMERIC(14,2) NOT NULL,
  "receiptId"        INTEGER,
  "paymentId"        INTEGER,
  "userId"           INTEGER       NOT NULL,
  "reason"           TEXT,
  "reference"        TEXT,
  "authorizedById"   INTEGER,
  "createdAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplierAccountMovement_pkey" PRIMARY KEY ("id")
);

-- Los tres numeros tienen que concordar. Que una fila diga que 120.000 menos
-- 40.000 son 90.000 deja de ser improbable y pasa a ser imposible.
--
-- Es la misma restriccion que en el libro de stock y en el de clientes. Aca
-- protege algo distinto de los dos: en el stock impide inventar mercaderia; en
-- el del cliente, inventar deuda ajena; aca, inventar deuda propia --o hacerla
-- desaparecer, que es el caso que importa.
ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_saldos_check"
  CHECK ("resultingBalance" = "previousBalance" + "amount");

-- NO hay CHECK de "saldo no negativo", igual que en el libro de clientes: un
-- saldo negativo significa que tenemos credito con el proveedor, y es un hecho
-- corriente --pasa cada vez que se le paga de mas y cada vez que una nota de
-- credito supera lo que quedaba debiendo--. Prohibirlo obligaria a mentir.
--
-- Lo que SI se controla es que ese saldo negativo no aparezca sin que nadie lo
-- haya visto, y eso no es una restriccion de tabla: es la condicion
-- `balance + delta >= 0` que lleva el UPDATE de `applySupplierAccountMovement`,
-- que solo se relaja con una autorizacion que queda escrita en la fila.

-- Tipo y signo, en la misma restriccion. Hace de lista blanca --un tipo
-- inventado no cumple ninguna rama-- y ademas impide la incoherencia: un pago
-- que aumente la deuda, una recepcion que la baje, un movimiento de cero.
ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_tipo_signo_check"
  CHECK (
       ("type" = 'PURCHASE_CHARGE'   AND "amount" > 0)
    OR ("type" = 'PAYMENT'           AND "amount" < 0)
    OR ("type" = 'PURCHASE_CREDIT'   AND "amount" < 0)
    OR ("type" = 'MANUAL_ADJUSTMENT' AND "amount" <> 0)
  );

-- Los dos tipos sin un hecho propio detras exigen motivo.
--
-- La recepcion no lo necesita --tiene mercaderia y un remito-- y el pago
-- tampoco --tiene su comprobante--. La nota de credito y el ajuste no tienen
-- nada mas que lo que se escriba aca: sin motivo, dentro de un anio son un
-- numero sin explicacion.
--
-- Es UNA restriccion mas que la del libro de clientes, donde solo el ajuste lo
-- exigia, y la diferencia es real: alla los otros tres tipos apuntaban a una
-- venta o a un cobro; aca la nota de credito no apunta a nada.
ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_motivo_check"
  CHECK ("type" NOT IN ('MANUAL_ADJUSTMENT', 'PURCHASE_CREDIT')
         OR length(btrim(COALESCE("reason", ''))) > 0);

-- Cada tipo apunta a lo que le corresponde y a nada mas.
--
--   PURCHASE_CHARGE     tiene recepcion y no tiene pago
--   PAYMENT             tiene pago y no tiene recepcion
--   PURCHASE_CREDIT     no tiene ninguno de los dos
--   MANUAL_ADJUSTMENT   no tiene ninguno de los dos
--
-- La nota de credito NO cuelga de una recepcion, y es una decision del objetivo
-- 12: "no modificar una recepcion historica". Un proveedor emite una nota de
-- credito por un faltante que abarca dos entregas, o por una bonificacion de
-- fin de mes que no corresponde a ninguna. Atarla a una recepcion obligaria a
-- elegir una arbitrariamente. Lo que la explica es el motivo, que es
-- obligatorio, y el numero de SU documento, que va en "reference".
ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_origen_check"
  CHECK (
       ("type" = 'PURCHASE_CHARGE' AND "receiptId" IS NOT NULL AND "paymentId" IS NULL)
    OR ("type" = 'PAYMENT'         AND "paymentId" IS NOT NULL AND "receiptId" IS NULL)
    OR ("type" IN ('PURCHASE_CREDIT', 'MANUAL_ADJUSTMENT')
        AND "receiptId" IS NULL AND "paymentId" IS NULL)
  );


-- -------------------------------------------------------------------------
-- 2. Una recepcion, un cargo. ESTRUCTURALMENTE.
--
-- Es el objetivo 5, y la parte que importa es "estructuralmente". Un servicio
-- que comprueba antes de escribir no alcanza: entre el SELECT y el INSERT cabe
-- otra transaccion, y dos recepciones confirmadas a la vez --o un reintento del
-- navegador sobre una peticion que ya habia entrado-- dejarian la deuda
-- duplicada. Una deuda duplicada no se nota: el saldo queda mal y todo lo demas
-- parece bien.
--
-- El indice unico PARCIAL lo hace imposible. Solo cubre PURCHASE_CHARGE, que es
-- el unico tipo que apunta a una recepcion, asi que no estorba a nada mas.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "SupplierAccountMovement_un_cargo_por_recepcion"
  ON "SupplierAccountMovement"("receiptId")
  WHERE "type" = 'PURCHASE_CHARGE';


-- -------------------------------------------------------------------------
-- 3. Claves foraneas
-- -------------------------------------------------------------------------
ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_authorizedById_fkey"
  FOREIGN KEY ("authorizedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. Indices
--
-- Uno por consulta real: el extracto del proveedor, el reporte de la sucursal,
-- y "que movio esta recepcion" / "que movio este comprobante", que es lo que
-- permite reconciliar sin recorrer la tabla entera.
-- -------------------------------------------------------------------------
CREATE INDEX "SupplierAccountMovement_supplierId_createdAt_idx"
  ON "SupplierAccountMovement"("supplierId", "createdAt");
CREATE INDEX "SupplierAccountMovement_branchId_createdAt_idx"
  ON "SupplierAccountMovement"("branchId", "createdAt");
CREATE INDEX "SupplierAccountMovement_receiptId_idx"
  ON "SupplierAccountMovement"("receiptId");
CREATE INDEX "SupplierAccountMovement_paymentId_idx"
  ON "SupplierAccountMovement"("paymentId");
CREATE INDEX "SupplierAccountMovement_userId_idx"
  ON "SupplierAccountMovement"("userId");


-- -------------------------------------------------------------------------
-- 5. Inmutabilidad del libro
--
-- Un movimiento no se edita y no se borra. Los errores se corrigen con otro
-- movimiento, igual que en un libro contable y igual que en los otros dos
-- libros del sistema.
--
-- Va en la base y no solo en el codigo porque en el codigo protege de los
-- errores propios, y aca protege ademas de un UPDATE a mano desde psql. La
-- pregunta que responde: "¿podria alguien borrar una deuda con un proveedor sin
-- que quede rastro?". Con esto, no: tendria que escribir otro movimiento, con
-- su usuario y su motivo.
--
-- TRUNCATE no dispara disparadores de fila, asi que el reinicio de la base de
-- pruebas sigue funcionando.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "supplier_account_movement_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Los movimientos de cuenta de proveedor son inmutables (intento de % sobre el id %). '
    'Para corregir un error, registra otro movimiento.',
    TG_OP, OLD."id";
END $$;

CREATE TRIGGER "SupplierAccountMovement_inmutable"
  BEFORE UPDATE OR DELETE ON "SupplierAccountMovement"
  FOR EACH ROW EXECUTE FUNCTION "supplier_account_movement_inmutable"();


-- -------------------------------------------------------------------------
-- 6. Inmutabilidad del pago
--
-- Un pago a proveedor tampoco se edita ni se borra. Ya movio un saldo, ya salio
-- plata del cajon y ya se imprimio un comprobante que el proveedor puede tener
-- en la mano. Editarlo dejaria el libro contando una historia y el papel
-- contando otra.
--
-- Va en ESTA migracion y no en la anterior a proposito, igual que en la Fase
-- 4A: hasta que existe el libro, un pago no tiene consecuencias, y la
-- inmutabilidad protege justamente la consecuencia.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "supplier_payment_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Los pagos a proveedores son inmutables (intento de % sobre el id %). '
    'Para corregir un error, registra una nota de credito o un ajuste con su motivo.',
    TG_OP, OLD."id";
END $$;

CREATE TRIGGER "SupplierPayment_inmutable"
  BEFORE UPDATE OR DELETE ON "SupplierPayment"
  FOR EACH ROW EXECUTE FUNCTION "supplier_payment_inmutable"();


-- -------------------------------------------------------------------------
-- 7. Comprobacion posterior
--
-- La invariante del libro tiene que cumplirse ya mismo. Sobre una base recien
-- migrada es trivialmente cierta --los saldos estan en cero y no hay
-- movimientos-- y por eso mismo vale la pena dejarla escrita: es la unica forma
-- de que una re-aplicacion sobre una base que YA tenia saldos no pase
-- inadvertida.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  descuadres integer;
BEGIN
  SELECT count(*) INTO descuadres
    FROM "Supplier" s
    LEFT JOIN (
      SELECT "supplierId", sum("amount") AS total
        FROM "SupplierAccountMovement"
       GROUP BY "supplierId"
    ) m ON m."supplierId" = s."id"
   WHERE s."balance" <> COALESCE(m.total, 0);

  IF descuadres > 0 THEN
    RAISE EXCEPTION
      'El libro de proveedores no cuadra en % proveedor(es) despues de migrar. '
      'No se aplica la migracion.', descuadres;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP TRIGGER "SupplierPayment_inmutable" ON "SupplierPayment";
--   DROP FUNCTION "supplier_payment_inmutable"();
--   DROP TRIGGER "SupplierAccountMovement_inmutable" ON "SupplierAccountMovement";
--   DROP FUNCTION "supplier_account_movement_inmutable"();
--   DROP TABLE "SupplierAccountMovement";
--
-- Advertencia: la marcha atras PIERDE EL LIBRO. Los movimientos no estan en
-- ningun otro lado --son informacion nueva, no una copia-- y con ellos se
-- pierde la explicacion de cada saldo: queda el numero y no el por que. Un
-- proveedor que reclame "esa entrega no me la pagaste" no va a tener contra que
-- comprobarlo.
--
-- El saldo ("Supplier"."balance") sobrevive intacto porque nunca dejo de
-- mantenerse. Exportar el libro antes:
--   \copy (SELECT * FROM "SupplierAccountMovement" ORDER BY "id")
--     TO 'cuenta_proveedores.csv' CSV HEADER
-- =========================================================================
