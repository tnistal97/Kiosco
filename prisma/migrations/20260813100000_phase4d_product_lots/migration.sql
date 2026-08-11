-- =========================================================================
-- Fase 4D — Lotes: la partida y las dos politicas del producto
--
-- Que hace:
--   1. Agrega "Product"."lotTracking" y "Product"."expirationTracking".
--   2. Crea "ProductLot": la partida, con su codigo y su vencimiento.
--   3. Impide editar destructivamente un lote que ya movio mercaderia.
--
-- Riesgo: BAJO. Es ADITIVA. Dos columnas con valor por omision y una tabla
-- nueva; no modifica ninguna columna existente y no borra nada.
--
-- TODO EL CATALOGO ARRANCA EN 'NONE', y eso NO es una decision perezosa: es la
-- unica honesta. Un producto en 'NONE' se comporta EXACTAMENTE igual que antes
-- de esta migracion --ni una consulta mas, ni un lote vacio-- y el dia que
-- alguien quiera rastrear el yogur, lo activa para el yogur.
--
-- NO SE INVENTAN LOTES HISTORICOS. Las 18 unidades que ya estaban no pertenecen
-- a ninguna partida conocida, y meterlas en un `LEGACY-2026` seria escribir un
-- dato falso con formato de dato real: el dia que haya que retirar una partida,
-- el sistema contestaria con un codigo que no existe en ninguna caja. Ver
-- docs/LOT_TRACKING_DESIGN.md.
--
-- Reversible: SI, mientras no haya lotes con historial. El rollback al pie lo
-- comprueba y aborta.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Las dos politicas del producto
--
-- DOS banderas y no una, y el caso que lo decide es la lavandina: necesita
-- numero de partida --para poder retirarla si sale mal-- y no tiene vencimiento
-- que valga la pena controlar. Con una sola bandera, rastrearla obligaria a
-- inventarle una fecha, que es justo lo que este sistema no hace.
--
-- Al reves no hay simetria: la fecha VIVE en el lote, asi que exigir vencimiento
-- sin rastrear lotes no tiene donde guardarse. Lo impide el tercer CHECK.
-- Ver docs/LOT_EXPIRATION_POLICY.md.
-- -------------------------------------------------------------------------
ALTER TABLE "Product" ADD COLUMN "lotTracking"        TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Product" ADD COLUMN "expirationTracking" TEXT NOT NULL DEFAULT 'NONE';

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_lotTracking_check"
  CHECK ("lotTracking" IN ('NONE', 'OPTIONAL', 'REQUIRED'));

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_expirationTracking_check"
  CHECK ("expirationTracking" IN ('NONE', 'OPTIONAL', 'REQUIRED'));

-- Un vencimiento sin lote no tiene donde escribirse.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_vencimiento_necesita_lote_check"
  CHECK ("expirationTracking" = 'NONE' OR "lotTracking" <> 'NONE');

-- El listado de lotes recorre el catalogo filtrando por politica.
CREATE INDEX "Product_branchId_lotTracking_idx" ON "Product"("branchId", "lotTracking");


-- -------------------------------------------------------------------------
-- 2. La partida
--
-- El lote es la PARTIDA, no la cantidad: cuanto hay de ella en cada sucursal lo
-- dice "BranchLotStock", que llega en la migracion siguiente. La misma partida
-- fisica puede estar repartida en dos depositos, y por eso la cantidad no puede
-- vivir aca. Es la misma separacion que hay entre "Product" y "BranchStock".
-- -------------------------------------------------------------------------
CREATE TABLE "ProductLot" (
  "id"             SERIAL       NOT NULL,
  "productId"      INTEGER      NOT NULL,
  "code"           TEXT         NOT NULL,
  "codeNormalized" TEXT         NOT NULL,
  "expirationDate" DATE,
  "manufacturedAt" DATE,
  "notes"          TEXT,
  "createdById"    INTEGER      NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductLot_pkey" PRIMARY KEY ("id")
);

-- El codigo es lo que esta impreso en el envase: alfanumerico, con separadores.
-- Acotarlo NO es burocracia: es lo que hace que `upper()` de PostgreSQL y
-- `toUpperCase()` de JavaScript den siempre el mismo resultado, y por lo tanto
-- que el CHECK de normalizacion de abajo sea cumplible desde el servidor.
ALTER TABLE "ProductLot"
  ADD CONSTRAINT "ProductLot_codigo_check"
  CHECK ("code" ~ '^[A-Za-z0-9][A-Za-z0-9 ._/-]*$' AND length("code") <= 64);

-- La normalizacion no se puede delegar al servidor "porque siempre la hace":
-- una restauracion, una carga masiva o un `psql` a mano la saltean, y entonces
-- el indice unico deja de proteger nada. Escrita como CHECK, la unica forma de
-- que dos filas sean la misma partida es que el indice las rechace.
ALTER TABLE "ProductLot"
  ADD CONSTRAINT "ProductLot_normalizacion_check"
  CHECK ("codeNormalized" = upper(regexp_replace(btrim("code"), '\s+', ' ', 'g')));

-- Un lote elaborado DESPUES de vencer es una fila que nadie puede explicar.
ALTER TABLE "ProductLot"
  ADD CONSTRAINT "ProductLot_fechas_check"
  CHECK ("manufacturedAt" IS NULL OR "expirationDate" IS NULL
         OR "manufacturedAt" <= "expirationDate");

-- Un codigo, una partida, DENTRO del producto. Entre productos distintos el
-- mismo codigo es normal: cada proveedor numera sus partidas como quiere.
CREATE UNIQUE INDEX "ProductLot_productId_codeNormalized_key"
  ON "ProductLot"("productId", "codeNormalized");

-- Clave candidata para las FOREIGN KEY COMPUESTAS de las migraciones que
-- siguen. Es lo que va a impedir que un movimiento de yogur descuente de una
-- partida de lavandina: PostgreSQL comprueba el par, no el lote suelto.
CREATE UNIQUE INDEX "ProductLot_productId_id_key" ON "ProductLot"("productId", "id");

CREATE INDEX "ProductLot_productId_idx"      ON "ProductLot"("productId");
-- El tablero de vencimientos ordena por fecha sobre todo el catalogo.
CREATE INDEX "ProductLot_expirationDate_idx" ON "ProductLot"("expirationDate");

ALTER TABLE "ProductLot"
  ADD CONSTRAINT "ProductLot_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductLot"
  ADD CONSTRAINT "ProductLot_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 3. Un lote con historial no se reescribe
--
-- La IDENTIDAD de la partida --a que producto pertenece y como se llama-- queda
-- congelada en cuanto la partida movio mercaderia. Cambiarle el codigo despues
-- reescribiria el pasado: las ocho unidades que salieron del lote `ABC` pasarian
-- a haber salido del `DEF`, y ningun libro lo notaria.
--
-- El VENCIMIENTO si se puede corregir, y la asimetria es deliberada: una fecha
-- mal tipeada es el error mas facil de cometer de los tres y el mas caro de
-- dejar, porque decide si la mercaderia se vende o se tira. La correccion pasa
-- por un permiso propio y queda en la bitacora. Ver el objetivo 38.
--
-- El BORRADO lo bloquean las claves foraneas de las migraciones siguientes, que
-- son RESTRICT: un lote con stock, con movimientos o con renglones no se puede
-- borrar aunque el disparador lo dejara.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "product_lot_identidad_congelada"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE movimientos INTEGER;
BEGIN
  IF NEW."productId" = OLD."productId" AND NEW."codeNormalized" = OLD."codeNormalized" THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO movimientos FROM "StockMovement" WHERE "lotId" = OLD."id";

  IF movimientos > 0 THEN
    RAISE EXCEPTION
      'El lote % ya movio mercaderia (% movimientos): su codigo y su producto '
      'son inmutables. Cambiarlos reescribiria de que partida salio lo que ya '
      'salio.', OLD."code", movimientos;
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER "ProductLot_identidad_congelada"
  BEFORE UPDATE ON "ProductLot"
  FOR EACH ROW EXECUTE FUNCTION "product_lot_identidad_congelada"();


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   -- Aborta si hay lotes: borrar la tabla dejaria sin explicacion el stock que
--   -- se les atribuyo y los movimientos que los referencian.
--   DO $$
--   DECLARE cuantos INTEGER;
--   BEGIN
--     SELECT count(*) INTO cuantos FROM "ProductLot";
--     IF cuantos > 0 THEN
--       RAISE EXCEPTION
--         'Hay % lotes cargados. Revertir primero phase4d_lot_stock y resolver '
--         'a que producto pertenece el stock atribuido.', cuantos;
--     END IF;
--   END $$;
--
--   DROP TRIGGER "ProductLot_identidad_congelada" ON "ProductLot";
--   DROP FUNCTION "product_lot_identidad_congelada"();
--   DROP TABLE "ProductLot";
--   DROP INDEX "Product_branchId_lotTracking_idx";
--   ALTER TABLE "Product" DROP CONSTRAINT "Product_vencimiento_necesita_lote_check";
--   ALTER TABLE "Product" DROP CONSTRAINT "Product_expirationTracking_check";
--   ALTER TABLE "Product" DROP CONSTRAINT "Product_lotTracking_check";
--   ALTER TABLE "Product" DROP COLUMN "expirationTracking";
--   ALTER TABLE "Product" DROP COLUMN "lotTracking";
--
-- Que se pierde: la politica de rastreo de cada producto, que vuelve a ser
-- implicitamente 'NONE' --el comportamiento anterior a la fase--. Nada de stock.
-- =========================================================================
