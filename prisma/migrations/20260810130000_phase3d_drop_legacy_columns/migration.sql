-- =========================================================================
-- Fase 3D — Se borran las dos columnas que la Fase 3C dejo congeladas
--
-- Que hace: elimina "Product"."supplierId" y "Supplier"."contact".
--
-- Riesgo: MEDIO. Es la unica migracion DESTRUCTIVA de la fase. Lo que la
-- vuelve segura son las dos comprobaciones previas, no la confianza.
--
-- Reversible: la ESTRUCTURA si, y los datos de `supplierId` tambien --viven
-- en "ProductSupplier"--. El texto libre de `contact` NO se recupera. Ver el
-- ROLLBACK al final.
--
-- Respaldo antes de aplicar: docs/PRODUCTION_MIGRATION_REHEARSAL.md tiene el
-- procedimiento completo de `pg_dump` y de RESTAURACION, que es la mitad que
-- suele faltar.
--
-- Ver docs/SUPPLIER_MODEL.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Se cumplio el plazo
--
-- Regla 2 de docs/DATABASE_MIGRATION_STRATEGY.md: entre dejar de usar una
-- columna y borrarla tiene que haber al menos un despliegue. La Fase 3C dejo
-- de leerlas y de escribirlas; esta es la fase siguiente.
--
-- Del lado del codigo lo comprueban tests/unit/columnas-muertas.test.ts
-- --busqueda estatica-- y tests/integration/compras.test.ts --alta y edicion
-- de un producto real, mirando que la columna quede NULL--. Las dos existen
-- desde la 3C y se escribieron antes que esta migracion.
-- -------------------------------------------------------------------------


-- -------------------------------------------------------------------------
-- 2. Ningun vinculo de proveedor se pierde
--
-- ABORTA si algun producto tiene `supplierId` sin la fila equivalente en
-- "ProductSupplier". Ese caso solo puede darse si una version de la
-- aplicacion anterior a la 3C escribio la columna DESPUES de que corriera la
-- migracion que copio los vinculos, que es precisamente el hueco que la regla
-- del despliegue existe para cubrir.
--
-- Si esto salta, NO hay que borrar la comprobacion: hay que crear esas filas
-- en "ProductSupplier" y volver a correr.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  sueltos INTEGER;
  cuales  TEXT;
BEGIN
  SELECT count(*), string_agg(p."name", ', ' ORDER BY p."name")
    INTO sueltos, cuales
    FROM "Product" p
   WHERE p."supplierId" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "ProductSupplier" ps
        WHERE ps."productId" = p."id" AND ps."supplierId" = p."supplierId"
     );

  IF sueltos > 0 THEN
    RAISE EXCEPTION
      'Migracion abortada: % producto(s) tienen proveedor solo en la columna vieja: %. '
      'Crear el vinculo en "ProductSupplier" antes de borrarla.',
      sueltos, cuales;
  END IF;
END $$;


-- -------------------------------------------------------------------------
-- 3. Ningun dato de contacto se pierde
--
-- ABORTA si algun proveedor tiene `contact` cargado y `contactName` vacio:
-- eso es texto que NUNCA se migro.
--
-- La comprobacion NO exige que los dos campos sean iguales, y la diferencia
-- importa. La migracion de la 3C copio el texto TAL CUAL solo cuando
-- `contactName` estaba vacio; que hoy digan cosas distintas significa que
-- alguien limpio el dato a mano --dejo el nombre y movio el telefono a su
-- campo--, que es exactamente lo que se esperaba que pasara. Exigir igualdad
-- convertiria ese trabajo bien hecho en un motivo para abortar.
--
-- Lo que no se hace, y es el pedido explicito de la fase: NO se intenta
-- deducir que parte del texto era la persona y cual el telefono. "Pepe
-- 11-4567-8900" y "11-4567-8900 (Pepe)" y "Pepe / Marcela" no tienen una
-- regla comun, y adivinar mal convierte un telefono en el nombre de alguien.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  sinMigrar INTEGER;
  cuales    TEXT;
BEGIN
  SELECT count(*), string_agg(s."name" || ' (' || s."contact" || ')', ', ' ORDER BY s."name")
    INTO sinMigrar, cuales
    FROM "Supplier" s
   WHERE s."contact" IS NOT NULL
     AND btrim(s."contact") <> ''
     AND (s."contactName" IS NULL OR btrim(s."contactName") = '');

  IF sinMigrar > 0 THEN
    RAISE EXCEPTION
      'Migracion abortada: % proveedor(es) tienen contacto solo en la columna vieja: %. '
      'Copiarlo a "contactName" antes de borrarla.',
      sinMigrar, cuales;
  END IF;
END $$;


-- -------------------------------------------------------------------------
-- 4. Adios
--
-- La clave foranea se va con la columna. Se nombra igual, para dejar escrito
-- que la relacion producto-proveedor no desaparecio: se mudo a
-- "ProductSupplier", que ademas admite varios proveedores por producto y
-- marca cual es el principal, cosa que una sola columna no podia.
-- -------------------------------------------------------------------------
ALTER TABLE "Product" DROP CONSTRAINT IF EXISTS "Product_supplierId_fkey";

ALTER TABLE "Product" DROP COLUMN "supplierId";

ALTER TABLE "Supplier" DROP COLUMN "contact";


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- ALTER TABLE "Product" ADD COLUMN "supplierId" INTEGER;
--
-- ALTER TABLE "Product"
--   ADD CONSTRAINT "Product_supplierId_fkey"
--   FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id");
--
-- UPDATE "Product" p
--    SET "supplierId" = ps."supplierId"
--   FROM "ProductSupplier" ps
--  WHERE ps."productId" = p."id" AND ps."isPreferred";
--
-- ALTER TABLE "Supplier" ADD COLUMN "contact" TEXT;
-- UPDATE "Supplier" SET "contact" = "contactName" WHERE "contactName" IS NOT NULL;
--
-- `supplierId` se RECONSTRUYE fiel: el proveedor principal de cada producto
-- es exactamente lo que la columna guardaba. Lo que no vuelve son los
-- proveedores ALTERNATIVOS, que nunca cupieron ahi.
--
-- `contact` NO se recupera: se rellena con `contactName`, que es el texto
-- migrado o su version limpia. Si alguien separo el telefono del nombre, la
-- reversion devuelve el nombre solo. El telefono no se pierde --vive en
-- "Supplier"."phone"-- pero deja de estar en esa cadena.
-- =========================================================================
