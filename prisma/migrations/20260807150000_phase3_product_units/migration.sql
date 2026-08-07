-- =========================================================================
-- Fase 3B — Unidades de medida del producto
--
-- Que hace:
--   1. Agrega "saleUnit", "purchaseUnit" y "unitsPerPurchaseUnit".
--   2. Restringe los valores posibles con listas blancas.
--   3. Impide que el minimo de un producto no fraccionable tenga decimales.
--   4. Impide CAMBIAR la unidad de venta de un producto con historial.
--
-- Riesgo: BAJO. Es ADITIVA. Las tres columnas nacen con un valor por defecto
-- que preserva exactamente el comportamiento actual: todo el catalogo
-- existente queda en UNIT, que es lo que era implicitamente.
--
-- Reversible: SI, sin perdida. Ver el ROLLBACK al final.
--
-- Ver docs/PHASE3_QUANTITY_MIGRATION.md, seccion "Unidades de medida".
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Las tres columnas
--
-- `saleUnit` = 'UNIT' para todo lo que ya existe. NO se adivina: un producto
-- llamado "Queso cremoso" probablemente se venda por kilo, pero el sistema no
-- lo sabe y ponerselo cambiaria el significado de su stock actual --24 pasaria
-- de 24 unidades a 24 kilos-- sin que nadie lo pida. Se configura a mano,
-- producto por producto, que es una tarde de trabajo y no un riesgo.
--
-- `unitsPerPurchaseUnit` es NUMERIC y no INTEGER porque tambien es una
-- cantidad: "una caja trae 12,5 kg" es tan valido como "una caja trae 8
-- unidades".
-- -------------------------------------------------------------------------
ALTER TABLE "Product"
  ADD COLUMN "saleUnit"             TEXT          NOT NULL DEFAULT 'UNIT',
  ADD COLUMN "purchaseUnit"         TEXT          NOT NULL DEFAULT 'UNIT',
  ADD COLUMN "unitsPerPurchaseUnit" NUMERIC(14,3) NOT NULL DEFAULT 1;


-- -------------------------------------------------------------------------
-- 2. Listas blancas
--
-- Dos listas distintas, y la asimetria es deliberada: PACK y BOX se COMPRAN
-- pero no se VENDEN. Un six-pack que se vende entero es un producto que se
-- vende por unidad, y esa unidad es el six-pack; no hay ninguna cuenta que
-- distinga PACK de UNIT en una venta. En cambio son necesarias del lado de la
-- compra, porque son el unico modo de que "unitsPerPurchaseUnit" se pueda
-- leer: con purchaseUnit = UNIT, un 8 diria "una unidad contiene ocho
-- unidades".
-- -------------------------------------------------------------------------
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_saleUnit_check"
  CHECK ("saleUnit" IN ('UNIT', 'KG', 'G', 'L', 'ML'));

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_purchaseUnit_check"
  CHECK ("purchaseUnit" IN ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK', 'BOX'));

-- Cero unidades por unidad de compra haria una division por cero en la Fase 3C.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_unitsPerPurchaseUnit_check"
  CHECK ("unitsPerPurchaseUnit" > 0);


-- -------------------------------------------------------------------------
-- 3. El minimo respeta la politica de fraccionamiento
--
-- Las unicas unidades fraccionables son KG y L. G y ML tienen paso 1 y no
-- 0,001 a proposito: medio gramo no lo pesa ninguna balanza de mostrador.
--
-- Esta restriccion solo puede escribirse para `minimumStock` porque es la
-- unica cantidad que vive en la MISMA fila que la unidad. `BranchStock` y
-- `StockMovement` estan en otras tablas, y un CHECK no puede mirar mas alla de
-- su fila; ahi la regla la aplica el servidor.
-- -------------------------------------------------------------------------
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_minimumStock_fraccion_check"
  CHECK (
    "saleUnit" IN ('KG', 'L')
    OR "minimumStock" = trunc("minimumStock")
  );


-- -------------------------------------------------------------------------
-- 4. La unidad de venta no se cambia si hay historial
--
-- Es LA debilidad de guardar las cantidades en la unidad de venta del producto
-- en vez de normalizarlas a una unidad base. Si alguien cambia el `saleUnit`
-- de KG a G, todas las filas historicas cambian de significado en silencio: un
-- movimiento de 0,250 que era un cuarto de kilo pasa a leerse como un cuarto
-- de gramo, y nada falla.
--
-- Va en la base y no solo en el servicio por la misma razon que el disparador
-- de inmutabilidad del libro: en el codigo protege de los errores propios, y
-- aca protege ademas de un UPDATE a mano.
--
-- Solo se dispara cuando la unidad CAMBIA de verdad, asi que no cuesta nada en
-- la edicion normal de un producto.
--
-- Un producto mal configurado y todavia sin historial si se corrige. Uno con
-- historial se da de baja y se carga de nuevo.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "product_sale_unit_congelada"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  movimientos bigint;
  ventas      bigint;
BEGIN
  SELECT count(*) INTO movimientos FROM "StockMovement" WHERE "productId" = NEW."id";
  SELECT count(*) INTO ventas      FROM "SaleItem"      WHERE "productId" = NEW."id";

  IF movimientos > 0 OR ventas > 0 THEN
    RAISE EXCEPTION
      'No se puede cambiar la unidad de venta de "%" (de % a %): tiene % '
      'movimiento(s) de stock y % linea(s) de venta, y sus cantidades estan '
      'guardadas en la unidad anterior. Cambiarla reescribiria el significado '
      'de todo su historial.',
      NEW."name", OLD."saleUnit", NEW."saleUnit", movimientos, ventas;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "Product_saleUnit_congelada"
  BEFORE UPDATE ON "Product"
  FOR EACH ROW
  WHEN (OLD."saleUnit" IS DISTINCT FROM NEW."saleUnit")
  EXECUTE FUNCTION "product_sale_unit_congelada"();


-- -------------------------------------------------------------------------
-- 5. Comprobacion posterior
--
-- Todo el catalogo tiene que haber quedado en UNIT con factor 1. Cualquier
-- otra cosa significaria que la migracion invento informacion.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  inventados integer;
BEGIN
  SELECT count(*) INTO inventados
    FROM "Product"
   WHERE "saleUnit" <> 'UNIT'
      OR "purchaseUnit" <> 'UNIT'
      OR "unitsPerPurchaseUnit" <> 1;

  IF inventados > 0 THEN
    RAISE EXCEPTION
      'La migracion dejo % producto(s) con una unidad distinta de UNIT. No '
      'deberia haber inventado ninguna.', inventados;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP TRIGGER "Product_saleUnit_congelada" ON "Product";
-- DROP FUNCTION "product_sale_unit_congelada"();
-- ALTER TABLE "Product"
--   DROP CONSTRAINT "Product_saleUnit_check",
--   DROP CONSTRAINT "Product_purchaseUnit_check",
--   DROP CONSTRAINT "Product_unitsPerPurchaseUnit_check",
--   DROP CONSTRAINT "Product_minimumStock_fraccion_check";
-- ALTER TABLE "Product"
--   DROP COLUMN "saleUnit",
--   DROP COLUMN "purchaseUnit",
--   DROP COLUMN "unitsPerPurchaseUnit";
--
-- Se pierde la configuracion de unidades, que hay que volver a cargar a mano.
-- Lo grave no es eso: es que las cantidades de los productos por peso QUEDAN,
-- y sin la unidad nadie puede saber si el 0,425 de un movimiento eran kilos o
-- unidades. Exportarlas antes:
--   SELECT "id", "name", "saleUnit" FROM "Product" WHERE "saleUnit" <> 'UNIT';
-- =========================================================================
