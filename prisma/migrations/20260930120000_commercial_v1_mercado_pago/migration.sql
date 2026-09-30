-- =========================================================================
-- V1 comercial — Mercado Pago como medio de pago propio
--
-- Que hace:
--   1. Amplia la lista blanca de medios en "SalePayment", en
--      "CashRegisterMovement" y en "CustomerPayment" para incluir
--      'MERCADO_PAGO'.
--
-- Riesgo: BAJO. AMPLIA tres restricciones, no las afloja en lo que ya
-- cubrian: los medios anteriores siguen siendo los unicos validos ademas del
-- nuevo. Ninguna fila existente puede dejar de cumplirlas. No agrega columnas
-- ni cambia tipos; el codigo anterior sigue funcionando sobre esta base.
--
-- Reversible: SI, mientras no haya ninguna fila con 'MERCADO_PAGO'. Con
-- cobros ya registrados, la vuelta atras falla al validar --que es lo
-- correcto: esas ventas existen y su medio tiene que poder expresarse--.
--
-- POR QUE LAS TRES:
--
--   "SalePayment"           una venta se puede cobrar por Mercado Pago, sola
--                           o combinada con otros medios.
--
--   "CashRegisterMovement"  cada linea de pago que NO es a cuenta deja su
--                           movimiento en el listado del turno con su medio,
--                           y la comprobacion de integridad compara medio
--                           por medio. Sin esto, la venta se guardaria y el
--                           movimiento fallaria. NO suma al efectivo esperado:
--                           el esperado suma solo 'CASH' y eso no cambia.
--
--   "CustomerPayment"       un cliente puede pagar lo que debe por Mercado
--                           Pago, igual que por transferencia.
--
--   "SupplierPayment"       NO se toca. A un proveedor se le paga con la
--                           cuenta del negocio, y ese vocabulario (efectivo,
--                           transferencia, tarjeta, otro) no cambia en esta
--                           tanda.
--
-- POR QUE NO SE CONVIERTEN LAS FILAS HISTORICAS:
--
--   La migracion de la Fase 3 (20260807120000_phase3_sale_payments) llevo el
--   medio viejo `mercado_pago` a 'TRANSFER' con la referencia "Mercado Pago".
--   Desde entonces, cualquier cajero pudo escribir esa misma referencia a
--   mano en una transferencia comun, y la fila resultante es INDISTINGUIBLE
--   de la migrada. Ademas, cada una de esas ventas tiene su movimiento de
--   caja con 'TRANSFER' y su fila de bitacora con los pagos tal como se
--   guardaron: reescribirlas exigiria reescribir tambien la bitacora, que es
--   inmutable por diseno.
--
--   Regla del proyecto: no se adivina un dato a partir de una referencia
--   ambigua. Las filas quedan como estan. El reporte las sigue mostrando como
--   "Transferencia" con la referencia visible, que es exactamente lo que se
--   guardo. Lo nuevo se registra con el codigo propio a partir de hoy.
--
-- Las migraciones de este proyecto son APPEND-ONLY: editar una ya aplicada
-- cambia su checksum y deja la base de cualquiera que la haya corrido en un
-- estado que Prisma no reconoce.
--
-- Ver src/modules/sales/payment-methods.ts.
-- =========================================================================


-- El DROP y el ADD van juntos, en esta misma migracion y con el MISMO nombre.
-- La guardia de migraciones destructivas (tests/migrations/chain.test.ts)
-- comprueba exactamente eso.

ALTER TABLE "SalePayment" DROP CONSTRAINT "SalePayment_method_check";

ALTER TABLE "SalePayment"
  ADD CONSTRAINT "SalePayment_method_check"
  CHECK ("method" IN ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'MERCADO_PAGO', 'OTHER', 'CARD', 'ACCOUNT'));


ALTER TABLE "CashRegisterMovement" DROP CONSTRAINT "CashRegisterMovement_method_check";

ALTER TABLE "CashRegisterMovement"
  ADD CONSTRAINT "CashRegisterMovement_method_check"
  CHECK ("paymentMethod" IN ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'MERCADO_PAGO', 'OTHER', 'CARD'));


ALTER TABLE "CustomerPayment" DROP CONSTRAINT "CustomerPayment_medio_check";

ALTER TABLE "CustomerPayment"
  ADD CONSTRAINT "CustomerPayment_medio_check"
  CHECK ("method" IN ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'MERCADO_PAGO', 'OTHER'));


-- `SalePayment_cash_fields_check` NO se toca: solo un pago en efectivo puede
-- declarar `cashReceived` y `changeGiven`, y Mercado Pago no da vuelto.


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   ALTER TABLE "SalePayment" DROP CONSTRAINT "SalePayment_method_check";
--   ALTER TABLE "SalePayment"
--     ADD CONSTRAINT "SalePayment_method_check"
--     CHECK ("method" IN ('CASH','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER','CARD','ACCOUNT'));
--
--   ALTER TABLE "CashRegisterMovement" DROP CONSTRAINT "CashRegisterMovement_method_check";
--   ALTER TABLE "CashRegisterMovement"
--     ADD CONSTRAINT "CashRegisterMovement_method_check"
--     CHECK ("paymentMethod" IN ('CASH','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER','CARD'));
--
--   ALTER TABLE "CustomerPayment" DROP CONSTRAINT "CustomerPayment_medio_check";
--   ALTER TABLE "CustomerPayment"
--     ADD CONSTRAINT "CustomerPayment_medio_check"
--     CHECK ("method" IN ('CASH','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER'));
--
-- Advertencia: falla si existe alguna fila con 'MERCADO_PAGO'. Comprobar
-- antes, y no forzarlo:
--   SELECT count(*) FROM "SalePayment"          WHERE "method"        = 'MERCADO_PAGO';
--   SELECT count(*) FROM "CashRegisterMovement" WHERE "paymentMethod" = 'MERCADO_PAGO';
--   SELECT count(*) FROM "CustomerPayment"      WHERE "method"        = 'MERCADO_PAGO';
--
-- Si hay filas, la unica marcha atras sin perder el dato es convertirlas a
-- 'TRANSFER' con la referencia "Mercado Pago" --el formato de la Fase 3-- en
-- las tres tablas a la vez, y recien despues restaurar las restricciones.
-- =========================================================================
