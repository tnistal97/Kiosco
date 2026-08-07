-- Fase 3 -- Los pagos dejan de ser un string dentro del movimiento de caja
--
-- Hasta ahora el medio de pago de una venta vivia en
-- `CashRegisterMovement.paymentMethod`, uno solo por venta. Eso hacia imposible
-- "mitad efectivo, mitad transferencia", que es la mitad de las ventas de un
-- almacen a fin de mes.
--
-- La regla que hace util la entidad nueva:
--
--   LA SUMA DE LOS PAGOS ES EXACTAMENTE EL TOTAL DE LA VENTA.
--
-- Con `Float` esa igualdad fallaba sola --99.99 + 0.01 no daba 100-- y por eso
-- el dinero se migro a Decimal ANTES que esto.
--
-- ADITIVA. Crea una tabla, agrega una columna con valor por defecto y
-- normaliza el vocabulario de un campo de texto. La version anterior del
-- codigo sigue leyendo `paymentMethod` --con los valores nuevos, que no
-- reconoce-- asi que la vuelta atras util es el DOWN, no el redespliegue.

-- 1) El total de la venta.
--
-- Se guarda y no se deriva: es contra ESTE numero que se comprueba la suma de
-- los pagos, y recalcularlo dos anios despues con el mismo redondeo y el mismo
-- orden no se puede garantizar.
ALTER TABLE "Sale" ADD COLUMN "total" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Relleno: la suma de los subtotales de cada linea, redondeando cada uno a dos
-- decimales ANTES de sumar. Es el mismo orden que usa `createSale`, asi que el
-- total historico coincide con el que se le cobro al cliente.
UPDATE "Sale" s
   SET "total" = COALESCE((
         SELECT sum(round(i."price" * i."quantity", 2))
           FROM "SaleItem" i
          WHERE i."saleId" = s."id"
       ), 0);

-- 2) La tabla de pagos.
CREATE TABLE "SalePayment" (
  "id"           SERIAL PRIMARY KEY,
  "saleId"       INTEGER NOT NULL,
  "method"       TEXT NOT NULL,
  "amount"       DECIMAL(14,2) NOT NULL,
  "cashReceived" DECIMAL(14,2),
  "changeGiven"  DECIMAL(14,2),
  "reference"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SalePayment_saleId_idx" ON "SalePayment"("saleId");
CREATE INDEX "SalePayment_method_idx" ON "SalePayment"("method");

-- Vocabulario cerrado. Sin esto, un medio mal escrito entra sin ruido y
-- aparece meses despues como una categoria fantasma en un reporte.
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_method_check"
  CHECK ("method" IN ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER', 'CARD'));

-- Un pago de cero no es un pago. Y el vuelto solo tiene sentido con efectivo:
-- no se puede recibir de mas en una transferencia.
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_amount_check"
  CHECK ("amount" > 0);
ALTER TABLE "SalePayment" ADD CONSTRAINT "SalePayment_cash_fields_check"
  CHECK ("method" = 'CASH' OR ("cashReceived" IS NULL AND "changeGiven" IS NULL));

-- 3) Migracion de las ventas historicas.
--
-- UN PAGO POR VENTA, con el medio que estaba registrado. No se inventa un
-- reparto: si la venta tenia un solo medio, tiene un solo pago.
--
-- La equivalencia de vocabulario --y la unica decision discutible de toda la
-- migracion-- esta en src/modules/sales/payment-methods.ts:
--
--   efectivo      → CASH
--   tarjeta       → CARD       el sistema NUNCA distinguio debito de credito.
--                              Convertirlas a DEBIT_CARD seria inventar un
--                              dato; usar OTHER seria perder uno. Se conserva
--                              tal cual era, con su propio codigo, y el POS no
--                              lo ofrece: las ventas nuevas eligen una u otra.
--   mercado_pago  → TRANSFER   con la referencia escrita, para no perderla.
--
-- El importe sale del movimiento de caja, que es lo que de verdad se cobro.
INSERT INTO "SalePayment" ("saleId", "method", "amount", "reference", "createdAt")
SELECT
  m."saleId",
  CASE m."paymentMethod"
    WHEN 'efectivo'     THEN 'CASH'
    WHEN 'tarjeta'      THEN 'CARD'
    WHEN 'mercado_pago' THEN 'TRANSFER'
    ELSE 'OTHER'
  END,
  m."amount",
  CASE WHEN m."paymentMethod" = 'mercado_pago' THEN 'Mercado Pago' ELSE NULL END,
  m."date"
FROM "CashRegisterMovement" m
WHERE m."type" = 'sale'
  AND m."saleId" IS NOT NULL
  AND m."amount" > 0;

-- 4) Un solo vocabulario en todo el sistema.
--
-- `CashRegisterMovement.paymentMethod` se normaliza a los mismos codigos. Dos
-- vocabularios para el mismo concepto es lo que hacia que una venta figurara
-- como "Sin registrar" cuando el texto no coincidia exactamente.
UPDATE "CashRegisterMovement"
   SET "paymentMethod" = CASE "paymentMethod"
     WHEN 'efectivo'     THEN 'CASH'
     WHEN 'tarjeta'      THEN 'CARD'
     WHEN 'mercado_pago' THEN 'TRANSFER'
     ELSE "paymentMethod"
   END
 WHERE "paymentMethod" IN ('efectivo', 'tarjeta', 'mercado_pago');

ALTER TABLE "CashRegisterMovement" ADD CONSTRAINT "CashRegisterMovement_method_check"
  CHECK ("paymentMethod" IN ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER', 'CARD'));

-- 5) Comprobacion: ninguna venta completada puede quedar con los pagos
--    descuadrados respecto de su total.
--
-- Se admite una venta sin pagos --las que nunca generaron movimiento de caja,
-- que en la base historica existen-- pero NO una con pagos que no sumen el
-- total. Ese es el invariante que la fase entera viene a garantizar, y si no
-- se cumple ya en los datos historicos hay que verlo ahora y no dentro de seis
-- meses en un reporte.
DO $$
DECLARE
  descuadradas integer;
BEGIN
  SELECT count(*) INTO descuadradas
  FROM "Sale" s
  WHERE EXISTS (SELECT 1 FROM "SalePayment" p WHERE p."saleId" = s."id")
    AND s."total" <> (SELECT sum(p."amount") FROM "SalePayment" p WHERE p."saleId" = s."id");

  IF descuadradas > 0 THEN
    RAISE WARNING
      'Hay % ventas historicas cuyos pagos no suman su total. Quedan migradas tal cual estaban: corregirlas seria inventar datos. Revisar con: SELECT s.id, s.total, sum(p.amount) FROM "Sale" s JOIN "SalePayment" p ON p."saleId" = s.id GROUP BY s.id, s.total HAVING s.total <> sum(p.amount);',
      descuadradas;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- DOWN (no se ejecuta; es lo unico que queda si hay que revertir a mano)
--
--   ALTER TABLE "CashRegisterMovement" DROP CONSTRAINT "CashRegisterMovement_method_check";
--   UPDATE "CashRegisterMovement"
--      SET "paymentMethod" = CASE "paymentMethod"
--        WHEN 'CASH'     THEN 'efectivo'
--        WHEN 'CARD'     THEN 'tarjeta'
--        WHEN 'TRANSFER' THEN 'mercado_pago'
--        ELSE 'tarjeta'
--      END;
--   DROP TABLE "SalePayment";
--   ALTER TABLE "Sale" DROP COLUMN "total";
--
-- Ojo con el `ELSE 'tarjeta'`: los medios nuevos --DEBIT_CARD, CREDIT_CARD,
-- OTHER-- no existen en el vocabulario viejo y se colapsan. Es perdida de
-- informacion, y es la razon por la que la vuelta atras de verdad es el
-- respaldo previo y no este bloque.
