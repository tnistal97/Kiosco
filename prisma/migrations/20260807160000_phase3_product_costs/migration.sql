-- =========================================================================
-- Fase 3B — Costo del producto e historial de costos
--
-- Que hace:
--   1. Agrega "Product"."cost", que admite NULL.
--   2. Crea "ProductCostHistory" con su disparador de inmutabilidad.
--
-- Riesgo: BAJO. Es ADITIVA.
--
-- Reversible: SI en estructura. El historial se pierde, y es informacion que
-- no esta en ningun otro lado. Ver el ROLLBACK al final.
--
-- Ver docs/PHASE3_MONEY_MIGRATION.md para por que la escala es 4.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. El costo
--
-- ADMITE NULL, y ese null significa "no sabemos cuanto costo". Es la unica
-- respuesta honesta para el catalogo existente.
--
-- Lo que NO se hace, y conviene decirlo: poner `cost = price`. Seria mas
-- comodo --el margen daria 0 % en vez de "sin datos"-- y seria informacion
-- financiera FALSA. Un margen de cero inventado se ve igual que un margen de
-- cero real, y alguien va a tomar una decision de precios mirandolo.
--
-- Escala 4 y no 2 porque el costo se DERIVA de una division: una caja de 8 a
-- $12.345 da $1.543,125 por unidad. Con dos decimales, reconstruir la caja da
-- $12.345,04. Un numero que solo alimenta calculos puede guardarse con mas
-- resolucion que uno que se cobra. Ya estaba decidido en
-- docs/PHASE3_MONEY_MIGRATION.md desde la migracion del dinero.
-- -------------------------------------------------------------------------
ALTER TABLE "Product" ADD COLUMN "cost" NUMERIC(14,4);

-- Un costo negativo no existe. Cero si: hay mercaderia que entra sin costo
-- (muestras, bonificaciones), y distinguirlo de "no sabemos" es justamente
-- para lo que sirve el NULL.
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_cost_check"
  CHECK ("cost" IS NULL OR "cost" >= 0);


-- -------------------------------------------------------------------------
-- 2. El historial
--
-- Cada cambio manual de costo deja una fila. Los registros son inmutables,
-- igual que el libro de inventario y por el mismo motivo: un historial de
-- costos editable no sirve para explicar por que subio un precio.
--
-- `previousCost` admite NULL: el primer cambio de un producto migrado va de
-- "no sabemos" a un numero, y ese origen hay que poder representarlo.
--
-- El ALTA de un producto con costo NO escribe historial. Un historial registra
-- CAMBIOS --la entidad se llama asi y tiene una columna `previousCost` que en
-- un alta no tendria que poner--, y el costo con el que nace un producto ya
-- queda en la bitacora de la creacion. La consecuencia practica es buena: un
-- producto cargado por error, sin operaciones, se sigue pudiendo borrar.
--
-- `supplierId` y `purchaseId` quedan preparados para la Fase 3C, cuando una
-- recepcion de mercaderia pueda cambiar el costo sola. En esta fase son
-- siempre NULL, porque no hay compras.
--
-- `supplierId` SI lleva clave foranea: "Supplier" existe desde 2025.
-- `purchaseId` NO lleva ninguna: la tabla "Purchase" no existe todavia y no se
-- puede referenciar lo que no esta. La clave se agrega en la Fase 3C, cuando
-- haya a que apuntar.
-- -------------------------------------------------------------------------
CREATE TABLE "ProductCostHistory" (
  "id"           SERIAL        NOT NULL,
  "productId"    INTEGER       NOT NULL,
  "previousCost" NUMERIC(14,4),
  "newCost"      NUMERIC(14,4) NOT NULL,
  "supplierId"   INTEGER,
  "purchaseId"   INTEGER,
  "userId"       INTEGER       NOT NULL,
  "reason"       TEXT          NOT NULL,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProductCostHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ProductCostHistory"
  ADD CONSTRAINT "ProductCostHistory_costos_check"
  CHECK (
    "newCost" >= 0
    AND ("previousCost" IS NULL OR "previousCost" >= 0)
  );

-- Un "cambio" que deja el costo igual no es un cambio: es ruido que despues
-- hace parecer que el costo se movio cuando no se movio.
ALTER TABLE "ProductCostHistory"
  ADD CONSTRAINT "ProductCostHistory_cambio_real_check"
  CHECK ("previousCost" IS NULL OR "previousCost" <> "newCost");

-- Un motivo en blanco es lo mismo que no tener motivo.
ALTER TABLE "ProductCostHistory"
  ADD CONSTRAINT "ProductCostHistory_motivo_check"
  CHECK (length(btrim("reason")) >= 3);


-- -------------------------------------------------------------------------
-- 3. Claves foraneas
--
-- A mano, con nombre y acciones explicitas, para que coincidan con lo que
-- genera Prisma y `migrate diff` no reporte deriva.
--
-- RESTRICT sobre el producto: un producto con historial de costos NO se borra,
-- por la misma razon que uno con movimientos de stock. Se da de baja.
-- -------------------------------------------------------------------------
ALTER TABLE "ProductCostHistory"
  ADD CONSTRAINT "ProductCostHistory_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ProductCostHistory"
  ADD CONSTRAINT "ProductCostHistory_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ProductCostHistory"
  ADD CONSTRAINT "ProductCostHistory_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. Indices
--
-- La consulta real es una sola: "los ultimos cambios de costo de ESTE
-- producto", para la seccion de actividad reciente de la ficha.
-- -------------------------------------------------------------------------
CREATE INDEX "ProductCostHistory_productId_createdAt_idx"
  ON "ProductCostHistory"("productId", "createdAt");

CREATE INDEX "ProductCostHistory_userId_idx"
  ON "ProductCostHistory"("userId");


-- -------------------------------------------------------------------------
-- 5. Inmutabilidad
--
-- Mismo mecanismo que el libro de inventario. Un costo mal cargado se corrige
-- con otro cambio de costo, que deja su propia fila.
--
-- TRUNCATE no dispara disparadores de fila, asi que el reinicio de la base de
-- pruebas sigue funcionando.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "product_cost_history_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'El historial de costos es inmutable (intento de % sobre el id %). '
    'Para corregir un error, registra otro cambio de costo.',
    TG_OP, OLD."id";
END $$;

CREATE TRIGGER "ProductCostHistory_inmutable"
  BEFORE UPDATE OR DELETE ON "ProductCostHistory"
  FOR EACH ROW EXECUTE FUNCTION "product_cost_history_inmutable"();


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP TRIGGER "ProductCostHistory_inmutable" ON "ProductCostHistory";
-- DROP FUNCTION "product_cost_history_inmutable"();
-- DROP TABLE "ProductCostHistory";
-- ALTER TABLE "Product" DROP CONSTRAINT "Product_cost_check";
-- ALTER TABLE "Product" DROP COLUMN "cost";
--
-- Advertencia: se pierden los costos cargados Y su historial. El historial no
-- es una copia de nada: es informacion nueva. Exportarlo antes:
--   SELECT * FROM "ProductCostHistory" ORDER BY "productId", "createdAt";
--   SELECT "id", "name", "cost" FROM "Product" WHERE "cost" IS NOT NULL;
-- =========================================================================
