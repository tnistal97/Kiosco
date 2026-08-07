-- Fase 2 — baja logica de productos
--
-- Aditiva y reversible. No borra, no renombra y no cambia el tipo de nada.
--
-- Por que hace falta: hoy sacar un producto del catalogo significa borrarlo,
-- y borrarlo esta prohibido en cuanto figura en una venta (lo impide
-- `eliminarProducto`). El resultado es que un producto discontinuado se queda
-- para siempre en la caja, ocupando lugar en la busqueda y en el escaneo.
--
-- Con `isActive` el producto sale del catalogo de venta, deja de aparecer en
-- la caja y sigue existiendo para el historial y los reportes.

-- 1) La columna. `DEFAULT true` deja activo todo lo que ya existe, que es lo
--    correcto: hasta hoy no habia forma de dar de baja nada.
ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- 2) Indice para la consulta de la caja: sucursal + estado, en cada tecla.
CREATE INDEX IF NOT EXISTS "Product_branchId_isActive_idx"
  ON "Product" ("branchId", "isActive");

-- Para revertir:
--
--   DROP INDEX IF EXISTS "Product_branchId_isActive_idx";
--   ALTER TABLE "Product" DROP COLUMN IF EXISTS "isActive";
--
-- Se pierde que productos estaban dados de baja; no se pierde ningun producto
-- ni ninguna venta.
