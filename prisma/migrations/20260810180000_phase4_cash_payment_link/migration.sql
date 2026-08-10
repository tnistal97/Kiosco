-- =========================================================================
-- Fase 4A — El movimiento de caja dice de que cobro vino
--
-- Que hace:
--   1. Agrega "CashRegisterMovement"."customerPaymentId" con su FK e indice.
--
-- Riesgo: BAJO. Es ADITIVA. La columna admite nulo, y NULL es la respuesta
-- correcta para todos los movimientos anteriores: no vinieron de ningun cobro.
--
-- Reversible: SI. El rollback pierde el vinculo, que es informacion nueva.
--
-- POR QUE EXISTE, y por que no alcanzaba con la descripcion:
--
--   Un cobro en efectivo genera un movimiento de caja. La reconciliacion tiene
--   que poder unir los dos para comprobar que el efectivo que entro por
--   cobranza llego al cajon --y que el que NO fue en efectivo no llego--.
--
--   Sin esta columna, esa union se haria buscando el numero de comprobante
--   dentro de `description` con un LIKE. Es exactamente el parseo de
--   "Venta #123" que la Fase 3 elimino agregando `saleId`, y es peor de lo que
--   parece: bastaria con cambiar como se redacta esa frase para que la
--   comprobacion dejara de encontrar nada y empezara a informar que todo
--   cierra. Una reconciliacion que falla en silencio es peor que no tenerla.
--
--   Un `description` es para leer en pantalla. Para unir tablas estan las
--   claves foraneas.
--
-- Va en su propia migracion y no dentro de phase4_customer_payments porque esa
-- ya estaba aplicada cuando aparecio la necesidad. Las migraciones de este
-- proyecto son APPEND-ONLY: editar una ya aplicada cambia su checksum y deja la
-- base de cualquiera que la haya corrido en un estado que Prisma no reconoce.
--
-- Ver docs/CUSTOMER_PAYMENT_FLOW.md.
-- =========================================================================


ALTER TABLE "CashRegisterMovement" ADD COLUMN "customerPaymentId" INTEGER;

-- SET NULL, no CASCADE: un movimiento de caja es historia del cajon y no se
-- borra porque desaparezca aquello que lo origino. En la practica no puede
-- ocurrir --`CustomerPayment` es inmutable y tiene un disparador que impide el
-- DELETE-- pero la accion declarada tiene que decir lo correcto igual.
ALTER TABLE "CashRegisterMovement"
  ADD CONSTRAINT "CashRegisterMovement_customerPaymentId_fkey"
  FOREIGN KEY ("customerPaymentId") REFERENCES "CustomerPayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CashRegisterMovement_customerPaymentId_idx"
  ON "CashRegisterMovement"("customerPaymentId");


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP INDEX "CashRegisterMovement_customerPaymentId_idx";
--   ALTER TABLE "CashRegisterMovement"
--     DROP CONSTRAINT "CashRegisterMovement_customerPaymentId_fkey";
--   ALTER TABLE "CashRegisterMovement" DROP COLUMN "customerPaymentId";
--
-- Advertencia: DROP COLUMN es destructivo. Se lleva el vinculo entre cada
-- movimiento de caja y su cobro, y con el la comprobacion "Cobros a clientes"
-- deja de poder correr. Exportar antes:
--   \copy (SELECT "id", "customerPaymentId" FROM "CashRegisterMovement"
--           WHERE "customerPaymentId" IS NOT NULL)
--     TO 'caja_por_cobro.csv' CSV HEADER
-- =========================================================================
