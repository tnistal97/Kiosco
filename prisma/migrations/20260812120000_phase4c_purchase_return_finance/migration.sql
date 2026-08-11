-- =========================================================================
-- Fase 4C — El credito que genera una devolucion
--
-- Que hace:
--   1. Agrega "SupplierAccountMovement"."returnId" con su clave foranea.
--   2. Impide que una devolucion emita dos creditos.
--
-- Riesgo: BAJO. Es ADITIVA. Una columna nueva, opcional, sin relleno: ninguna
-- fila existente proviene de una devolucion, porque hasta esta fase no habia
-- devoluciones.
--
-- Reversible: SI. Se pierde el vinculo entre el credito y la devolucion que lo
-- origino; los saldos no se mueven, porque el importe sigue en la fila del
-- libro. Ver el rollback al pie.
--
-- POR QUE UNA COLUMNA Y NO UN TEXTO EN `reason`. Con el texto, "¿que credito
-- emitio la devolucion DV-00000124?" se contesta leyendo frases, y "¿el importe
-- del credito coincide con el de la devolucion?" no se puede contestar. Con la
-- clave foranea, las dos son una union, y la segunda es una de las
-- reconciliaciones nuevas de esta fase.
--
-- SIGUE SIENDO OPCIONAL, y eso importa: un `PURCHASE_CREDIT` puede no tener
-- devolucion detras. Una nota de credito del proveedor por una diferencia de
-- facturacion no devuelve ninguna mercaderia, y esa es una operacion legitima
-- desde la Fase 4B. Ver docs/PURCHASE_RETURN_ACCOUNTING.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La columna
-- -------------------------------------------------------------------------
ALTER TABLE "SupplierAccountMovement"
  ADD COLUMN "returnId" INTEGER;

-- SET NULL, igual que sus dos hermanas `receiptId` y `paymentId`, y no RESTRICT.
-- No es una preferencia: es lo que declara el esquema para una relacion
-- OPCIONAL, y cualquier otra cosa aparece como deriva en `migrate diff`.
--
-- En la practica no se dispara nunca: una devolucion confirmada no se borra
-- --el disparador de inmutabilidad no lo permite-- y una en borrador no tiene
-- credito que apunte a ella.
ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_returnId_fkey"
  FOREIGN KEY ("returnId") REFERENCES "PurchaseReturn"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SupplierAccountMovement_returnId_idx"
  ON "SupplierAccountMovement"("returnId");


-- -------------------------------------------------------------------------
-- 2. Un credito por devolucion, ESTRUCTURALMENTE
--
-- El mismo mecanismo que impide que una recepcion genere dos cargos, y por el
-- mismo motivo: un reintento de la peticion de confirmar --el navegador que
-- pierde la respuesta y vuelve a mandar-- llegaria a escribir el credito dos
-- veces, y la deuda con el proveedor bajaria el doble.
--
-- Que la garantia sea de la BASE y no del servicio es el punto. Una
-- comprobacion en TypeScript la salta cualquiera que escriba por otro camino
-- --un script, una consola, una version futura de este mismo archivo--; un
-- indice unico no.
--
-- PARCIAL, sobre los que tienen devolucion: los creditos sin devolucion son
-- todos distintos entre si y no se estorban.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX "SupplierAccountMovement_un_credito_por_devolucion"
  ON "SupplierAccountMovement"("returnId")
  WHERE "returnId" IS NOT NULL;


-- -------------------------------------------------------------------------
-- 3. Solo un credito puede venir de una devolucion
--
-- Un `PAYMENT` o un `PURCHASE_CHARGE` con `returnId` no significaria nada: una
-- devolucion no paga ni compra. Y un `MANUAL_ADJUSTMENT` con devolucion seria
-- una forma de escribir un credito esquivando su tipo.
-- -------------------------------------------------------------------------
ALTER TABLE "SupplierAccountMovement"
  ADD CONSTRAINT "SupplierAccountMovement_devolucion_check"
  CHECK ("returnId" IS NULL OR "type" = 'PURCHASE_CREDIT');


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP INDEX "SupplierAccountMovement_un_credito_por_devolucion";
--   ALTER TABLE "SupplierAccountMovement"
--     DROP CONSTRAINT "SupplierAccountMovement_devolucion_check";
--   DROP INDEX "SupplierAccountMovement_returnId_idx";
--   ALTER TABLE "SupplierAccountMovement"
--     DROP CONSTRAINT "SupplierAccountMovement_returnId_fkey";
--   ALTER TABLE "SupplierAccountMovement" DROP COLUMN "returnId";
--
-- Que se pierde: QUE DEVOLUCION ORIGINO CADA CREDITO. Los saldos no se mueven
-- --el importe sigue en la fila del libro-- y la obligacion neta de cada entrega
-- tampoco, porque se calcula desde `PurchaseReturn`, no desde esta columna. Lo
-- que deja de poder comprobarse es que el credito y la devolucion digan el mismo
-- numero, que es una de las reconciliaciones de esta fase.
--
-- Se puede reconstruir a mano, con cuidado: cada devolucion confirmada tiene un
-- credito de su mismo importe, para su mismo proveedor, escrito en el mismo
-- instante. Con dos devoluciones del mismo importe al mismo proveedor el mismo
-- dia, la reconstruccion es ambigua.
-- =========================================================================
