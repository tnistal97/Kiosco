-- =========================================================================
-- Fase 4D — Lotes en la compra: recepcion y devolucion
--
-- Que hace:
--   1. Crea "PurchaseReceiptItemLot": como se reparte una linea entre partidas.
--   2. Agrega "PurchaseReturnItem"."lotId": de que partida vuelve lo que vuelve.
--   3. AFLOJA la clave unica de los renglones de devolucion, de (devolucion,
--      linea) a (devolucion, linea, lote).
--
-- Riesgo: BAJO. Una tabla nueva, una columna NULLABLE y una clave unica que se
-- afloja. Aflojar una clave unica no puede invalidar ninguna fila existente.
--
-- POR QUE AFLOJARLA. Un pedido de 10 cajas puede llegar en dos partidas --6 que
-- vencen el 5 de septiembre y 4 el 18-- y eso es UNA linea de recepcion. Si el
-- proveedor quiere las dos de vuelta, esa devolucion fisica necesita DOS
-- renglones, uno por partida, porque cada uno saca de un lote distinto. Con la
-- clave de la Fase 4C habria que armar dos devoluciones separadas para un solo
-- hecho.
--
-- El caso con lote nulo --el catalogo sin rastreo, que es todo el existente-- lo
-- cubre un indice unico PARCIAL, porque PostgreSQL considera dos NULL distintos
-- entre si y sin el la clave de tres columnas dejaria pasar dos renglones
-- iguales.
--
-- Reversible: SI. El rollback al pie comprueba que ningun renglon use lote antes
-- de volver a la clave estricta.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. El reparto de una linea de recepcion entre partidas
--
-- Es una entidad y no una columna en la linea justamente porque el reparto es
-- uno-a-muchos. Con una columna `lotId` en la linea habria que partir la
-- recepcion en dos lineas del mismo producto, y entonces el costo, la conversion
-- y el tope de lo pedido tendrian que repartirse tambien.
-- -------------------------------------------------------------------------
CREATE TABLE "PurchaseReceiptItemLot" (
  "id"                    SERIAL        NOT NULL,
  "purchaseReceiptItemId" INTEGER       NOT NULL,
  "lotId"                 INTEGER       NOT NULL,
  "quantity"              NUMERIC(14,3) NOT NULL,
  "stockQuantity"         NUMERIC(14,3) NOT NULL,

  CONSTRAINT "PurchaseReceiptItemLot_pkey" PRIMARY KEY ("id")
);

-- Cantidades positivas: aca "6 cajas" son 6 cajas. Un reparto de cero no reparte.
ALTER TABLE "PurchaseReceiptItemLot"
  ADD CONSTRAINT "PurchaseReceiptItemLot_cantidad_check"
  CHECK ("quantity" > 0 AND "stockQuantity" > 0);

-- Un lote una sola vez por linea: dos filas de la misma partida habria que
-- sumarlas para leer una sola.
CREATE UNIQUE INDEX "PurchaseReceiptItemLot_purchaseReceiptItemId_lotId_key"
  ON "PurchaseReceiptItemLot"("purchaseReceiptItemId", "lotId");

CREATE INDEX "PurchaseReceiptItemLot_lotId_idx" ON "PurchaseReceiptItemLot"("lotId");

-- CASCADE con su linea, igual que "PurchaseReturnItem" con su devolucion: el
-- reparto no significa nada sin la linea que reparte. En la practica no se
-- ejecuta nunca, porque una recepcion es inmutable desde la Fase 3C.
ALTER TABLE "PurchaseReceiptItemLot"
  ADD CONSTRAINT "PurchaseReceiptItemLot_purchaseReceiptItemId_fkey"
  FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "PurchaseReceiptItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceiptItemLot"
  ADD CONSTRAINT "PurchaseReceiptItemLot_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "ProductLot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 2. De que partida vuelve la mercaderia
--
-- No se puede elegir cualquiera: tiene que ser uno de los lotes CON LOS QUE
-- LLEGO ESA LINEA. Devolver del lote equivocado sacaria mercaderia de una
-- partida que el proveedor nunca mando y dejaria en el deposito la que hay que
-- sacar. Eso lo hace cumplir el servicio, y lo comprueba la reconciliacion.
--
-- La ALTER no dispara el trigger de inmutabilidad de la Fase 4C: ese es un
-- disparador de fila, y agregar una columna es DDL.
-- -------------------------------------------------------------------------
ALTER TABLE "PurchaseReturnItem" ADD COLUMN "lotId" INTEGER;

ALTER TABLE "PurchaseReturnItem"
  ADD CONSTRAINT "PurchaseReturnItem_lotId_fkey"
  FOREIGN KEY ("lotId") REFERENCES "ProductLot"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "PurchaseReturnItem_lotId_idx" ON "PurchaseReturnItem"("lotId");


-- -------------------------------------------------------------------------
-- 3. La clave unica, un lote mas ancha
-- -------------------------------------------------------------------------
DROP INDEX "PurchaseReturnItem_purchaseReturnId_purchaseReceiptItemId_key";

CREATE UNIQUE INDEX "PurchaseReturnItem_devolucion_linea_lote_key"
  ON "PurchaseReturnItem"("purchaseReturnId", "purchaseReceiptItemId", "lotId");

-- El caso sin lote. Sin este indice, la clave de arriba dejaria entrar dos
-- renglones identicos de un producto sin rastreo: para PostgreSQL, NULL no es
-- igual a NULL.
CREATE UNIQUE INDEX "PurchaseReturnItem_devolucion_linea_sin_lote_key"
  ON "PurchaseReturnItem"("purchaseReturnId", "purchaseReceiptItemId")
  WHERE "lotId" IS NULL;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   -- Aborta si algun renglon de devolucion apunta a un lote, o si hay repartos
--   -- de recepcion: volver a la clave estricta rechazaria filas ya escritas.
--   DO $$
--   DECLARE con_lote INTEGER; repartos INTEGER;
--   BEGIN
--     SELECT count(*) INTO con_lote FROM "PurchaseReturnItem" WHERE "lotId" IS NOT NULL;
--     SELECT count(*) INTO repartos FROM "PurchaseReceiptItemLot";
--     IF con_lote > 0 OR repartos > 0 THEN
--       RAISE EXCEPTION
--         'Hay % renglones de devolucion con lote y % repartos de recepcion. '
--         'Se perderia de que partida entro y salio la mercaderia.', con_lote, repartos;
--     END IF;
--   END $$;
--
--   DROP INDEX "PurchaseReturnItem_devolucion_linea_sin_lote_key";
--   DROP INDEX "PurchaseReturnItem_devolucion_linea_lote_key";
--   CREATE UNIQUE INDEX "PurchaseReturnItem_purchaseReturnId_purchaseReceiptItemId_key"
--     ON "PurchaseReturnItem"("purchaseReturnId", "purchaseReceiptItemId");
--   DROP INDEX "PurchaseReturnItem_lotId_idx";
--   ALTER TABLE "PurchaseReturnItem" DROP CONSTRAINT "PurchaseReturnItem_lotId_fkey";
--   ALTER TABLE "PurchaseReturnItem" DROP COLUMN "lotId";
--   DROP TABLE "PurchaseReceiptItemLot";
--
-- Que se pierde: nada, si la comprobacion de arriba paso.
-- =========================================================================
