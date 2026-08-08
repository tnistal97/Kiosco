-- =========================================================================
-- Fase 3C — Se borra "Product"."barcode"
--
-- Que hace: elimina la columna que la Fase 3B dejo congelada, y su indice.
--
-- Riesgo: MEDIO. Es la unica migracion DESTRUCTIVA de la fase. La
-- comprobacion previa es lo que la vuelve segura, no la fe.
--
-- Reversible: la ESTRUCTURA si. Los valores no se recuperan de esta tabla,
-- pero SI de "ProductBarcode", que es donde viven desde la 3B. Ver el
-- ROLLBACK al final.
--
-- Ver docs/PHASE3_BARCODES.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Se cumplio el plazo
--
-- La regla 2 de docs/DATABASE_MIGRATION_STRATEGY.md dice:
--
--   Nunca borrar en la misma migracion que deja de usar algo. Primero deja de
--   escribirse, se despliega, se comprueba, y recien despues se borra la
--   columna. Entre las dos cosas tiene que haber al menos un despliegue.
--
-- La Fase 3B dejo de leerla y de escribirla; esta es la fase siguiente. El
-- plazo se cumplio.
--
-- Del lado del codigo lo comprueba una prueba estatica --
-- tests/unit/columnas-muertas.test.ts-- que recorre src/, scripts/ y prisma/
-- buscando referencias y falla si aparece alguna. Se escribio ANTES que esta
-- migracion y encontro una: `scripts/insertData.ts` seguia haciendo upsert por
-- `barcode`. Ese es exactamente el tipo de resto que una revision a ojo pasa
-- por alto.
-- -------------------------------------------------------------------------


-- -------------------------------------------------------------------------
-- 2. Ningun codigo se pierde
--
-- ABORTA si algun `Product.barcode` no esta representado en "ProductBarcode".
-- Es la comprobacion que separa "la columna esta vacia de significado" de "la
-- columna esta vacia", y no son lo mismo: un producto creado por una version
-- anterior de la aplicacion, entre el despliegue de la 3B y este, habria
-- escrito la columna vieja y ningun codigo nuevo.
--
-- Si esto salta, NO hay que borrar la comprobacion: hay que copiar esos
-- codigos a "ProductBarcode" y volver a correr.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  huerfanos INTEGER;
  cuales    TEXT;
BEGIN
  SELECT count(*), string_agg(p."name" || ' (' || p."barcode" || ')', ', ' ORDER BY p."name")
    INTO huerfanos, cuales
    FROM "Product" p
   WHERE p."barcode" IS NOT NULL
     AND btrim(p."barcode") <> ''
     AND NOT EXISTS (
       SELECT 1 FROM "ProductBarcode" pb
        WHERE pb."productId" = p."id" AND pb."code" = btrim(p."barcode")
     );

  IF huerfanos > 0 THEN
    RAISE EXCEPTION
      'Migracion abortada: % codigo(s) de barras solo existen en la columna vieja: %. '
      'Copiarlos a "ProductBarcode" antes de borrar la columna.',
      huerfanos, cuales;
  END IF;
END $$;


-- -------------------------------------------------------------------------
-- 3. Adios
--
-- El indice unico se va con la columna --PostgreSQL lo borra solo-- pero se
-- nombra igual: un DROP INDEX explicito deja escrito que la unicidad del
-- codigo NO desaparece, se mudo. Hoy la garantiza
-- "ProductBarcode_code_key", que ademas la extiende a los codigos
-- alternativos, que la columna vieja no podia cubrir.
-- -------------------------------------------------------------------------
DROP INDEX IF EXISTS "Product_barcode_key";

ALTER TABLE "Product" DROP COLUMN "barcode";


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- ALTER TABLE "Product" ADD COLUMN "barcode" TEXT;
--
-- UPDATE "Product" p
--    SET "barcode" = pb."code"
--   FROM "ProductBarcode" pb
--  WHERE pb."productId" = p."id" AND pb."isPrimary";
--
-- CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");
--
-- La reversion RECONSTRUYE los datos, no los recupera: toma el codigo
-- principal de cada producto desde "ProductBarcode". Es fiel para todo
-- producto que tenga uno.
--
-- Lo que NO vuelve: los codigos ALTERNATIVOS. Nunca estuvieron en esta
-- columna --no cabian-- y una version de la aplicacion anterior a la 3B no
-- sabria que existen. Un producto con tres codigos volveria a tener uno.
-- =========================================================================
