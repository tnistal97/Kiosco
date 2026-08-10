-- =========================================================================
-- Fase 4A — La venta puede tener cliente
--
-- Que hace:
--   1. Agrega "Sale"."clientId", NULLABLE, con su clave foranea y su indice.
--
-- Riesgo: BAJO. Es ADITIVA. La columna admite nulo y no tiene valor por
-- omision distinto de NULL, asi que ninguna venta existente cambia de
-- significado y ningun INSERT anterior deja de funcionar.
--
-- Reversible: SI. El rollback pierde la asociacion venta-cliente, que es
-- informacion nueva.
--
-- IMPORTANTE — que significa NULL en esta columna:
--
--   NULL es VENTA AL MOSTRADOR, no "cliente desconocido". Un almacen no le
--   pide el nombre a quien compra un paquete de yerba. Todas las ventas
--   anteriores a esta fase quedan en NULL y NO se les inventa un cliente:
--   inventarlo seria afirmar que alguien compro algo que no se sabe si
--   compro. Ver el objetivo 27 y docs/CUSTOMER_MODEL.md.
--
-- Ver docs/CREDIT_POLICY.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La columna
-- -------------------------------------------------------------------------
ALTER TABLE "Sale" ADD COLUMN "clientId" INTEGER;


-- -------------------------------------------------------------------------
-- 2. Clave foranea
--
-- RESTRICT: un cliente con ventas no se borra, se da de baja. Borrarlo
-- falsearia el historial de meses anteriores, que es exactamente el mismo
-- criterio que con productos y proveedores.
-- -------------------------------------------------------------------------
ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "Client"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 3. Indice
--
-- "Las ventas de este cliente, de la mas nueva a la mas vieja" es una de las
-- tres listas de la ficha. Sin indice seria un recorrido de toda la tabla de
-- ventas cada vez que alguien abre un cliente.
-- -------------------------------------------------------------------------
CREATE INDEX "Sale_clientId_date_idx" ON "Sale"("clientId", "date");


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP INDEX "Sale_clientId_date_idx";
--   ALTER TABLE "Sale" DROP CONSTRAINT "Sale_clientId_fkey";
--   ALTER TABLE "Sale" DROP COLUMN "clientId";
--
-- Advertencia: DROP COLUMN es destructivo y se lleva la asociacion entre cada
-- venta y su cliente. Antes de ejecutarlo hay que exportarla, porque el libro
-- de cuenta corriente guarda el `saleId` pero no al reves:
--   \copy (SELECT "id", "clientId" FROM "Sale" WHERE "clientId" IS NOT NULL)
--     TO 'ventas_por_cliente.csv' CSV HEADER
-- =========================================================================
