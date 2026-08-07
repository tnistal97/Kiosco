-- =========================================================================
-- Fase 3B — Multiples codigos de barras
--
-- Que hace:
--   1. Crea "ProductBarcode".
--   2. Copia CADA codigo de "Product"."barcode" como codigo principal.
--   3. Comprueba que no se haya perdido ninguno.
--
-- Riesgo: BAJO. Es ADITIVA. "Product"."barcode" NO se toca en esta migracion:
-- se queda con su valor y con su indice unico.
--
-- Por que no se borra ya, si a partir de esta fase nadie la lee ni la escribe:
-- la regla 2 de docs/DATABASE_MIGRATION_STRATEGY.md dice que entre "dejar de
-- usar" y "borrar" tiene que haber al menos un despliegue. Se borra en la Fase
-- 3C, cuando este despliegue lleve tiempo confirmado. Mientras tanto la
-- columna queda congelada: nadie la lee, nadie la escribe, y esta ahi
-- unicamente para que la version anterior del codigo pueda volver a
-- desplegarse. Ver docs/PHASE3_BARCODES.md.
--
-- Reversible: SI, sin perdida. Ver el ROLLBACK al final.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La tabla
-- -------------------------------------------------------------------------
CREATE TABLE "ProductBarcode" (
  "id"        SERIAL       NOT NULL,
  "productId" INTEGER      NOT NULL,
  "code"      TEXT         NOT NULL,
  "isPrimary" BOOLEAN      NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductBarcode_pkey" PRIMARY KEY ("id")
);

-- Un codigo vacio o con espacios alrededor no lo encuentra nunca un lector:
-- lo que llega del escaner viene sin espacios, y "  779..." no coincide.
--
-- La normalizacion es SOLO recortar espacios. NO se pasa a mayusculas: hacerlo
-- reescribiria codigos existentes durante una migracion, que es exactamente el
-- tipo de cambio silencioso que este proyecto evita, y para un lector dos
-- codigos que difieren en mayusculas son dos codigos distintos.
ALTER TABLE "ProductBarcode"
  ADD CONSTRAINT "ProductBarcode_code_check"
  CHECK ("code" = btrim("code") AND length("code") BETWEEN 1 AND 64);


-- -------------------------------------------------------------------------
-- 2. Unicidad
--
-- Dos reglas distintas:
--
--   a) un codigo apunta a UN solo producto, en todo el sistema. Sin esto, el
--      lector devolveria dos resultados y habria que elegir, que en un
--      mostrador es lo mismo que no funcionar.
--
--   b) un producto tiene UN solo codigo principal. Indice unico PARCIAL: la
--      condicion solo aplica a las filas con isPrimary, asi que un producto
--      puede tener todos los codigos alternativos que quiera.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "ProductBarcode_code_key"
  ON "ProductBarcode"("code");

CREATE UNIQUE INDEX "ProductBarcode_productId_principal_key"
  ON "ProductBarcode"("productId")
  WHERE "isPrimary";

-- El listado de la ficha del producto.
CREATE INDEX "ProductBarcode_productId_idx"
  ON "ProductBarcode"("productId");


-- -------------------------------------------------------------------------
-- 3. Clave foranea
--
-- CASCADE, a diferencia del historial de costos y del libro de inventario.
-- Un codigo de barras no es historia: es un atributo del producto, como el
-- nombre. Sin el producto no significa nada, y conservarlo impediria borrar un
-- producto cargado por error --que es justamente el unico caso en que un
-- producto todavia se puede borrar--.
-- -------------------------------------------------------------------------
ALTER TABLE "ProductBarcode"
  ADD CONSTRAINT "ProductBarcode_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. Migracion de los codigos existentes
--
-- Cada `Product.barcode` no vacio se convierte en el codigo PRINCIPAL de su
-- producto. `createdAt` es la fecha de esta migracion y no se inventa otra: no
-- existe en ninguna parte el dato de cuando se le puso el codigo.
--
-- El `btrim` no deberia cambiar nada --el esquema de entrada ya recortaba-- y
-- se aplica igual: si en la base quedo un codigo con un espacio de una carga
-- vieja, esta es la ultima oportunidad de que entre bien.
--
-- Idempotente por el NOT EXISTS.
-- -------------------------------------------------------------------------
INSERT INTO "ProductBarcode" ("productId", "code", "isPrimary", "createdAt")
SELECT p."id", btrim(p."barcode"), true, CURRENT_TIMESTAMP
  FROM "Product" p
 WHERE p."barcode" IS NOT NULL
   AND btrim(p."barcode") <> ''
   AND NOT EXISTS (
     SELECT 1 FROM "ProductBarcode" pb WHERE pb."code" = btrim(p."barcode")
   );


-- -------------------------------------------------------------------------
-- 5. Comprobacion posterior: no se perdio ninguno
--
-- Es LA comprobacion de esta migracion. Un codigo que no se copie deja un
-- producto que el lector ya no encuentra, y eso se descubre en el mostrador.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  huerfanos integer;
  detalle   text;
BEGIN
  SELECT count(*), string_agg(p."name", ', ' ORDER BY p."id")
    INTO huerfanos, detalle
    FROM "Product" p
   WHERE p."barcode" IS NOT NULL
     AND btrim(p."barcode") <> ''
     AND NOT EXISTS (
       SELECT 1 FROM "ProductBarcode" pb
        WHERE pb."productId" = p."id" AND pb."code" = btrim(p."barcode")
     );

  IF huerfanos > 0 THEN
    RAISE EXCEPTION
      'Quedaron % producto(s) cuyo codigo de barras no se migro: %. '
      'La causa mas probable es que dos productos compartan el mismo codigo, '
      'que el indice unico anterior deberia haber impedido. No se aplica la '
      'migracion.', huerfanos, detalle;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP TABLE "ProductBarcode";
--
-- Y nada mas: "Product"."barcode" nunca se toco, asi que la version anterior
-- del codigo vuelve a funcionar tal cual.
--
-- Lo que SI se pierde son los codigos ALTERNATIVOS cargados despues de esta
-- migracion, que no tienen donde volver: `Product.barcode` es uno solo.
-- Exportarlos antes:
--   SELECT "productId", "code" FROM "ProductBarcode" WHERE NOT "isPrimary";
-- =========================================================================
