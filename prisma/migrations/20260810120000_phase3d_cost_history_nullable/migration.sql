-- =========================================================================
-- Fase 3D — "Sin costo" deja de escribirse como cero
--
-- Que hace: "ProductCostHistory"."newCost" pasa a admitir NULL, y las filas
-- que dicen 0 por haber borrado el costo se corrigen.
--
-- Riesgo: MEDIO. Modifica filas existentes. La correccion esta acotada por
-- una condicion que solo puede cumplir el caso que se quiere arreglar.
--
-- Reversible: la estructura si; la distincion entre "costo cero" y "sin
-- costo" se vuelve a perder. Ver el ROLLBACK.
--
-- Ver docs/PHASE3_RECONCILIATION.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Por que
--
-- Borrar el costo de un producto --dejarlo en NULL-- guardaba `newCost = 0`.
-- Son dos afirmaciones distintas y una es falsa:
--
--   0     "no me costo nada"  -> margen del 100%
--   NULL  "no sabemos"
--
-- La fila decia que el producto habia pasado a costar cero cuando lo que
-- habia pasado era que alguien lo habia dejado sin cargar. Ademas rompia la
-- invariante que comprueba la reconciliacion de esta fase --`Product.cost`
-- tiene que ser el `newCost` del ultimo evento-- porque el producto quedaba
-- en NULL y su historial en 0.
-- -------------------------------------------------------------------------
ALTER TABLE "ProductCostHistory" ALTER COLUMN "newCost" DROP NOT NULL;


-- -------------------------------------------------------------------------
-- 2. Las filas que ya mienten
--
-- Se corrige SOLO la fila que cumple las tres condiciones a la vez:
--
--   a) dice 0
--   b) es la ULTIMA de ese producto
--   c) el producto quedo hoy sin costo
--
-- Las tres juntas describen un unico hecho posible: ese 0 se escribio al
-- borrar el costo. Un producto que de verdad se compro a cero --una
-- bonificacion, una muestra-- no cumple (c), porque su costo actual seria 0 y
-- no NULL.
--
-- Una fila de 0 que NO sea la ultima se deja como esta: no hay forma de
-- distinguir "se borro el costo y despues se volvio a cargar" de "se compro a
-- cero y despues subio", y reescribir historial sobre una suposicion es
-- justamente lo que este proyecto no hace.
-- -------------------------------------------------------------------------
UPDATE "ProductCostHistory" h
   SET "newCost" = NULL
  FROM "Product" p
 WHERE p."id" = h."productId"
   AND h."newCost" = 0
   AND p."cost" IS NULL
   AND h."id" = (
     SELECT max(h2."id") FROM "ProductCostHistory" h2 WHERE h2."productId" = h."productId"
   );


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- UPDATE "ProductCostHistory" SET "newCost" = 0 WHERE "newCost" IS NULL;
-- ALTER TABLE "ProductCostHistory" ALTER COLUMN "newCost" SET NOT NULL;
--
-- La reversion vuelve a escribir el cero que esta migracion vino a sacar. Es
-- lo unico que puede hacer: la columna no admitiria NULL.
-- =========================================================================
