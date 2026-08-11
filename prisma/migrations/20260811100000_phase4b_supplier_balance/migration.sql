-- =========================================================================
-- Fase 4B — El proveedor tiene saldo y plazo de pago
--
-- Que hace:
--   1. Agrega "Supplier"."balance", el saldo materializado del libro.
--   2. Agrega "Supplier"."defaultPaymentTermDays", el plazo habitual.
--   3. Indexa el saldo, que es por donde filtra el reporte.
--
-- Riesgo: BAJO. Es ADITIVA. Dos columnas nuevas con valor por omision; no
-- modifica ninguna columna existente y no borra nada.
--
-- Reversible: SI, sin perdida. Las dos columnas nacen vacias en esta migracion
-- --el saldo en cero, el plazo en NULL-- asi que revertirla en el mismo
-- despliegue no pierde ningun dato. Lo que si pierde es el saldo acumulado si
-- se revierte DESPUES de haber operado: ver el rollback al pie.
--
-- SEPARADA de la que crea el libro a proposito. Son dos cosas distintas: esto
-- le agrega dos columnas a una tabla que ya existe y se lee en todas las
-- pantallas de compras; aquello crea una tabla nueva con disparadores. Si algo
-- sale mal, importa saber cual de las dos fue.
--
-- Ver docs/SUPPLIER_ACCOUNT_LEDGER.md y docs/ACCOUNTS_PAYABLE_POLICY.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. El saldo
--
-- POSITIVO = LE DEBEMOS. Empieza en cero para todos, incluidos los proveedores
-- que ya existian: esta migracion NO inventa deuda historica.
--
-- La decision esta en el objetivo 36 y es deliberada. Una recepcion de hace
-- seis meses casi con seguridad ya se pago --por transferencia, en efectivo, en
-- una cuenta que nadie llevaba en este sistema-- y darla por impaga le
-- inventaria al almacen una deuda que no tiene. El caso contrario, que quede
-- deuda vieja sin registrar, se corrige con un ajuste manual con motivo, que es
-- una operacion que existe, deja rastro y la hace una persona que sabe cuanto
-- se debe de verdad.
-- -------------------------------------------------------------------------
ALTER TABLE "Supplier"
  ADD COLUMN "balance" NUMERIC(14,2) NOT NULL DEFAULT 0;


-- -------------------------------------------------------------------------
-- 2. El plazo de pago habitual
--
-- NULL y 0 son afirmaciones distintas, igual que el limite de credito del
-- cliente:
--
--   NULL  nadie declaro el plazo. No se sugiere vencimiento.
--   0     se le paga contra entrega. Vence el mismo dia.
--
-- Por eso es nulo y no `DEFAULT 30`: con treinta por omision, todo proveedor
-- nacería con un plazo que nadie pacto, y el sistema estaria afirmando algo
-- sobre un acuerdo comercial del que no sabe nada.
--
-- El CHECK impide un plazo negativo, que seria un vencimiento anterior a la
-- entrega. El tope de 3650 dias --diez anios-- no protege de nada real; ataja
-- el dedazo de quien escribe 3000 donde queria 30 y no se entera hasta que la
-- deuda no aparece nunca como vencida.
-- -------------------------------------------------------------------------
ALTER TABLE "Supplier"
  ADD COLUMN "defaultPaymentTermDays" INTEGER;

ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_plazo_check"
  CHECK ("defaultPaymentTermDays" IS NULL
         OR ("defaultPaymentTermDays" >= 0 AND "defaultPaymentTermDays" <= 3650));


-- -------------------------------------------------------------------------
-- 3. El indice del saldo
--
-- "A quienes les debemos" y "quienes tienen credito nuestro" son dos filtros de
-- la pantalla y las dos consultas del reporte de cuentas por pagar. Sin indice
-- son un recorrido completo de la tabla, que hoy no se nota con veinte
-- proveedores y se nota con cinco mil.
-- -------------------------------------------------------------------------
CREATE INDEX "Supplier_balance_idx" ON "Supplier"("balance");


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP INDEX "Supplier_balance_idx";
--   ALTER TABLE "Supplier" DROP CONSTRAINT "Supplier_plazo_check";
--   ALTER TABLE "Supplier" DROP COLUMN "defaultPaymentTermDays";
--   ALTER TABLE "Supplier" DROP COLUMN "balance";
--
-- Advertencia: revertir DESPUES de haber operado pierde el saldo de cada
-- proveedor. No pierde la INFORMACION --el libro
-- ("SupplierAccountMovement") la tiene entera, y el saldo se reconstruye
-- sumandolo-- pero si obliga a reconstruirla. Volver a aplicar esta migracion
-- deja todos los saldos en cero y NO los recalcula: hay que hacerlo a mano con
--
--   UPDATE "Supplier" s
--      SET "balance" = COALESCE((SELECT sum(m."amount")
--                                  FROM "SupplierAccountMovement" m
--                                 WHERE m."supplierId" = s."id"), 0);
--
-- Si se revierte tambien el libro, ahi si se pierde la informacion. Ver la
-- advertencia de 20260811130000_phase4b_supplier_accounts.
-- =========================================================================
