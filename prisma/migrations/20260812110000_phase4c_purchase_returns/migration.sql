-- =========================================================================
-- Fase 4C — Devoluciones a proveedor: el modelo
--
-- Que hace:
--   1. Crea "PurchaseReturn" y "PurchaseReturnItem" con sus restricciones.
--   2. Crea la secuencia de numeracion "DV-".
--   3. Les da inmutabilidad DESDE QUE SE CONFIRMAN, no antes.
--
-- Riesgo: BAJO. Es ADITIVA. Dos tablas nuevas y una secuencia; no modifica
-- ninguna columna existente y no borra nada. El efecto sobre el stock y sobre
-- el saldo del proveedor llega en las dos migraciones siguientes.
--
-- Reversible: SI, mientras no haya devoluciones confirmadas. Una confirmada
-- movio stock y emitio un credito, y borrar la tabla dejaria esos dos hechos
-- sin explicacion. El rollback al pie lo comprueba y aborta.
--
-- QUE ES UNA DEVOLUCION Y QUE NO. Es un HECHO FISICO: sale mercaderia del
-- deposito y vuelve al proveedor. Por eso es una entidad con renglones y no un
-- movimiento del libro: hay que poder decir que producto volvio, cuanto y a que
-- costo. Una correccion SIN mercaderia --una diferencia de facturacion, un
-- descuento pactado despues-- ya tiene su camino desde la Fase 4B y se llama
-- nota de credito.
--
-- SIEMPRE APUNTA A UNA RECEPCION. No es una limitacion: es la definicion.
-- Devolver es deshacer parte de una entrega concreta, y de esa entrega salen las
-- tres cosas que no se pueden inventar --el costo con el que entro, cuanto entro
-- y en que unidad--. Ver docs/PURCHASE_RETURN_FLOW.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La numeracion
--
-- Una SECUENCIA, no `count() + 1`, por lo mismo que "OC-", "RC-", "PP-" y
-- "CB-": dos devoluciones simultaneas leerian el mismo contador y el indice
-- unico rechazaria a una de las dos. `nextval()` es atomico y no bloquea.
--
-- Deja huecos --un borrador descartado se lleva su numero-- y esta bien: es una
-- etiqueta para decir "la 124" por telefono, no un contador de nada.
-- -------------------------------------------------------------------------
CREATE SEQUENCE "PurchaseReturn_numero_seq" AS BIGINT START WITH 1 INCREMENT BY 1;


-- -------------------------------------------------------------------------
-- 2. La cabecera
-- -------------------------------------------------------------------------
CREATE TABLE "PurchaseReturn" (
  "id"                SERIAL        NOT NULL,
  "number"            TEXT          NOT NULL,
  "branchId"          INTEGER       NOT NULL,
  "supplierId"        INTEGER       NOT NULL,
  "purchaseReceiptId" INTEGER       NOT NULL,
  "status"            TEXT          NOT NULL DEFAULT 'DRAFT',
  "reason"            TEXT          NOT NULL,
  "notes"             TEXT,
  "total"             NUMERIC(14,2) NOT NULL DEFAULT 0,
  "createdById"       INTEGER       NOT NULL,
  "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmedById"     INTEGER,
  "confirmedAt"       TIMESTAMP(3),
  "cancelledById"     INTEGER,
  "cancelledAt"       TIMESTAMP(3),
  "cancelReason"      TEXT,

  CONSTRAINT "PurchaseReturn_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PurchaseReturn_number_key" ON "PurchaseReturn"("number");

-- Los tres estados y nada mas. Un cuarto valor escrito por error --un 'DRAF'
-- con una letra menos-- desapareceria de todos los listados sin que nadie se
-- entere, porque los filtros preguntan por igualdad.
ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_estado_check"
  CHECK ("status" IN ('DRAFT', 'CONFIRMED', 'CANCELLED'));

-- Los cinco motivos. Es una lista corta a proposito: sirve para PREGUNTAR
-- --"cuanto devolvimos por rotura este trimestre"-- y lo que la lista no puede
-- decir va en `notes`. Sobre-modelarla obligaria a elegir entre quince opciones
-- parecidas y a migrar la tabla cada vez que aparece una nueva.
ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_motivo_check"
  CHECK ("reason" IN ('DAMAGED', 'WRONG_PRODUCT', 'QUALITY', 'OVER_DELIVERY', 'OTHER'));

-- Una devolucion de cero pesos no devuelve nada. Negativa seria una recepcion
-- disfrazada, que es la operacion contraria y tiene su propia tabla.
ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_total_check"
  CHECK ("total" >= 0);

-- El estado y sus fechas tienen que contar la misma historia. Una confirmada sin
-- fecha de confirmacion, o una cancelada sin quien la cancelo, son filas que
-- despues nadie puede explicar.
ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_fechas_check"
  CHECK (
    ("status" = 'CONFIRMED' AND "confirmedAt" IS NOT NULL AND "confirmedById" IS NOT NULL)
    OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL)
    OR ("status" = 'DRAFT' AND "confirmedAt" IS NULL AND "cancelledAt" IS NULL)
  );


-- -------------------------------------------------------------------------
-- 3. Los renglones
-- -------------------------------------------------------------------------
CREATE TABLE "PurchaseReturnItem" (
  "id"                    SERIAL        NOT NULL,
  "purchaseReturnId"      INTEGER       NOT NULL,
  "productId"             INTEGER       NOT NULL,
  "purchaseReceiptItemId" INTEGER       NOT NULL,
  "quantity"              NUMERIC(14,3) NOT NULL,
  "purchaseUnit"          TEXT          NOT NULL,
  "unitsPerPurchaseUnit"  NUMERIC(14,3) NOT NULL,
  "stockQuantity"         NUMERIC(14,3) NOT NULL,
  "unitCost"              NUMERIC(14,4) NOT NULL,
  "amount"                NUMERIC(14,2) NOT NULL,

  CONSTRAINT "PurchaseReturnItem_pkey" PRIMARY KEY ("id")
);

-- Cantidades POSITIVAS. El signo negativo lo pone el movimiento de stock, que es
-- donde significa algo; aca "2 cajas" son 2 cajas.
ALTER TABLE "PurchaseReturnItem"
  ADD CONSTRAINT "PurchaseReturnItem_cantidad_check"
  CHECK ("quantity" > 0 AND "stockQuantity" > 0 AND "unitsPerPurchaseUnit" > 0);

-- El costo puede ser cero --una entrega de bonificacion entro a cero y vuelve a
-- cero-- pero nunca negativo.
ALTER TABLE "PurchaseReturnItem"
  ADD CONSTRAINT "PurchaseReturnItem_costo_check"
  CHECK ("unitCost" >= 0 AND "amount" >= 0);

-- La conversion tiene que cerrar: lo que sale del stock es lo que vuelve al
-- proveedor, convertido con el factor de ESTA fila. Sin esto, un renglon podria
-- decir "2 cajas" y sacar 200 unidades del deposito.
ALTER TABLE "PurchaseReturnItem"
  ADD CONSTRAINT "PurchaseReturnItem_conversion_check"
  CHECK ("stockQuantity" = "quantity" * "unitsPerPurchaseUnit");

-- Un producto una sola vez por devolucion. Dos renglones del mismo articulo
-- habria que sumarlos para leer uno solo, y la pantalla los mostraria como si
-- fueran dos cosas distintas.
CREATE UNIQUE INDEX "PurchaseReturnItem_purchaseReturnId_purchaseReceiptItemId_key"
  ON "PurchaseReturnItem"("purchaseReturnId", "purchaseReceiptItemId");


-- -------------------------------------------------------------------------
-- 4. Claves foraneas
--
-- RESTRICT en todo lo que es historia --sucursal, proveedor, recepcion, linea
-- de recepcion, usuarios-- porque nada de eso se borra en este sistema.
--
-- CASCADE en el unico vinculo que es de composicion: los renglones de una
-- devolucion no significan nada sin ella. Es lo mismo que hace
-- `PurchaseOrderItem` con su orden, y solo alcanza a los BORRADORES: una
-- confirmada no se borra, porque el disparador de mas abajo no la deja.
-- -------------------------------------------------------------------------
ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_purchaseReceiptId_fkey"
  FOREIGN KEY ("purchaseReceiptId") REFERENCES "PurchaseReceipt"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_confirmedById_fkey"
  FOREIGN KEY ("confirmedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturn"
  ADD CONSTRAINT "PurchaseReturn_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturnItem"
  ADD CONSTRAINT "PurchaseReturnItem_purchaseReturnId_fkey"
  FOREIGN KEY ("purchaseReturnId") REFERENCES "PurchaseReturn"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturnItem"
  ADD CONSTRAINT "PurchaseReturnItem_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PurchaseReturnItem"
  ADD CONSTRAINT "PurchaseReturnItem_purchaseReceiptItemId_fkey"
  FOREIGN KEY ("purchaseReceiptItemId") REFERENCES "PurchaseReceiptItem"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 5. Indices
-- -------------------------------------------------------------------------
CREATE INDEX "PurchaseReturn_branchId_status_createdAt_idx"
  ON "PurchaseReturn"("branchId", "status", "createdAt");

CREATE INDEX "PurchaseReturn_supplierId_createdAt_idx"
  ON "PurchaseReturn"("supplierId", "createdAt");

-- "Que se devolvio de esta entrega". Es la consulta que descuenta la obligacion
-- neta y la que arma la columna "Devuelto" del detalle de la recepcion.
CREATE INDEX "PurchaseReturn_purchaseReceiptId_idx"
  ON "PurchaseReturn"("purchaseReceiptId");

CREATE INDEX "PurchaseReturn_createdById_idx"
  ON "PurchaseReturn"("createdById");

CREATE INDEX "PurchaseReturnItem_purchaseReturnId_idx"
  ON "PurchaseReturnItem"("purchaseReturnId");

CREATE INDEX "PurchaseReturnItem_productId_idx"
  ON "PurchaseReturnItem"("productId");

-- "Cuanto se devolvio ya de esta linea", que es el tope de lo retornable. Se
-- consulta bajo bloqueo en cada confirmacion, asi que tiene que ser barata.
CREATE INDEX "PurchaseReturnItem_purchaseReceiptItemId_idx"
  ON "PurchaseReturnItem"("purchaseReceiptItemId");


-- -------------------------------------------------------------------------
-- 6. Inmutabilidad, PERO DESDE LA CONFIRMACION
--
-- Es la primera inmutabilidad CONDICIONAL del sistema, y la condicion no es un
-- descuido: un borrador es un papel que se esta armando, y tiene que poder
-- corregirse y descartarse. Lo que no se toca es lo que YA OCURRIO.
--
-- La regla se lee en una linea: se puede escribir sobre una fila mientras su
-- estado sea DRAFT. La transicion DRAFT -> CONFIRMED pasa porque se mira el
-- estado VIEJO; CONFIRMED -> cualquier cosa no pasa. CANCELLED tampoco se
-- reabre: cancelar es una decision, y deshacerla borraria el registro de que
-- alguien la tomo.
--
-- Los renglones preguntan por el estado de SU cabecera. Sin esto quedaria la
-- puerta de atras de siempre: la devolucion confirmada no se toca, pero se
-- podria cambiar la cantidad de un renglon y el credito ya emitido dejaria de
-- corresponderse con la mercaderia que salio.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "purchase_return_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'La devolucion % ya esta %: es inmutable (intento de % sobre el id %). '
    'Movio stock y genero un credito al proveedor; corregirla es registrar otra '
    'operacion, no editar esta.',
    OLD."number", lower(OLD."status"), TG_OP, OLD."id";
END $$;

CREATE TRIGGER "PurchaseReturn_inmutable"
  BEFORE UPDATE OR DELETE ON "PurchaseReturn"
  FOR EACH ROW EXECUTE FUNCTION "purchase_return_inmutable"();

CREATE OR REPLACE FUNCTION "purchase_return_item_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE estado TEXT;
BEGIN
  SELECT "status" INTO estado
    FROM "PurchaseReturn" WHERE "id" = OLD."purchaseReturnId";

  -- Sin cabecera es que la estan borrando en cascada, y eso solo puede pasar
  -- desde un borrador: el disparador de arriba no deja borrar las otras.
  IF estado IS NULL OR estado = 'DRAFT' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'El renglon % pertenece a una devolucion ya %: es inmutable (intento de %).',
    OLD."id", lower(estado), TG_OP;
END $$;

CREATE TRIGGER "PurchaseReturnItem_inmutable"
  BEFORE UPDATE OR DELETE ON "PurchaseReturnItem"
  FOR EACH ROW EXECUTE FUNCTION "purchase_return_item_inmutable"();


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   -- Aborta si hay devoluciones confirmadas: cada una movio stock y emitio un
--   -- credito, y borrar la tabla dejaria esos dos hechos sin explicacion.
--   DO $$
--   DECLARE confirmadas INTEGER;
--   BEGIN
--     SELECT count(*) INTO confirmadas
--       FROM "PurchaseReturn" WHERE "status" = 'CONFIRMED';
--     IF confirmadas > 0 THEN
--       RAISE EXCEPTION
--         'Hay % devoluciones confirmadas. Sus movimientos de stock y sus '
--         'creditos quedarian sin origen. Revertir primero la migracion '
--         'phase4c_purchase_return_finance y resolver el inventario.', confirmadas;
--     END IF;
--   END $$;
--
--   DROP TRIGGER "PurchaseReturnItem_inmutable" ON "PurchaseReturnItem";
--   DROP FUNCTION "purchase_return_item_inmutable"();
--   DROP TRIGGER "PurchaseReturn_inmutable" ON "PurchaseReturn";
--   DROP FUNCTION "purchase_return_inmutable"();
--   DROP TABLE "PurchaseReturnItem";
--   DROP TABLE "PurchaseReturn";
--   DROP SEQUENCE "PurchaseReturn_numero_seq";
--
-- Que se pierde: los borradores en curso, que no habian movido nada. Nada mas,
-- porque la comprobacion de arriba impide llegar hasta aca con algo confirmado.
-- =========================================================================
