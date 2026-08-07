-- =========================================================================
-- Fase 3A — Libro de inventario
--
-- Que hace:
--   1. Comprueba que no haya stock negativo antes de tocar nada.
--   2. Crea "StockMovement" con sus restricciones, claves e indices.
--   3. Crea el disparador que hace la tabla inmutable.
--   4. Agrega "Product"."minimumStock".
--   5. Crea un movimiento INITIAL por cada saldo existente distinto de cero.
--
-- Riesgo: BAJO. Es ADITIVA. No modifica ninguna columna existente, no borra
-- nada y no cambia ningun tipo. El codigo anterior sigue funcionando sobre
-- esta estructura sin enterarse de que existe.
--
-- Reversible: SI, con la salvedad del punto 5 del rollback (abajo).
--
-- Ver docs/INVENTORY_LEDGER.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Comprobacion previa: no puede haber stock negativo
--
-- Un saldo negativo no se puede migrar. El INITIAL correspondiente violaria
-- CHECK ("resultingQuantity" >= 0), y ponerlo en cero falsearia el inventario
-- para tapar un dato que hay que arreglar a mano. La migracion se detiene y
-- dice exactamente que filas revisar.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  negativos integer;
  detalle   text;
BEGIN
  SELECT count(*) INTO negativos FROM "BranchStock" WHERE "quantity" < 0;

  IF negativos > 0 THEN
    SELECT string_agg(
             format('sucursal %s / producto %s = %s', "branchId", "productId", "quantity"),
             ', ' ORDER BY "branchId", "productId")
      INTO detalle
      FROM "BranchStock"
     WHERE "quantity" < 0;

    RAISE EXCEPTION
      'Hay % fila(s) de BranchStock con stock negativo: %. '
      'Corregilas antes de crear el libro de inventario: un saldo negativo no '
      'se puede representar como movimiento inicial.',
      negativos, detalle;
  END IF;
END $$;


-- -------------------------------------------------------------------------
-- 2. La tabla
-- -------------------------------------------------------------------------
CREATE TABLE "StockMovement" (
  "id"                SERIAL       NOT NULL,
  "branchId"          INTEGER      NOT NULL,
  "productId"         INTEGER      NOT NULL,
  "type"              TEXT         NOT NULL,
  "quantity"          INTEGER      NOT NULL,
  "previousQuantity"  INTEGER      NOT NULL,
  "resultingQuantity" INTEGER      NOT NULL,
  "referenceType"     TEXT,
  "referenceId"       INTEGER,
  "userId"            INTEGER      NOT NULL,
  "reason"            TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- Los tres numeros tienen que concordar. Que una fila diga que 38 menos 2 son
-- 35 deja de ser improbable y pasa a ser imposible.
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_saldos_check"
  CHECK ("resultingQuantity" = "previousQuantity" + "quantity");

-- El stock nunca queda negativo, ni siquiera por una escritura directa.
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_no_negativo_check"
  CHECK ("resultingQuantity" >= 0 AND "previousQuantity" >= 0);

-- Tipo y signo, en la misma restriccion.
--
-- Hace de lista blanca --un tipo inventado no cumple ninguna rama-- y ademas
-- impide la incoherencia: una venta que aumente el stock, una anulacion que lo
-- baje, un ajuste de cero unidades.
--
-- PURCHASE_RECEIPT figura aunque en la Fase 3A nada lo emita. Es deliberado:
-- agregarlo hoy no cuesta nada; agregarlo en la Fase 3C, cuando la tabla tenga
-- volumen, cuesta un ALTER TABLE que valida todas las filas.
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_tipo_signo_check"
  CHECK (
       ("type" = 'INITIAL'                                  AND "quantity" >= 0)
    OR ("type" IN ('SALE', 'LOSS', 'BREAKAGE', 'INTERNAL_USE') AND "quantity" < 0)
    OR ("type" IN ('SALE_CANCEL', 'PURCHASE_RECEIPT')       AND "quantity" > 0)
    OR ("type" = 'MANUAL_ADJUSTMENT'                        AND "quantity" <> 0)
  );

-- Si hay referencia, tiene que estar completa: un tipo sin id, o un id sin
-- tipo, no sirve para encontrar nada.
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_referencia_check"
  CHECK (
    ("referenceType" IS NULL AND "referenceId" IS NULL)
    OR ("referenceType" IS NOT NULL AND "referenceId" IS NOT NULL)
  );


-- -------------------------------------------------------------------------
-- 3. Claves foraneas
--
-- Escritas a mano con nombre y acciones explicitas para que coincidan con lo
-- que genera Prisma. Un REFERENCES en linea produce NO ACTION en vez de
-- RESTRICT/CASCADE, y `prisma migrate diff` lo reporta como deriva.
-- -------------------------------------------------------------------------
ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. Indices
--
-- Uno por consulta real de la pantalla de movimientos. Ver la tabla de
-- docs/INVENTORY_LEDGER.md, seccion 11.
-- -------------------------------------------------------------------------
CREATE INDEX "StockMovement_branchId_createdAt_idx"
  ON "StockMovement"("branchId", "createdAt");

CREATE INDEX "StockMovement_productId_createdAt_idx"
  ON "StockMovement"("productId", "createdAt");

CREATE INDEX "StockMovement_branchId_type_createdAt_idx"
  ON "StockMovement"("branchId", "type", "createdAt");

CREATE INDEX "StockMovement_referenceType_referenceId_idx"
  ON "StockMovement"("referenceType", "referenceId");

CREATE INDEX "StockMovement_userId_idx"
  ON "StockMovement"("userId");


-- -------------------------------------------------------------------------
-- 5. Inmutabilidad
--
-- Un movimiento no se edita y no se borra. Los errores se corrigen con otro
-- movimiento, igual que en un libro contable.
--
-- Va en la base y no solo en el codigo porque en el codigo protege de los
-- errores propios, y aca protege ademas de un UPDATE a mano desde psql.
--
-- TRUNCATE no dispara disparadores de fila, asi que el reinicio de la base de
-- pruebas sigue funcionando. Es la unica puerta.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "stock_movement_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Los movimientos de stock son inmutables (intento de % sobre el id %). '
    'Para corregir un error, registra otro movimiento.',
    TG_OP, OLD."id";
END $$;

CREATE TRIGGER "StockMovement_inmutable"
  BEFORE UPDATE OR DELETE ON "StockMovement"
  FOR EACH ROW EXECUTE FUNCTION "stock_movement_inmutable"();


-- -------------------------------------------------------------------------
-- 6. Stock minimo
--
-- Cero significa SIN MINIMO CONFIGURADO. Con cero, el estado LOW no se cumple
-- nunca. La migracion NO inventa minimos: no sabe cuantos fideos quiere tener
-- este almacen, y un 10 global haria sonar una alarma que nadie configuro.
-- -------------------------------------------------------------------------
ALTER TABLE "Product" ADD COLUMN "minimumStock" INTEGER NOT NULL DEFAULT 0;


-- -------------------------------------------------------------------------
-- 7. Movimientos INITIAL para el stock existente
--
-- IMPORTANTE — que significa y que NO significa esta fila:
--
--   `createdAt` es la fecha de ESTA MIGRACION, no la fecha en que la
--   mercaderia entro al deposito. Esa fecha no existe en ninguna parte del
--   sistema anterior y no se inventa. El `reason` lo dice con todas las letras
--   para que dentro de dos anios nadie lea la fila al reves.
--
--   `userId` es el usuario mas antiguo de la sucursal, por necesidad: la
--   columna no admite nulo. No fue esa persona quien cargo ese stock.
--
-- Solo se crean para saldos distintos de cero. Un producto con cero unidades
-- no necesita movimiento: la invariante suma(movimientos) == quantity se
-- cumple sola con la suma vacia, y ademas asi un producto cargado por error y
-- sin ninguna operacion se puede seguir borrando.
--
-- Idempotente: el NOT EXISTS impide duplicar si la migracion se aplica dos
-- veces sobre la misma base.
-- -------------------------------------------------------------------------
INSERT INTO "StockMovement" (
  "branchId", "productId", "type", "quantity",
  "previousQuantity", "resultingQuantity",
  "referenceType", "referenceId", "userId", "reason", "createdAt"
)
SELECT
  bs."branchId",
  bs."productId",
  'INITIAL',
  bs."quantity",
  0,
  bs."quantity",
  'BranchStock',
  bs."id",
  COALESCE(
    -- El usuario mas antiguo de esa sucursal...
    (SELECT u."id" FROM "User" u
      WHERE u."branchId" = bs."branchId"
      ORDER BY u."id" ASC LIMIT 1),
    -- ...o, si la sucursal no tiene ninguno, el mas antiguo del sistema.
    (SELECT u."id" FROM "User" u ORDER BY u."id" ASC LIMIT 1)
  ),
  'Saldo existente al implantar el libro de inventario. No refleja cuando ingreso la mercaderia.',
  CURRENT_TIMESTAMP
FROM "BranchStock" bs
WHERE bs."quantity" <> 0
  AND EXISTS (SELECT 1 FROM "User" LIMIT 1)
  AND NOT EXISTS (
    SELECT 1 FROM "StockMovement" sm
     WHERE sm."branchId"  = bs."branchId"
       AND sm."productId" = bs."productId"
       AND sm."type"      = 'INITIAL'
  );


-- -------------------------------------------------------------------------
-- 8. Comprobacion posterior
--
-- La invariante del libro tiene que cumplirse ya mismo, sobre los datos
-- migrados. Si no se cumple, la migracion no deja la base a medias: falla.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  descuadres integer;
BEGIN
  SELECT count(*) INTO descuadres
    FROM "BranchStock" bs
    LEFT JOIN (
      SELECT "branchId", "productId", sum("quantity") AS total
        FROM "StockMovement"
       GROUP BY "branchId", "productId"
    ) sm ON sm."branchId" = bs."branchId" AND sm."productId" = bs."productId"
   WHERE bs."quantity" <> COALESCE(sm.total, 0);

  IF descuadres > 0 THEN
    RAISE EXCEPTION
      'El libro de inventario no cuadra en % producto(s) despues de migrar. '
      'No se aplica la migracion.', descuadres;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP TRIGGER "StockMovement_inmutable" ON "StockMovement";
-- DROP FUNCTION "stock_movement_inmutable"();
-- DROP TABLE "StockMovement";
-- ALTER TABLE "Product" DROP COLUMN "minimumStock";
--
-- Advertencia: la marcha atras PIERDE EL LIBRO. Los movimientos generados
-- entre esta migracion y el rollback no estan en ningun otro lado: son
-- informacion nueva, no una copia de algo que ya existiera. El saldo
-- (`BranchStock`.`quantity`) sobrevive intacto, porque nunca dejo de
-- mantenerse; lo que se pierde es el por que.
--
-- Los minimos configurados tambien se pierden. Son pocos y se vuelven a
-- cargar, pero conviene exportarlos antes:
--   SELECT "id", "minimumStock" FROM "Product" WHERE "minimumStock" > 0;
-- =========================================================================
