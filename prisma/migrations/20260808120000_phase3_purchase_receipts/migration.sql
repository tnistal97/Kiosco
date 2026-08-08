-- =========================================================================
-- Fase 3C — Recepciones de mercaderia
--
-- Que hace:
--   1. Crea "PurchaseReceipt" y "PurchaseReceiptItem".
--   2. Las hace INMUTABLES con un disparador, igual que "StockMovement".
--
-- Riesgo: BAJO. Es ADITIVA. Crea tablas nuevas y no toca ninguna existente.
--
-- Reversible: SI en estructura. Lo recibido NO se revierte: la mercaderia
-- entro y el stock lo refleja. Ver el ROLLBACK al final.
--
-- Ver docs/PURCHASE_RECEIVING.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La recepcion
--
-- Una entrega. Una orden puede tener varias:
--
--   OC-00000042   5 cajas pedidas
--     recepcion 1   lunes     3 cajas
--     recepcion 2   miercoles 2 cajas
--
-- Con las recepciones adentro de la orden --un campo `receivedQuantity` y
-- nada mas-- el sistema podria decir cuanto llego, pero no cuando llego cada
-- parte, ni a que precio, ni quien la recibio. Y eso es justamente lo que se
-- busca cuando algo no cierra.
-- -------------------------------------------------------------------------
CREATE TABLE "PurchaseReceipt" (
  "id"              SERIAL       NOT NULL,
  "purchaseOrderId" INTEGER      NOT NULL,
  "branchId"        INTEGER      NOT NULL,
  "receivedById"    INTEGER      NOT NULL,
  "receivedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "notes"           TEXT,

  CONSTRAINT "PurchaseReceipt_pkey" PRIMARY KEY ("id")
);

-- Las recepciones de una orden, en orden. Es lo que muestra el detalle.
CREATE INDEX "PurchaseReceipt_purchaseOrderId_receivedAt_idx"
  ON "PurchaseReceipt"("purchaseOrderId", "receivedAt");

-- "Que entro en esta sucursal esta semana".
CREATE INDEX "PurchaseReceipt_branchId_receivedAt_idx"
  ON "PurchaseReceipt"("branchId", "receivedAt");

CREATE INDEX "PurchaseReceipt_receivedById_idx" ON "PurchaseReceipt"("receivedById");

-- RESTRICT en los tres: una recepcion movio stock y cambio un costo. Nada de
-- lo que referencia puede desaparecer por debajo.
ALTER TABLE "PurchaseReceipt"
  ADD CONSTRAINT "PurchaseReceipt_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceipt"
  ADD CONSTRAINT "PurchaseReceipt_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceipt"
  ADD CONSTRAINT "PurchaseReceipt_receivedById_fkey"
  FOREIGN KEY ("receivedById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 2. Las lineas de la recepcion
--
-- Guardan los CUATRO numeros que hacen falta para entender que paso, y
-- ninguno es derivable de los otros al leer:
--
--   receivedQuantity  3      cajas, lo que dice el remito
--   unitCost          8900   por caja, lo que dice la FACTURA
--   expectedUnitCost  8800   por caja, lo que decia la ORDEN
--   stockQuantity     24     unidades, lo que entro al deposito
--   stockUnitCost     1112,50 por unidad, lo que quedo en Product.cost
--
-- `expectedUnitCost` parece redundante --esta en la linea de la orden-- y no
-- lo es: una orden puede tener dos recepciones con costos distintos, y sin
-- este campo no se podria decir cual de las dos vino con diferencia.
--
-- `stockQuantity` y `stockUnitCost` se guardan en vez de derivarse al leer
-- porque derivarlos obligaria a conocer el `unitsPerPurchaseUnit` DEL DIA de
-- la recepcion, que puede haber cambiado despues.
-- -------------------------------------------------------------------------
CREATE TABLE "PurchaseReceiptItem" (
  "id"                   SERIAL        NOT NULL,
  "purchaseReceiptId"    INTEGER       NOT NULL,
  "purchaseOrderItemId"  INTEGER       NOT NULL,
  "productId"            INTEGER       NOT NULL,
  "receivedQuantity"     NUMERIC(14,3) NOT NULL,
  "purchaseUnit"         TEXT          NOT NULL,
  "unitsPerPurchaseUnit" NUMERIC(14,3) NOT NULL,
  "unitCost"             NUMERIC(14,4) NOT NULL,
  "expectedUnitCost"     NUMERIC(14,4) NOT NULL,
  "stockQuantity"        NUMERIC(14,3) NOT NULL,
  "stockUnitCost"        NUMERIC(14,4) NOT NULL,

  CONSTRAINT "PurchaseReceiptItem_pkey" PRIMARY KEY ("id")
);

-- Recibir cero de un producto no es recibirlo: la linea sobra.
ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_cantidades_check"
  CHECK ("receivedQuantity" > 0 AND "stockQuantity" > 0);

ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_purchaseUnit_check"
  CHECK ("purchaseUnit" IN ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK', 'BOX'));

ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_unitsPerPurchaseUnit_check"
  CHECK ("unitsPerPurchaseUnit" > 0);

ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_costos_check"
  CHECK ("unitCost" >= 0 AND "expectedUnitCost" >= 0 AND "stockUnitCost" >= 0);

-- La conversion de CANTIDAD tiene que cerrar, y la base lo comprueba.
--
--   stockQuantity = receivedQuantity x unitsPerPurchaseUnit
--
-- Es exacta: multiplicar dos numeros de tres decimales da un numero de seis, y
-- el redondeo a tres solo puede perder algo si el resultado tenia decimales
-- mas alla del tercero --que seria una cantidad de stock imposible y se
-- rechaza antes--. El `round` esta para fijar la escala, no para tolerar.
--
-- La conversion de COSTO no se comprueba aca, y es a proposito: es una
-- DIVISION, y $1.000 entre 3 unidades no vuelve a dar $1.000 al multiplicar.
-- Un CHECK sobre ella rechazaria recepciones correctas.
ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_conversion_check"
  CHECK ("stockQuantity" = round("receivedQuantity" * "unitsPerPurchaseUnit", 3));

CREATE INDEX "PurchaseReceiptItem_purchaseReceiptId_idx"
  ON "PurchaseReceiptItem"("purchaseReceiptId");

CREATE INDEX "PurchaseReceiptItem_purchaseOrderItemId_idx"
  ON "PurchaseReceiptItem"("purchaseOrderItemId");

CREATE INDEX "PurchaseReceiptItem_productId_idx" ON "PurchaseReceiptItem"("productId");

-- RESTRICT tambien sobre la cabecera: una recepcion no se borra, asi que sus
-- lineas tampoco. No hay CASCADE en ningun lado de esta tabla, y es
-- deliberado: un CASCADE seria una forma de borrar historia sin nombrarla.
ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_purchaseReceiptId_fkey"
  FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_purchaseOrderItemId_fkey"
  FOREIGN KEY ("purchaseOrderItemId") REFERENCES "PurchaseOrderItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReceiptItem"
  ADD CONSTRAINT "PurchaseReceiptItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 3. Inmutabilidad
--
-- Mismo mecanismo que "StockMovement" y "ProductCostHistory", y por el mismo
-- motivo: una recepcion movio stock y cambio un costo. Editarla dejaria el
-- libro de inventario contando una historia y la recepcion contando otra.
--
-- Un error se corrige CON UN MOVIMIENTO NUEVO. Se recibio de mas: un ajuste de
-- inventario con su motivo. Se recibio al costo equivocado: un cambio de costo
-- con su motivo. Las dos cosas dejan su propio rastro, que es exactamente lo
-- que hace falta para entender que paso.
--
-- TRUNCATE no dispara disparadores de fila, asi que el reinicio de la base de
-- pruebas sigue funcionando.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "purchase_receipt_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'Una recepcion confirmada es inmutable (intento de % sobre % id %). '
    'Para corregir un error, registra un ajuste de inventario o un cambio de costo.',
    TG_OP, TG_TABLE_NAME, OLD."id";
END $$;

CREATE TRIGGER "PurchaseReceipt_inmutable"
  BEFORE UPDATE OR DELETE ON "PurchaseReceipt"
  FOR EACH ROW EXECUTE FUNCTION "purchase_receipt_inmutable"();

CREATE TRIGGER "PurchaseReceiptItem_inmutable"
  BEFORE UPDATE OR DELETE ON "PurchaseReceiptItem"
  FOR EACH ROW EXECUTE FUNCTION "purchase_receipt_inmutable"();


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP TRIGGER "PurchaseReceiptItem_inmutable" ON "PurchaseReceiptItem";
-- DROP TRIGGER "PurchaseReceipt_inmutable" ON "PurchaseReceipt";
-- DROP FUNCTION "purchase_receipt_inmutable"();
-- DROP TABLE "PurchaseReceiptItem";
-- DROP TABLE "PurchaseReceipt";
--
-- ADVERTENCIA. Lo que se pierde no es una copia de nada:
--
--   · el registro de que entro, cuando y quien lo recibio;
--   · el costo de factura y la diferencia contra el pedido.
--
-- El STOCK NO se revierte, y es correcto: la mercaderia esta en el deposito.
-- Los movimientos del libro quedan --son inmutables-- pero su `referenceId`
-- pasa a apuntar a una recepcion que ya no existe.
--
-- `ProductCostHistory."receiptId"` tiene una FK contra esta tabla: hay que
-- revertir antes la migracion phase3_purchase_cost_links, o ponerlos en NULL.
--
-- Exportar antes:
--   SELECT * FROM "PurchaseReceipt" ORDER BY "id";
--   SELECT * FROM "PurchaseReceiptItem" ORDER BY "purchaseReceiptId", "id";
-- =========================================================================
