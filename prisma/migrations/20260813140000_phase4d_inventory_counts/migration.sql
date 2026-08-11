-- =========================================================================
-- Fase 4D — Inventario fisico: contar el deposito sin cerrarlo
--
-- Que hace:
--   1. Crea la secuencia de numeracion "IF-".
--   2. Crea "InventoryCountSession" y "InventoryCountLine".
--   3. Amplia la tabla de signos de "StockMovement" con 'INVENTORY_COUNT'.
--   4. Inmutabilidad DESDE QUE SE APLICA, no antes.
--
-- Riesgo: BAJO. Dos tablas nuevas, una secuencia, y una restriccion que se
-- AFLOJA para aceptar un tipo mas. Ninguna fila existente puede volverse
-- invalida.
--
-- LA COLUMNA QUE HACE POSIBLE TODO: "expectedAtCount". Un inventario que obligue
-- a cerrar el local no se usa nunca, y uno que compare contra el stock DEL
-- INICIO da diferencias falsas: si empezo con 10, se vendieron 2 y el operario
-- conto 8, la diferencia es CERO. Ver docs/INVENTORY_COUNT_CONCURRENCY.md.
--
-- Y LA REGLA DE LA APLICACION: se aplica el DELTA, nunca el numero contado. Si
-- despues de contar 7 se vendio una unidad mas, el stock esta en 6 y hay que
-- dejarlo en 6: escribir "stock = 7" borraria esa venta. Ver el objetivo 28.
--
-- Reversible: SI, mientras no haya sesiones aplicadas. El rollback al pie lo
-- comprueba y aborta: una sesion aplicada movio stock.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La numeracion
--
-- Una SECUENCIA, por lo mismo que "OC-", "RC-", "PP-", "CB-" y "DV-": dos
-- sesiones creadas en el mismo segundo leerian el mismo `count() + 1` y el
-- indice unico rechazaria a una de las dos.
-- -------------------------------------------------------------------------
CREATE SEQUENCE "InventoryCountSession_numero_seq" AS BIGINT START WITH 1 INCREMENT BY 1;


-- -------------------------------------------------------------------------
-- 2. La sesion
-- -------------------------------------------------------------------------
CREATE TABLE "InventoryCountSession" (
  "id"               SERIAL        NOT NULL,
  "number"           TEXT          NOT NULL,
  "branchId"         INTEGER       NOT NULL,
  "status"           TEXT          NOT NULL DEFAULT 'DRAFT',
  "scope"            TEXT          NOT NULL DEFAULT 'ALL',
  "categoryId"       INTEGER,
  "blindCount"       BOOLEAN       NOT NULL DEFAULT true,
  "recountThreshold" NUMERIC(14,3),
  "notes"            TEXT,
  "startedById"      INTEGER       NOT NULL,
  "startedAt"        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt"      TIMESTAMP(3),
  "appliedById"      INTEGER,
  "appliedAt"        TIMESTAMP(3),
  "cancelledById"    INTEGER,
  "cancelledAt"      TIMESTAMP(3),
  "cancelReason"     TEXT,

  CONSTRAINT "InventoryCountSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InventoryCountSession_number_key" ON "InventoryCountSession"("number");

-- Los cinco estados. REVIEW es el que hace util a todos los demas: el conteo
-- termino y TODAVIA NO TOCO EL STOCK. Sin el, contar y corregir serian el mismo
-- acto y nadie podria mirar las diferencias antes de que existieran.
ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_estado_check"
  CHECK ("status" IN ('DRAFT', 'COUNTING', 'REVIEW', 'APPLIED', 'CANCELLED'));

-- Que se cuenta. NO hay ubicaciones ni posiciones fisicas: este sistema no tiene
-- un modelo de deposito, y fabricar uno para poder decir "pasillo 3" seria
-- inventar datos que nadie cargo.
ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_alcance_check"
  CHECK ("scope" IN ('ALL', 'CATEGORY', 'SELECTION'));

-- La categoria y el alcance tienen que decir lo mismo.
ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_categoria_check"
  CHECK (("scope" = 'CATEGORY') = ("categoryId" IS NOT NULL));

-- Un umbral de cero exigiria segundo conteo en todas las lineas, incluidas las
-- que coinciden. Nulo es "sin doble conteo".
ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_umbral_check"
  CHECK ("recountThreshold" IS NULL OR "recountThreshold" > 0);

-- El estado y sus fechas cuentan la misma historia, igual que en las ordenes de
-- compra y en las devoluciones. Una sesion aplicada sin fecha de aplicacion es
-- una fila que despues nadie puede explicar.
ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_fechas_check"
  CHECK (
       ("status" IN ('DRAFT', 'COUNTING')
         AND "completedAt" IS NULL AND "appliedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'REVIEW'
         AND "completedAt" IS NOT NULL AND "appliedAt" IS NULL AND "cancelledAt" IS NULL)
    OR ("status" = 'APPLIED'
         AND "completedAt" IS NOT NULL
         AND "appliedAt" IS NOT NULL AND "appliedById" IS NOT NULL
         AND "cancelledAt" IS NULL)
    OR ("status" = 'CANCELLED'
         AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL
         AND "appliedAt" IS NULL)
  );

CREATE INDEX "InventoryCountSession_branchId_status_startedAt_idx"
  ON "InventoryCountSession"("branchId", "status", "startedAt");
CREATE INDEX "InventoryCountSession_startedById_idx"
  ON "InventoryCountSession"("startedById");

ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_categoryId_fkey"
  FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_startedById_fkey"
  FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_appliedById_fkey"
  FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "InventoryCountSession"
  ADD CONSTRAINT "InventoryCountSession_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 3. Las lineas
-- -------------------------------------------------------------------------
CREATE TABLE "InventoryCountLine" (
  "id"                 SERIAL        NOT NULL,
  "sessionId"          INTEGER       NOT NULL,
  "productId"          INTEGER       NOT NULL,
  "lotId"              INTEGER,
  "status"             TEXT          NOT NULL DEFAULT 'PENDING',
  "snapshotQuantity"   NUMERIC(14,3) NOT NULL,
  "countedQuantity"    NUMERIC(14,3),
  "firstCountQuantity" NUMERIC(14,3),
  "expectedAtCount"    NUMERIC(14,3),
  "variance"           NUMERIC(14,3),
  "countedById"        INTEGER,
  "countedAt"          TIMESTAMP(3),
  "notes"              TEXT,

  CONSTRAINT "InventoryCountLine_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_estado_check"
  CHECK ("status" IN ('PENDING', 'COUNTED', 'RECOUNT', 'UNRESOLVED'));

-- Un conteo fisico no puede ser negativo: nadie encuentra menos cero unidades.
-- El snapshot tampoco, porque el stock nunca lo es.
ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_cantidades_check"
  CHECK ("snapshotQuantity" >= 0
         AND ("countedQuantity" IS NULL OR "countedQuantity" >= 0)
         AND ("firstCountQuantity" IS NULL OR "firstCountQuantity" >= 0)
         AND ("expectedAtCount" IS NULL OR "expectedAtCount" >= 0));

-- Los tres numeros concuerdan, exactamente como en "StockMovement": la
-- diferencia es lo contado menos lo esperado AL MOMENTO DE CONTAR, y no algo
-- que alguien pueda escribir aparte.
ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_diferencia_check"
  CHECK ("variance" IS NULL
         OR ("countedQuantity" IS NOT NULL AND "expectedAtCount" IS NOT NULL
             AND "variance" = "countedQuantity" - "expectedAtCount"));

-- Una linea sin contar no tiene conteo; una contada lo tiene entero. Sin esto,
-- una linea podria decir "contada" sin numero, y la aplicacion no sabria si
-- tratarla como cero o saltearla.
ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_coherencia_check"
  CHECK (
       ("status" = 'PENDING'
         AND "countedQuantity" IS NULL AND "countedAt" IS NULL AND "variance" IS NULL)
    OR ("status" IN ('COUNTED', 'RECOUNT', 'UNRESOLVED')
         AND "countedQuantity" IS NOT NULL AND "expectedAtCount" IS NOT NULL
         AND "variance" IS NOT NULL
         AND "countedAt" IS NOT NULL AND "countedById" IS NOT NULL)
  );

-- Una linea por (sesion, producto, lote). Los DOS indices hacen falta: para
-- PostgreSQL dos NULL son distintos entre si, asi que sin el parcial una sesion
-- podria tener dos lineas del mismo producto sin lote.
CREATE UNIQUE INDEX "InventoryCountLine_sesion_producto_lote_key"
  ON "InventoryCountLine"("sessionId", "productId", "lotId");

CREATE UNIQUE INDEX "InventoryCountLine_sesion_producto_sin_lote_key"
  ON "InventoryCountLine"("sessionId", "productId")
  WHERE "lotId" IS NULL;

CREATE INDEX "InventoryCountLine_sessionId_status_idx"
  ON "InventoryCountLine"("sessionId", "status");
CREATE INDEX "InventoryCountLine_productId_idx" ON "InventoryCountLine"("productId");
CREATE INDEX "InventoryCountLine_lotId_idx"     ON "InventoryCountLine"("lotId");

-- CASCADE con su sesion, igual que los renglones de una devolucion: una linea de
-- conteo no significa nada sin la sesion que la genero. Y solo alcanza a las
-- sesiones que se pueden borrar, que son las que nunca se aplicaron.
ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "InventoryCountSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "ProductLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryCountLine"
  ADD CONSTRAINT "InventoryCountLine_countedById_fkey"
  FOREIGN KEY ("countedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. La tabla de signos, un tipo mas
--
-- Se reemplaza entera, igual que en la Fase 4C, para que siga habiendo UNA sola
-- tabla de signos y no dos que haya que leer juntas.
--
-- 'INVENTORY_COUNT' acepta los dos signos, y eso es exactamente por que NO es un
-- `LOSS`: un sobrante contado no es una perdida negativa. Mezclarlos haria que el
-- reporte de mermas mienta.
-- -------------------------------------------------------------------------
ALTER TABLE "StockMovement"
  DROP CONSTRAINT "StockMovement_tipo_signo_check";

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_tipo_signo_check"
  CHECK (
       ("type" = 'INITIAL'                                             AND "quantity" >= 0)
    OR ("type" IN ('SALE', 'LOSS', 'BREAKAGE', 'INTERNAL_USE',
                   'PURCHASE_RETURN')                                  AND "quantity" < 0)
    OR ("type" IN ('SALE_CANCEL', 'PURCHASE_RECEIPT')                  AND "quantity" > 0)
    OR ("type" IN ('MANUAL_ADJUSTMENT', 'INVENTORY_COUNT')             AND "quantity" <> 0)
  );

-- Que la restriccion nueva acepte todo lo ya escrito. Cierra la unica forma de
-- equivocarse al reescribir una lista: olvidarse un tipo que ya se usaba.
DO $$
DECLARE tipos TEXT;
BEGIN
  SELECT string_agg(DISTINCT "type", ', ') INTO tipos
    FROM "StockMovement"
   WHERE "type" NOT IN ('INITIAL', 'SALE', 'SALE_CANCEL', 'MANUAL_ADJUSTMENT',
                        'LOSS', 'BREAKAGE', 'INTERNAL_USE', 'PURCHASE_RECEIPT',
                        'PURCHASE_RETURN', 'INVENTORY_COUNT');

  IF tipos IS NOT NULL THEN
    RAISE EXCEPTION
      'El libro de inventario tiene tipos que la tabla de signos nueva no '
      'contempla: %. Agregarlos antes de continuar.', tipos;
  END IF;
END $$;


-- -------------------------------------------------------------------------
-- 5. Inmutabilidad, PERO DESDE QUE SE CIERRA
--
-- Misma inmutabilidad condicional que las devoluciones de la Fase 4C, y por el
-- mismo motivo: una sesion en curso es un papel que se esta llenando y tiene que
-- poder corregirse. Lo que no se toca es lo que YA OCURRIO.
--
-- APPLIED movio stock. CANCELLED es una decision que alguien tomo, y reabrirla
-- borraria el registro de que la tomo.
--
-- Las lineas preguntan por el estado de SU sesion. Sin esto quedaria la puerta
-- de atras de siempre: la sesion aplicada no se toca, pero se podria cambiar la
-- cantidad contada de una linea y la diferencia dejaria de corresponderse con el
-- movimiento que ya se emitio.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "inventory_count_session_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" NOT IN ('APPLIED', 'CANCELLED') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'El inventario % ya esta %: es inmutable (intento de % sobre el id %). '
    'Un inventario aplicado movio stock; corregirlo es contar de nuevo, no '
    'editar este.', OLD."number", lower(OLD."status"), TG_OP, OLD."id";
END $$;

CREATE TRIGGER "InventoryCountSession_inmutable"
  BEFORE UPDATE OR DELETE ON "InventoryCountSession"
  FOR EACH ROW EXECUTE FUNCTION "inventory_count_session_inmutable"();

CREATE OR REPLACE FUNCTION "inventory_count_line_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE estado TEXT;
BEGIN
  SELECT "status" INTO estado
    FROM "InventoryCountSession" WHERE "id" = OLD."sessionId";

  -- Sin sesion es que la estan borrando en cascada, y eso solo puede pasar desde
  -- una sesion que nunca se aplico: el disparador de arriba no deja borrar las
  -- otras.
  IF estado IS NULL OR estado NOT IN ('APPLIED', 'CANCELLED') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'La linea % pertenece a un inventario ya %: es inmutable (intento de %).',
    OLD."id", lower(estado), TG_OP;
END $$;

CREATE TRIGGER "InventoryCountLine_inmutable"
  BEFORE UPDATE OR DELETE ON "InventoryCountLine"
  FOR EACH ROW EXECUTE FUNCTION "inventory_count_line_inmutable"();


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   -- Aborta si hay sesiones aplicadas o movimientos de inventario: cada
--   -- diferencia aplicada movio stock, y borrar las tablas dejaria esos
--   -- movimientos sin origen.
--   DO $$
--   DECLARE aplicadas INTEGER; movimientos INTEGER;
--   BEGIN
--     SELECT count(*) INTO aplicadas
--       FROM "InventoryCountSession" WHERE "status" = 'APPLIED';
--     SELECT count(*) INTO movimientos
--       FROM "StockMovement" WHERE "type" = 'INVENTORY_COUNT';
--     IF aplicadas > 0 OR movimientos > 0 THEN
--       RAISE EXCEPTION
--         'Hay % inventarios aplicados y % movimientos INVENTORY_COUNT. Son '
--         'correcciones de stock que ya ocurrieron: no se pueden borrar sin '
--         'falsear el inventario.', aplicadas, movimientos;
--     END IF;
--   END $$;
--
--   DROP TRIGGER "InventoryCountLine_inmutable" ON "InventoryCountLine";
--   DROP FUNCTION "inventory_count_line_inmutable"();
--   DROP TRIGGER "InventoryCountSession_inmutable" ON "InventoryCountSession";
--   DROP FUNCTION "inventory_count_session_inmutable"();
--   ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_tipo_signo_check";
--   ALTER TABLE "StockMovement"
--     ADD CONSTRAINT "StockMovement_tipo_signo_check"
--     CHECK (
--          ("type" = 'INITIAL'                                        AND "quantity" >= 0)
--       OR ("type" IN ('SALE', 'LOSS', 'BREAKAGE', 'INTERNAL_USE',
--                      'PURCHASE_RETURN')                             AND "quantity" < 0)
--       OR ("type" IN ('SALE_CANCEL', 'PURCHASE_RECEIPT')             AND "quantity" > 0)
--       OR ("type" = 'MANUAL_ADJUSTMENT'                              AND "quantity" <> 0)
--     );
--   DROP TABLE "InventoryCountLine";
--   DROP TABLE "InventoryCountSession";
--   DROP SEQUENCE "InventoryCountSession_numero_seq";
--
-- Que se pierde: las sesiones en curso, que no habian movido nada. Nada mas,
-- porque la comprobacion de arriba impide llegar hasta aca con algo aplicado.
-- =========================================================================
