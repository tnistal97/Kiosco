-- =========================================================================
-- Fase 4B — Imputacion de pagos a obligaciones
--
-- Que hace:
--   1. Crea "SupplierPaymentAllocation" con sus restricciones e indices.
--   2. Le da inmutabilidad, porque cuelga de un pago que ya es inmutable.
--
-- Riesgo: BAJO. Es ADITIVA. Una tabla nueva; no modifica ninguna columna
-- existente y no borra nada.
--
-- Reversible: SI. Pierde la imputacion, no el saldo: el saldo sale del libro y
-- el libro no se toca. Ver el rollback al pie.
--
-- QUE RESPONDE ESTA TABLA, y por que no alcanzaba con el saldo. El libro dice
-- cuanto le debemos a un proveedor. No dice cual de las cuatro entregas
-- pendientes salda un pago de $50.000, y esa es la pregunta que se hace cuando
-- el proveedor llama reclamando la del 12.
--
-- Y QUE NO ES: la imputacion es DETALLE, no verdad. El saldo sale del libro y
-- sigue saliendo del libro aunque un pago quede sin imputar. La asimetria es
-- deliberada: si la imputacion fuera la fuente del saldo, un anticipo --plata
-- entregada antes de que exista la obligacion-- no se podria registrar sin
-- inventarle una recepcion. Ver docs/SUPPLIER_PAYMENT_ALLOCATION.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La tabla
-- -------------------------------------------------------------------------
CREATE TABLE "SupplierPaymentAllocation" (
  "id"        SERIAL        NOT NULL,
  "paymentId" INTEGER       NOT NULL,
  "receiptId" INTEGER       NOT NULL,
  "amount"    NUMERIC(14,2) NOT NULL,
  "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplierPaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- Una imputacion de cero no imputa nada y ocupa una fila; una negativa
-- DESIMPUTARIA, que es una operacion que no existe. Las dos son formas de
-- ensuciar la tabla que se cierran con una comparacion.
ALTER TABLE "SupplierPaymentAllocation"
  ADD CONSTRAINT "SupplierPaymentAllocation_importe_check"
  CHECK ("amount" > 0);

-- Un pago imputa UNA VEZ a cada obligacion.
--
-- Dos filas del mismo par serian dos imputaciones parciales que habria que
-- sumar para leer una sola cosa, y harian que "cuanto le puso este pago a esta
-- entrega" tenga dos respuestas. Ademas es la puerta por la que entraria una
-- imputacion duplicada al reintentar una peticion.
CREATE UNIQUE INDEX "SupplierPaymentAllocation_paymentId_receiptId_key"
  ON "SupplierPaymentAllocation"("paymentId", "receiptId");


-- -------------------------------------------------------------------------
-- 2. Claves foraneas
--
-- RESTRICT en las dos: ni el pago ni la recepcion se borran en este sistema
-- --las dos son inmutables-- y una imputacion sin ninguno de los dos extremos
-- no significa nada.
-- -------------------------------------------------------------------------
ALTER TABLE "SupplierPaymentAllocation"
  ADD CONSTRAINT "SupplierPaymentAllocation_paymentId_fkey"
  FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierPaymentAllocation"
  ADD CONSTRAINT "SupplierPaymentAllocation_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 3. Indice
--
-- "Cuanto lleva pagado esta entrega" es LA consulta del modulo: la usa el
-- pendiente de cada obligacion, la tabla de deudas abiertas, la imputacion
-- automatica y dos de las cinco reconciliaciones. El indice del par
-- (pago, recepcion) de arriba no sirve para esta, porque empieza por el pago.
-- -------------------------------------------------------------------------
CREATE INDEX "SupplierPaymentAllocation_receiptId_idx"
  ON "SupplierPaymentAllocation"("receiptId");


-- -------------------------------------------------------------------------
-- 4. Inmutabilidad
--
-- Cuelga de un pago que ya es inmutable, y sin esto seria la puerta de atras:
-- el pago no se puede tocar, pero se podria mover su imputacion de una entrega
-- a otra y cambiar cual de las dos figura como pagada. El saldo no se moveria
-- --la imputacion no lo decide-- y por eso mismo no se notaria.
--
-- Corregir una imputacion equivocada no es editarla: es registrar el pago que
-- corresponde, o dejar constancia con una nota de credito o un ajuste. Ver
-- docs/SUPPLIER_PAYMENT_ALLOCATION.md, seccion "corregir una imputacion".
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "supplier_payment_allocation_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Las imputaciones de pago a proveedor son inmutables (intento de % sobre el id %). '
    'Cuelgan de un pago que tampoco se edita.',
    TG_OP, OLD."id";
END $$;

CREATE TRIGGER "SupplierPaymentAllocation_inmutable"
  BEFORE UPDATE OR DELETE ON "SupplierPaymentAllocation"
  FOR EACH ROW EXECUTE FUNCTION "supplier_payment_allocation_inmutable"();


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP TRIGGER "SupplierPaymentAllocation_inmutable" ON "SupplierPaymentAllocation";
--   DROP FUNCTION "supplier_payment_allocation_inmutable"();
--   DROP TABLE "SupplierPaymentAllocation";
--
-- Que se pierde: QUE PAGO CANCELO QUE ENTREGA. Los saldos no se mueven --salen
-- del libro, que no se toca-- y los pagos siguen enteros; lo que desaparece es
-- la trazabilidad entre unos y otras, y con ella la tabla de deudas abiertas,
-- que pasa a no poder calcular el pendiente de cada recepcion.
--
-- Exportarlas antes:
--   \copy (SELECT * FROM "SupplierPaymentAllocation" ORDER BY "id")
--     TO 'imputaciones.csv' CSV HEADER
-- =========================================================================
