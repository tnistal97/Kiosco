-- =========================================================================
-- Fase 4D — Stock por lote: la cifra, el libro y la atribucion
--
-- Que hace:
--   1. Crea "BranchLotStock": cuanto hay de cada partida en cada sucursal.
--   2. Agrega "StockMovement"."lotId" con clave foranea COMPUESTA.
--   3. Crea "LotAssignment": el segundo libro, el de las atribuciones.
--
-- Riesgo: BAJO. Es ADITIVA. Dos tablas nuevas y una columna NULLABLE; ninguna
-- fila existente cambia y ninguna se vuelve invalida.
--
-- LA INVARIANTE QUE SE ESTABLECE, que es la razon de que existan las tres cosas:
--
--   BranchLotStock.quantity  ==  suma(StockMovement del lote)
--                              + suma(LotAssignment del lote)
--
-- y, del lado del producto, una DESIGUALDAD y no una igualdad:
--
--   suma(BranchLotStock del producto)  <=  BranchStock.quantity
--
-- La diferencia es el stock SIN ASIGNAR, que es derivado y no una columna: dos
-- cifras guardadas que se escriben en momentos distintos empiezan a diferir el
-- dia que alguien se olvida de actualizar una. Ver docs/LOT_TRACKING_DESIGN.md.
--
-- Reversible: SI, mientras no haya stock por lote. El rollback al pie lo
-- comprueba y aborta.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. El "BranchStock" de los lotes
--
-- Materializado, y por el mismo motivo por el que "BranchStock" existe desde
-- antes de este proyecto: la alternativa --sumar el libro del lote en cada
-- venta-- es el camino caliente de la caja y crece con el HISTORIAL, no con el
-- stock. Con dos anios de rotacion, elegir de que partida sale un yogur costaria
-- agregar miles de filas, dentro de la transaccion de la venta y bajo bloqueo.
--
-- Lo escribe UNICAMENTE `applyStockMovement()`. Hay una regla de ESLint que lo
-- impide desde cualquier otro lado, igual que con "BranchStock".
-- -------------------------------------------------------------------------
CREATE TABLE "BranchLotStock" (
  "id"       SERIAL        NOT NULL,
  "branchId" INTEGER       NOT NULL,
  "lotId"    INTEGER       NOT NULL,
  "quantity" NUMERIC(14,3) NOT NULL,

  CONSTRAINT "BranchLotStock_pkey" PRIMARY KEY ("id")
);

-- Un lote NUNCA queda en negativo. Lo hace cumplir la misma sentencia que
-- descuenta --`quantity + delta >= 0` dentro del UPDATE-- y esto es la red de
-- abajo: si alguna vez una escritura esquivara la unica puerta, la fila no entra.
ALTER TABLE "BranchLotStock"
  ADD CONSTRAINT "BranchLotStock_no_negativo_check"
  CHECK ("quantity" >= 0);

CREATE UNIQUE INDEX "BranchLotStock_branchId_lotId_key"
  ON "BranchLotStock"("branchId", "lotId");

CREATE INDEX "BranchLotStock_lotId_idx" ON "BranchLotStock"("lotId");

ALTER TABLE "BranchLotStock"
  ADD CONSTRAINT "BranchLotStock_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BranchLotStock"
  ADD CONSTRAINT "BranchLotStock_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "ProductLot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 2. El libro, ahora por lote
--
-- NULLABLE, y se queda nulo en TODO el historial anterior. No se rellena hacia
-- atras: nadie sabe de que partida eran las unidades que se vendieron el año
-- pasado, y un lote inventado se ve igual que uno real.
--
-- La clave foranea es COMPUESTA (producto, lote) y no simple, y es la unica
-- forma de que la base --y no una comprobacion nuestra-- impida que un
-- movimiento de yogur descuente de una partida de lavandina. Con `lotId` nulo la
-- restriccion se satisface sola (MATCH SIMPLE), que es exactamente lo que hace
-- falta para el historial y para los productos sin rastreo.
--
-- Que un producto REQUIRED no pueda tener movimientos SIN lote no se puede
-- expresar aca: la politica vive en "Product", en otra tabla. La impone
-- `applyStockMovement()` y la comprueba la reconciliacion.
-- -------------------------------------------------------------------------
ALTER TABLE "StockMovement" ADD COLUMN "lotId" INTEGER;

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_productId_lotId_fkey"
  FOREIGN KEY ("productId", "lotId") REFERENCES "ProductLot"("productId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- El libro de UN lote, que es lo que reconstruye su saldo y lo que compara la
-- reconciliacion contra la cifra materializada.
CREATE INDEX "StockMovement_lotId_createdAt_idx" ON "StockMovement"("lotId", "createdAt");


-- -------------------------------------------------------------------------
-- 3. El segundo libro: las atribuciones
--
-- Existe por una operacion que NO es un movimiento de stock. Activar el rastreo
-- sobre un producto que ya tiene 20 unidades obliga a decir de que lotes son, y
-- eso no cambia el stock: habia 20 y siguen habiendo 20. Lo que cambia es la
-- ATRIBUCION.
--
-- Fabricar un movimiento de +20 seguido de otro de -20 para representarlo seria
-- escribir en el libro de inventario dos operaciones que nunca ocurrieron, y
-- contaminaria todo reporte de movimientos por tipo con entradas y salidas
-- fantasma.
--
-- `quantity` va CON SIGNO, igual que el libro de inventario: una atribucion
-- equivocada no se edita ni se borra, se compensa con su opuesta.
-- -------------------------------------------------------------------------
CREATE TABLE "LotAssignment" (
  "id"        SERIAL        NOT NULL,
  "branchId"  INTEGER       NOT NULL,
  "productId" INTEGER       NOT NULL,
  "lotId"     INTEGER       NOT NULL,
  "quantity"  NUMERIC(14,3) NOT NULL,
  "reason"    TEXT          NOT NULL,
  "userId"    INTEGER       NOT NULL,
  "createdAt" TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LotAssignment_pkey" PRIMARY KEY ("id")
);

-- Una atribucion de cero no atribuye nada.
ALTER TABLE "LotAssignment"
  ADD CONSTRAINT "LotAssignment_cantidad_check"
  CHECK ("quantity" <> 0);

-- El motivo es obligatorio y no puede ser una cadena vacia: es la unica
-- explicacion que va a quedar de por que estas ocho unidades son de esa partida.
ALTER TABLE "LotAssignment"
  ADD CONSTRAINT "LotAssignment_motivo_check"
  CHECK (length(btrim("reason")) > 0);

CREATE INDEX "LotAssignment_branchId_productId_idx" ON "LotAssignment"("branchId", "productId");
CREATE INDEX "LotAssignment_lotId_idx"              ON "LotAssignment"("lotId");
CREATE INDEX "LotAssignment_userId_idx"             ON "LotAssignment"("userId");

ALTER TABLE "LotAssignment"
  ADD CONSTRAINT "LotAssignment_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LotAssignment"
  ADD CONSTRAINT "LotAssignment_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LotAssignment"
  ADD CONSTRAINT "LotAssignment_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Compuesta, por lo mismo que en el libro: sin ella, ocho unidades de yogur
-- podrian quedar atribuidas a una partida de lavandina.
ALTER TABLE "LotAssignment"
  ADD CONSTRAINT "LotAssignment_productId_lotId_fkey"
  FOREIGN KEY ("productId", "lotId") REFERENCES "ProductLot"("productId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. Un libro es inmutable
--
-- Mismo criterio que "StockMovement" desde la Fase 3A y que los tres libros de
-- cuentas: una fila escrita no se edita ni se borra. Un libro editable no
-- explica nada, porque cualquier descuadre se puede tapar reescribiendolo.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "lot_assignment_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Las atribuciones de lote son inmutables (intento de % sobre el id %). '
    'Para corregir una, registrar la atribucion opuesta.', TG_OP, OLD."id";
END $$;

CREATE TRIGGER "LotAssignment_inmutable"
  BEFORE UPDATE OR DELETE ON "LotAssignment"
  FOR EACH ROW EXECUTE FUNCTION "lot_assignment_inmutable"();


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   -- Aborta si hay stock atribuido a lotes o movimientos con lote: borrar
--   -- estas tablas dejaria el stock del producto en pie pero sin poder decir de
--   -- que partida es cada unidad, que es exactamente lo que la fase construyo.
--   DO $$
--   DECLARE con_stock INTEGER; con_lote INTEGER;
--   BEGIN
--     SELECT count(*) INTO con_stock FROM "BranchLotStock" WHERE "quantity" <> 0;
--     SELECT count(*) INTO con_lote  FROM "StockMovement"  WHERE "lotId" IS NOT NULL;
--     IF con_stock > 0 OR con_lote > 0 THEN
--       RAISE EXCEPTION
--         'Hay % lotes con stock y % movimientos con lote. Se perderia la '
--         'trazabilidad de mercaderia que esta en el deposito.', con_stock, con_lote;
--     END IF;
--   END $$;
--
--   DROP TRIGGER "LotAssignment_inmutable" ON "LotAssignment";
--   DROP FUNCTION "lot_assignment_inmutable"();
--   DROP TABLE "LotAssignment";
--   DROP INDEX "StockMovement_lotId_createdAt_idx";
--   ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_productId_lotId_fkey";
--   ALTER TABLE "StockMovement" DROP COLUMN "lotId";
--   DROP TABLE "BranchLotStock";
--
-- Que se pierde: nada, si la comprobacion de arriba paso. Con lotes cargados
-- pero sin stock ni movimientos, se pierde a que sucursal pertenecia cada
-- partida, que en ese estado no significa nada todavia.
-- =========================================================================
