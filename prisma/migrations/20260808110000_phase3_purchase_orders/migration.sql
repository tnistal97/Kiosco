-- =========================================================================
-- Fase 3C — Ordenes de compra
--
-- Que hace:
--   1. Crea la secuencia que numera las ordenes.
--   2. Crea "PurchaseOrder" y "PurchaseOrderItem".
--
-- Riesgo: BAJO. Es ADITIVA. Crea tablas nuevas y no toca ninguna existente.
--
-- Reversible: SI, y sin perdida mientras no haya ordenes cargadas.
--
-- Ver docs/PURCHASE_FLOW.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La numeracion
--
-- Una SECUENCIA, no `count() + 1`.
--
-- `count() + 1` no es un descuido teorico: dos usuarios creando una orden en
-- el mismo segundo leen el mismo count(), piden el mismo numero, y el indice
-- unico rechaza a uno de los dos. Esa persona ve un error que no provoco, en
-- una operacion que hizo bien.
--
-- `nextval()` es atomico y ademas NO BLOQUEA: no espera al COMMIT de la otra
-- transaccion. Un contador guardado en una tabla --la otra opcion-- obliga a
-- cada alta a esperar a la anterior.
--
-- DEJA HUECOS, y esta bien. Una orden que se empieza y se descarta se lleva su
-- numero. Un numero de orden es una etiqueta para poder decir "la 42" por
-- telefono; para contar cuantas compras se hicieron esta COUNT(*), que es
-- exacto.
--
-- La secuencia NO es el DEFAULT de la columna: el numero se arma en el
-- servidor como 'OC-' + ocho digitos, y un DEFAULT con esa concatenacion
-- apareceria como deriva en cada `migrate diff`.
-- -------------------------------------------------------------------------
CREATE SEQUENCE "PurchaseOrder_numero_seq" AS BIGINT START WITH 1 INCREMENT BY 1;


-- -------------------------------------------------------------------------
-- 2. La orden
--
-- Lo que se PIDIO. Lo que llego vive en "PurchaseReceipt", que es la
-- migracion siguiente.
-- -------------------------------------------------------------------------
CREATE TABLE "PurchaseOrder" (
  "id"            SERIAL       NOT NULL,
  "number"        TEXT         NOT NULL,
  "branchId"      INTEGER      NOT NULL,
  "supplierId"    INTEGER      NOT NULL,
  "status"        TEXT         NOT NULL DEFAULT 'DRAFT',
  "createdById"   INTEGER      NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  "orderedAt"     TIMESTAMP(3),
  "cancelledAt"   TIMESTAMP(3),
  "cancelledById" INTEGER,
  "cancelReason"  TEXT,
  "notes"         TEXT,
  "expectedTotal" NUMERIC(14,2) NOT NULL DEFAULT 0,

  CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- Los cinco estados, y ninguno mas. La lista esta replicada en
-- src/modules/purchases/status.ts y hay una prueba que comprueba que las dos
-- no se separen, igual que con los tipos de movimiento de stock.
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_status_check"
  CHECK ("status" IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'));

-- Un numero en blanco no identifica nada.
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_number_check"
  CHECK (length(btrim("number")) BETWEEN 1 AND 32);

-- El total lo calcula el servidor sumando los subtotales. Negativo seria una
-- compra que nos pagan.
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_expectedTotal_check"
  CHECK ("expectedTotal" >= 0);

-- Coherencia de los estados con sus fechas. Es lo que impide que una orden
-- diga CANCELLED sin cuando, o ORDERED sin haberse confirmado nunca.
--
--   DRAFT      no se pidio ni se cancelo
--   CANCELLED  tiene fecha de cancelacion
--   los demas  tienen fecha de pedido y no de cancelacion
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_fechas_check"
  CHECK (
    CASE "status"
      WHEN 'DRAFT'     THEN "orderedAt" IS NULL AND "cancelledAt" IS NULL
      WHEN 'CANCELLED' THEN "cancelledAt" IS NOT NULL
      ELSE "orderedAt" IS NOT NULL AND "cancelledAt" IS NULL
    END
  );

CREATE UNIQUE INDEX "PurchaseOrder_number_key" ON "PurchaseOrder"("number");

-- El listado: por sucursal, filtrando por estado, mas reciente primero.
CREATE INDEX "PurchaseOrder_branchId_status_createdAt_idx"
  ON "PurchaseOrder"("branchId", "status", "createdAt");

-- "Que le compramos a este proveedor", y la ultima compra que aparece en su
-- ficha.
CREATE INDEX "PurchaseOrder_supplierId_createdAt_idx"
  ON "PurchaseOrder"("supplierId", "createdAt");

CREATE INDEX "PurchaseOrder_createdById_idx" ON "PurchaseOrder"("createdById");

-- RESTRICT en sucursal, proveedor y creador: una orden es historia y lo que
-- referencia no se borra por debajo. El que cancelo es SET NULL porque es un
-- dato accesorio: si el usuario desapareciera, la orden sigue cancelada.
ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrder"
  ADD CONSTRAINT "PurchaseOrder_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 3. Las lineas
--
-- `purchaseUnit` y `unitsPerPurchaseUnit` se COPIAN del producto y quedan
-- congeladas en la linea. No se leen de "Product" al recibir, y esa es la
-- unica forma de que la conversion sea la pactada: si alguien cambia el
-- producto de "caja de 8" a "caja de 12" entre el pedido y la entrega, las 5
-- cajas que se pidieron siguen siendo 40 unidades. Mismo principio que
-- `SaleItem.price`, que congela el precio del dia de la venta.
--
-- `unitCost` es POR UNIDAD DE COMPRA. Una caja de 8 a $8.800 guarda 8800. El
-- costo que llega al producto es ese dividido por `unitsPerPurchaseUnit`.
-- -------------------------------------------------------------------------
CREATE TABLE "PurchaseOrderItem" (
  "id"                   SERIAL        NOT NULL,
  "purchaseOrderId"      INTEGER       NOT NULL,
  "productId"            INTEGER       NOT NULL,
  "orderedQuantity"      NUMERIC(14,3) NOT NULL,
  "receivedQuantity"     NUMERIC(14,3) NOT NULL DEFAULT 0,
  "purchaseUnit"         TEXT          NOT NULL,
  "unitsPerPurchaseUnit" NUMERIC(14,3) NOT NULL,
  "unitCost"             NUMERIC(14,4) NOT NULL,
  "subtotal"             NUMERIC(14,2) NOT NULL,

  CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- Pedir cero de algo es no pedirlo: la linea sobra.
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_orderedQuantity_check"
  CHECK ("orderedQuantity" > 0);

-- ESTA es la restriccion que impide la sobre-recepcion, y esta en la BASE.
--
-- El servicio tambien la comprueba, para dar un mensaje legible, pero la
-- garantia vive aca: ninguna fila que diga "recibi 12 de 10" puede existir,
-- venga de donde venga. La carrera entre dos recepciones simultaneas la cierra
-- ademas el UPDATE condicional del servicio; ver docs/PURCHASE_RECEIVING.md.
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_recibido_check"
  CHECK ("receivedQuantity" >= 0 AND "receivedQuantity" <= "orderedQuantity");

-- Las siete unidades en las que se puede comprar. Las cinco de venta mas PACK
-- y BOX, que solo existen de este lado.
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_purchaseUnit_check"
  CHECK ("purchaseUnit" IN ('UNIT', 'KG', 'G', 'L', 'ML', 'PACK', 'BOX'));

-- Una unidad de compra que contiene cero unidades de venta haria que ninguna
-- compra sumara stock.
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_unitsPerPurchaseUnit_check"
  CHECK ("unitsPerPurchaseUnit" > 0);

-- Costo cero es valido --mercaderia bonificada-- y negativo no.
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_costos_check"
  CHECK ("unitCost" >= 0 AND "subtotal" >= 0);

-- Un producto no puede estar dos veces en la misma orden: serian dos
-- pendientes del mismo articulo y al recibir no habria forma de saber contra
-- cual imputar lo que llega.
CREATE UNIQUE INDEX "PurchaseOrderItem_purchaseOrderId_productId_key"
  ON "PurchaseOrderItem"("purchaseOrderId", "productId");

-- "Cuanto tengo pedido de este producto", para la ficha y para el aviso de
-- reposicion.
CREATE INDEX "PurchaseOrderItem_productId_idx" ON "PurchaseOrderItem"("productId");

-- CASCADE sobre la orden: las lineas no tienen vida propia. Es lo que permite
-- borrar un borrador entero, que es la unica orden que se puede borrar.
ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey"
  FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseOrderItem"
  ADD CONSTRAINT "PurchaseOrderItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP TABLE "PurchaseOrderItem";
-- DROP TABLE "PurchaseOrder";
-- DROP SEQUENCE "PurchaseOrder_numero_seq";
--
-- Se pierden todas las ordenes de compra. Si ya hay recepciones, primero hay
-- que revertir la migracion de recepciones: sus claves foraneas apuntan aca.
--
-- El stock y los costos que las recepciones generaron NO se revierten, y es
-- correcto: la mercaderia entro. Lo que se pierde es el papel que explica por
-- que entro.
--
-- Exportar antes:
--   SELECT * FROM "PurchaseOrder" ORDER BY "id";
--   SELECT * FROM "PurchaseOrderItem" ORDER BY "purchaseOrderId", "id";
-- =========================================================================
