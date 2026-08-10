-- =========================================================================
-- Fase 4A — Una linea de pago puede ser "a cuenta"
--
-- Que hace:
--   1. Reemplaza la lista blanca de medios de "SalePayment" para incluir
--      'ACCOUNT'.
--
-- Riesgo: BAJO. AMPLIA una restriccion, no la afloja en lo que ya cubria: los
-- seis medios anteriores siguen siendo los unicos validos ademas del nuevo.
-- Ninguna fila existente puede dejar de cumplirla.
--
-- Reversible: SI, mientras no haya ninguna fila con 'ACCOUNT'. Con fiado
-- registrado, la vuelta atras falla al validar --que es lo correcto: esas
-- ventas existen y su cobertura tiene que poder expresarse--.
--
-- POR QUE ESTA LISTA SE AMPLIA Y LAS OTRAS DOS NO:
--
--   "SalePayment"           SI. Una venta puede quedar cubierta en parte por
--                           un saldo a cuenta, y la invariante
--                           `suma(pagos) == total` tiene que seguir cerrando.
--
--   "CashRegisterMovement"  NO, y es deliberado. Un cargo a cuenta no es plata
--                           que entro ni salio del cajon: es una promesa.
--                           Dejarlo entrar aca haria que el listado del turno
--                           muestre dinero que nadie recibio. Que la base lo
--                           RECHACE es la garantia de que ningun camino futuro
--                           lo intente por descuido.
--
--   "CustomerPayment"       NO. Pagar la cuenta con la cuenta no significa
--                           nada: dejaria el saldo igual y generaria dos
--                           movimientos que se cancelan.
--
-- Va en su propia migracion y no dentro de phase4_sale_client porque esa ya
-- estaba aplicada. Las migraciones de este proyecto son APPEND-ONLY: editar una
-- ya aplicada cambia su checksum y deja la base de cualquiera que la haya
-- corrido en un estado que Prisma no reconoce.
--
-- Ver docs/CUSTOMER_ACCOUNT_LEDGER.md y src/modules/sales/payment-methods.ts.
-- =========================================================================


-- El DROP y el ADD van juntos, en esta misma migracion y con el MISMO nombre.
-- No es casualidad ni estilo: la guardia de migraciones destructivas
-- (tests/migrations/chain.test.ts) comprueba exactamente eso. Un DROP CONSTRAINT
-- sin su ADD correspondiente es una garantia que se pierde en silencio, y esa
-- si exige declararse como destructiva.
ALTER TABLE "SalePayment" DROP CONSTRAINT "SalePayment_method_check";

ALTER TABLE "SalePayment"
  ADD CONSTRAINT "SalePayment_method_check"
  CHECK ("method" IN ('CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'TRANSFER', 'OTHER', 'CARD', 'ACCOUNT'));


-- `SalePayment_cash_fields_check` NO se toca, y ya dice lo correcto para el
-- caso nuevo: solo un pago en efectivo puede declarar `cashReceived` y
-- `changeGiven`. Un saldo a cuenta no se paga con nada, asi que no tiene vuelto.


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   ALTER TABLE "SalePayment" DROP CONSTRAINT "SalePayment_method_check";
--   ALTER TABLE "SalePayment"
--     ADD CONSTRAINT "SalePayment_method_check"
--     CHECK ("method" IN ('CASH','DEBIT_CARD','CREDIT_CARD','TRANSFER','OTHER','CARD'));
--
-- Advertencia: falla si existe alguna venta con parte a cuenta. Comprobar
-- antes, y no forzarlo:
--   SELECT count(*) FROM "SalePayment" WHERE "method" = 'ACCOUNT';
--
-- Si hay filas, la marcha atras de esta migracion exige antes deshacer la del
-- libro de cuenta corriente, que es la que les da sentido.
-- =========================================================================
