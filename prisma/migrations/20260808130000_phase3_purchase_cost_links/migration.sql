-- =========================================================================
-- Fase 3C — El historial de costos apunta a la recepcion
--
-- Que hace:
--   "ProductCostHistory"."purchaseId" pasa a llamarse "receiptId" y recibe la
--   clave foranea que no podia tener cuando se creo.
--
-- Riesgo: BAJO, y la comprobacion previa lo confirma antes de tocar nada.
--
-- Reversible: SI, y sin perdida mientras la columna siga vacia.
--
-- Ver docs/PURCHASE_RECEIVING.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Por que se renombra en vez de agregar una columna nueva
--
-- La Fase 3B dejo `purchaseId` preparada y ESCRIBIO NULL en todas las filas:
-- no habia compras, asi que nada podia llenarla. Renombrar una columna que
-- nunca contuvo un valor no pierde informacion.
--
-- El motivo de renombrarla es semantico, y es la decision de fondo de este
-- archivo: EL COSTO CAMBIA CUANDO LA MERCADERIA LLEGA, NO CUANDO SE PIDE. Una
-- orden confirmada a $1.025 que nunca llega no tiene por que haber movido
-- nada. Ademas una orden puede tener dos recepciones con costos distintos, y
-- una clave que apunte a la orden no permitiria distinguirlas.
--
-- Una columna llamada `purchaseId` con una clave foranea contra
-- "PurchaseReceipt" seria una trampa permanente para quien la lea despues.
--
-- La comprobacion de abajo es lo que hace que esto sea seguro y no comodo: si
-- la columna tuviera aunque sea un valor, la migracion ABORTA en vez de
-- renombrar a ciegas.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  con_valor INTEGER;
BEGIN
  SELECT count(*) INTO con_valor
    FROM "ProductCostHistory"
   WHERE "purchaseId" IS NOT NULL;

  IF con_valor > 0 THEN
    RAISE EXCEPTION
      'Migracion abortada: "ProductCostHistory"."purchaseId" tiene % fila(s) con valor. '
      'La columna se creo vacia en la Fase 3B y renombrarla asumia que seguia vacia. '
      'Revisar de donde salieron esos valores antes de continuar.',
      con_valor;
  END IF;
END $$;

ALTER TABLE "ProductCostHistory" RENAME COLUMN "purchaseId" TO "receiptId";


-- -------------------------------------------------------------------------
-- 2. La clave foranea que faltaba
--
-- En la Fase 3B no se pudo poner porque "PurchaseReceipt" no existia: no se
-- puede referenciar lo que no esta. Ahora si.
--
-- SET NULL y no RESTRICT, a diferencia de casi todo lo demas en este dominio.
-- El motivo: la recepcion es INMUTABLE y no se borra nunca por el camino
-- normal, asi que la accion solo se ejecutaria en una reversion manual. En ese
-- caso, perder el vinculo es preferible a que la fila de historial --que
-- tambien es inmutable-- bloquee la limpieza. El cambio de costo ocurrio igual
-- y sigue registrado con su antes, su despues y su motivo.
-- -------------------------------------------------------------------------
ALTER TABLE "ProductCostHistory"
  ADD CONSTRAINT "ProductCostHistory_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "PurchaseReceipt"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- "Que costos movio esta recepcion". Es lo que muestra el detalle de la
-- recepcion, y sin indice seria un recorrido de toda la tabla.
CREATE INDEX "ProductCostHistory_receiptId_idx" ON "ProductCostHistory"("receiptId");


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP INDEX "ProductCostHistory_receiptId_idx";
-- ALTER TABLE "ProductCostHistory" DROP CONSTRAINT "ProductCostHistory_receiptId_fkey";
-- ALTER TABLE "ProductCostHistory" RENAME COLUMN "receiptId" TO "purchaseId";
--
-- Sin perdida SI la columna sigue vacia. Si ya hubo recepciones, los vinculos
-- quedan como numeros sueltos sin clave foranea que los sostenga: apuntarian a
-- filas de "PurchaseReceipt" que la reversion de la migracion anterior habria
-- borrado.
--
-- Exportar antes:
--   SELECT "id","productId","receiptId","supplierId","previousCost","newCost"
--     FROM "ProductCostHistory" WHERE "receiptId" IS NOT NULL;
-- =========================================================================
