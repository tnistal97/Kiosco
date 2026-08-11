-- =========================================================================
-- Fase 4D — Lotes en la venta: de que partida salio cada linea
--
-- Que hace:
--   1. Crea "SaleItemLotAllocation".
--
-- Riesgo: BAJO. Es ADITIVA. Una tabla nueva; "SaleItem" no cambia.
--
-- QUE NO CAMBIA, y es la mitad del disenio: `SaleItem.quantity` sigue diciendo
-- 5. La venta de 5 yogures que sale de dos partidas NO se parte en dos lineas de
-- ticket: el cliente compro cinco yogures, no tres de una cosa y dos de otra.
-- El reparto es informacion de deposito, no de mostrador.
--
-- PARA QUE SIRVE DE VERDAD: la anulacion. Sin esta tabla, devolver una venta
-- diez dias despues obligaria a recalcular FEFO, y para entonces el lote que
-- vencia manana ya vencio: las tres unidades volverian a la partida equivocada.
-- Con ella, la anulacion devuelve a los MISMOS lotes de los que saco.
--
-- Reversible: SI, mientras no haya ventas repartidas. El rollback al pie lo
-- comprueba y aborta.
-- =========================================================================


CREATE TABLE "SaleItemLotAllocation" (
  "id"         SERIAL        NOT NULL,
  "saleItemId" INTEGER       NOT NULL,
  "lotId"      INTEGER       NOT NULL,
  "quantity"   NUMERIC(14,3) NOT NULL,

  CONSTRAINT "SaleItemLotAllocation_pkey" PRIMARY KEY ("id")
);

-- POSITIVA. El signo lo pone el movimiento de stock, que es donde significa
-- algo; aca "3 unidades" son 3 unidades.
ALTER TABLE "SaleItemLotAllocation"
  ADD CONSTRAINT "SaleItemLotAllocation_cantidad_check"
  CHECK ("quantity" > 0);

-- Un lote una sola vez por linea de venta.
CREATE UNIQUE INDEX "SaleItemLotAllocation_saleItemId_lotId_key"
  ON "SaleItemLotAllocation"("saleItemId", "lotId");

CREATE INDEX "SaleItemLotAllocation_lotId_idx" ON "SaleItemLotAllocation"("lotId");

-- RESTRICT y no CASCADE, a diferencia del reparto de una recepcion. La
-- diferencia importa: una linea de venta NO se borra nunca --una venta se anula,
-- no se elimina, desde la Fase 0.6-- asi que un CASCADE aca solo serviria para
-- que un borrado que no deberia existir se lleve la trazabilidad sin ruido.
ALTER TABLE "SaleItemLotAllocation"
  ADD CONSTRAINT "SaleItemLotAllocation_saleItemId_fkey"
  FOREIGN KEY ("saleItemId") REFERENCES "SaleItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SaleItemLotAllocation"
  ADD CONSTRAINT "SaleItemLotAllocation_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "ProductLot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- Inmutable
--
-- El reparto de una venta es un hecho de esa venta. Si se pudiera editar, se
-- podria mover mercaderia de una partida a otra sin que ningun saldo se moviera
-- --y por lo tanto sin que nada se notara--, que es exactamente el agujero que
-- la Fase 4B cerro en las imputaciones de pagos.
--
-- La ANULACION no edita: agrega el movimiento inverso, leyendo estas filas.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "sale_item_lot_allocation_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'El reparto por lote de una venta es inmutable (intento de % sobre el id %). '
    'Una venta se anula, y la anulacion devuelve a estos mismos lotes.',
    TG_OP, OLD."id";
END $$;

CREATE TRIGGER "SaleItemLotAllocation_inmutable"
  BEFORE UPDATE OR DELETE ON "SaleItemLotAllocation"
  FOR EACH ROW EXECUTE FUNCTION "sale_item_lot_allocation_inmutable"();


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DO $$
--   DECLARE cuantas INTEGER;
--   BEGIN
--     SELECT count(*) INTO cuantas FROM "SaleItemLotAllocation";
--     IF cuantas > 0 THEN
--       RAISE EXCEPTION
--         'Hay % repartos de venta por lote. Borrarlos dejaria las anulaciones '
--         'sin saber a que partida devolver la mercaderia.', cuantas;
--     END IF;
--   END $$;
--
--   DROP TRIGGER "SaleItemLotAllocation_inmutable" ON "SaleItemLotAllocation";
--   DROP FUNCTION "sale_item_lot_allocation_inmutable"();
--   DROP TABLE "SaleItemLotAllocation";
--
-- Que se pierde: nada, si la comprobacion de arriba paso.
-- =========================================================================
