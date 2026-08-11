-- =========================================================================
-- Fase 4B — Pagos a proveedores
--
-- Que hace:
--   1. Crea la secuencia del numero de comprobante interno ("PP-00000128").
--   2. Crea "SupplierPayment" con sus restricciones, claves e indices.
--   3. Agrega "CashRegisterMovement"."supplierPaymentId", el vinculo con caja.
--
-- Riesgo: BAJO. Es ADITIVA. Una tabla nueva, una secuencia nueva y una columna
-- nullable en una tabla existente. No modifica ninguna columna y no borra nada.
--
-- Reversible: SI. Pierde los pagos registrados desde que se aplico, que es
-- informacion nueva y no una copia. Ver el rollback al pie.
--
-- La INMUTABILIDAD de esta tabla NO se define aca: se define en la migracion
-- siguiente, junto con la del libro. Es deliberado y es el mismo criterio que
-- en la Fase 4A: hasta que existe el libro, un pago no tiene consecuencias, y
-- lo que la inmutabilidad protege es justamente la consecuencia.
--
-- Ver docs/SUPPLIER_PAYMENT_FLOW.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La secuencia del numero
--
-- Mismo mecanismo que "PurchaseOrder_numero_seq" y "CustomerPayment_numero_seq",
-- y por el mismo motivo: `count() + 1` hace que dos pagos simultaneos lean el
-- mismo numero, y el indice unico rechace a uno de los dos con un error que
-- habla de una restriccion en vez de decir "volve a intentar".
--
-- `nextval()` es atomico y NO BLOQUEA. Deja huecos --una transaccion que se
-- deshace se lleva su numero-- y esta bien: es una etiqueta para decir "el
-- pago PP-128" por telefono, no un contador de cuantos pagos hubo.
--
-- El prefijo es "PP" de "pago a proveedor". No es "OP" ni "PA": ninguno de los
-- dos se distingue de un vistazo de "OC" (orden de compra) en una lista donde
-- las dos cosas aparecen juntas, y una etiqueta que hay que leer dos veces no
-- sirve para nombrar algo por telefono.
-- -------------------------------------------------------------------------
CREATE SEQUENCE "SupplierPayment_numero_seq" AS BIGINT START WITH 1 INCREMENT BY 1;


-- -------------------------------------------------------------------------
-- 2. La tabla
-- -------------------------------------------------------------------------
CREATE TABLE "SupplierPayment" (
  "id"          SERIAL        NOT NULL,
  "number"      TEXT          NOT NULL,
  "branchId"    INTEGER       NOT NULL,
  "supplierId"  INTEGER       NOT NULL,
  "amount"      NUMERIC(14,2) NOT NULL,
  "method"      TEXT          NOT NULL,
  "cashShiftId" INTEGER,
  "paidById"    INTEGER       NOT NULL,
  "paidAt"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reference"   TEXT,
  "notes"       TEXT,
  "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SupplierPayment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupplierPayment_number_key" ON "SupplierPayment"("number");

-- Un pago de importe negativo seria un cargo disfrazado: aumentaria la deuda
-- entrando por la puerta de los pagos, y en el listado se leeria como un pago.
-- El signo lo pone el libro al convertirlo en movimiento; aca el importe es
-- siempre lo que se entrego.
ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_importe_check"
  CHECK ("amount" > 0);

-- Lista blanca de medios. Los cuatro del objetivo 7 y ninguno mas.
--
-- SIN 'ACCOUNT', y no es una omision: pagarle la cuenta al proveedor con su
-- propia cuenta no significa nada. Es la misma exclusion que en el cobro al
-- cliente y por el mismo motivo.
--
-- SIN 'DEBIT_CARD' ni 'CREDIT_CARD' por separado: al proveedor se le paga con
-- la tarjeta del negocio y quien registra el pago no siempre sabe --ni le
-- importa-- cual de las dos era. 'CARD' dice lo que se sabe. Separarlas el dia
-- que haga falta es agregar dos valores a este CHECK.
ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_medio_check"
  CHECK ("method" IN ('CASH', 'TRANSFER', 'CARD', 'OTHER'));

-- NO hay CHECK de "efectivo exige turno", y la ausencia es deliberada.
--
-- La regla existe --un pago en efectivo pide turno abierto, porque la plata
-- sale del cajon y al cerrar aparece como faltante si nadie la registro-- pero
-- NO es absoluta: depende de "Branch"."requireOpenShift", que es la politica
-- que el sistema ya tiene desde la Fase 3 y que una sucursal puede apagar
-- cuando todavia no adopto los turnos. La hace cumplir `turnoParaOperar`, el
-- mismo camino por el que pasan la venta en efectivo y el cobro a un cliente.
--
-- Un CHECK aca la volveria absoluta y contradiria a la sucursal: en un local
-- con los turnos apagados se podria vender en efectivo pero no pagarle al
-- proveedor en efectivo, que es una diferencia que nadie pidio y que no protege
-- nada --sin turnos no hay cierre contra el cual el egreso pudiera faltar--.
-- Alinearse con la politica existente, que es lo que pide el objetivo 16, es
-- exactamente no escribir esta restriccion.
--
-- Al reves tampoco se prohibe: un pago por transferencia PUEDE tener turno --se
-- hizo durante uno-- y eso es informacion util, no un error. Lo que no puede es
-- afectar el efectivo, y de eso se encarga el servicio, que solo crea el
-- movimiento de caja cuando el medio es 'CASH'.


-- -------------------------------------------------------------------------
-- 3. Claves foraneas
--
-- RESTRICT en lo que da contexto al pago --sucursal, proveedor, usuario--:
-- ninguna de esas filas se borra en este sistema, y si alguien lo intentara, un
-- pago sin proveedor no se puede leer.
--
-- El TURNO va en SET NULL, igual que en "CustomerPayment": la columna ya es
-- opcional --un pago por transferencia no tiene turno-- asi que perder el
-- vinculo degrada el dato sin invalidar el pago. Es ademas lo que declara
-- schema.prisma para una relacion opcional; ponerlo en RESTRICT deja el esquema
-- y las migraciones diciendo cosas distintas, y `prisma migrate diff` lo
-- detecta como deriva. (Lo detecto: este archivo decia RESTRICT.)
-- -------------------------------------------------------------------------
ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_cashShiftId_fkey"
  FOREIGN KEY ("cashShiftId") REFERENCES "CashShift"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SupplierPayment"
  ADD CONSTRAINT "SupplierPayment_paidById_fkey"
  FOREIGN KEY ("paidById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. Indices
--
-- Uno por consulta real: los pagos de un proveedor (la ficha), los pagos de la
-- sucursal (el reporte), los de un turno (el cierre) y los de una persona.
-- -------------------------------------------------------------------------
CREATE INDEX "SupplierPayment_supplierId_paidAt_idx"
  ON "SupplierPayment"("supplierId", "paidAt");
CREATE INDEX "SupplierPayment_branchId_paidAt_idx"
  ON "SupplierPayment"("branchId", "paidAt");
CREATE INDEX "SupplierPayment_cashShiftId_idx"
  ON "SupplierPayment"("cashShiftId");
CREATE INDEX "SupplierPayment_paidById_idx"
  ON "SupplierPayment"("paidById");


-- -------------------------------------------------------------------------
-- 5. El vinculo con la caja
--
-- Tercera columna de este tipo en "CashRegisterMovement", despues de "saleId"
-- (Fase 3) y "customerPaymentId" (Fase 4A), y por el mismo motivo que las dos:
-- la reconciliacion de "todo pago en efectivo a un proveedor tiene su egreso de
-- caja" une las dos tablas por una CLAVE FORANEA y no buscando el numero de
-- comprobante dentro de "description" con un LIKE.
--
-- Un "description" es para leerlo en el listado del turno. No es para unir
-- tablas: cambiar el texto de un mensaje no deberia poder romper una
-- comprobacion de integridad.
-- -------------------------------------------------------------------------
ALTER TABLE "CashRegisterMovement"
  ADD COLUMN "supplierPaymentId" INTEGER;

ALTER TABLE "CashRegisterMovement"
  ADD CONSTRAINT "CashRegisterMovement_supplierPaymentId_fkey"
  FOREIGN KEY ("supplierPaymentId") REFERENCES "SupplierPayment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CashRegisterMovement_supplierPaymentId_idx"
  ON "CashRegisterMovement"("supplierPaymentId");


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP INDEX "CashRegisterMovement_supplierPaymentId_idx";
--   ALTER TABLE "CashRegisterMovement"
--     DROP CONSTRAINT "CashRegisterMovement_supplierPaymentId_fkey";
--   ALTER TABLE "CashRegisterMovement" DROP COLUMN "supplierPaymentId";
--   DROP TABLE "SupplierPayment";
--   DROP SEQUENCE "SupplierPayment_numero_seq";
--
-- Advertencia: la marcha atras PIERDE LOS PAGOS. No estan en ningun otro lado
-- --el movimiento de caja registra que salio plata, pero no a quien ni contra
-- que obligacion-- y el libro del proveedor queda apuntando a filas que ya no
-- existen. Si hay que revertir, primero el libro, despues esto. Exportarlos
-- antes:
--   \copy (SELECT * FROM "SupplierPayment" ORDER BY "id")
--     TO 'pagos_proveedores.csv' CSV HEADER
--
-- Volver a aplicar la migracion reinicia la secuencia en 1 y los numeros se
-- repiten. Antes de reabrir la operacion:
--   SELECT setval('"SupplierPayment_numero_seq"',
--                 COALESCE((SELECT max(substring("number" from 4)::bigint)
--                             FROM "SupplierPayment"), 0) + 1, false);
-- =========================================================================
