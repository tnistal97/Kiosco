-- =========================================================================
-- Fase 3D — El costo queda congelado en la linea de venta
--
-- Que hace: agrega "SaleItem"."costAtSale", el costo del producto EN EL
-- MOMENTO de venderlo.
--
-- Riesgo: BAJO. Aditiva y nula. Ninguna venta existente cambia.
--
-- Reversible: si. Al volver se pierde el dato, que no se puede reconstruir de
-- ningun otro lado, pero tampoco existia antes.
--
-- Ver docs/REPORTING_MODEL.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La columna
--
-- El problema que resuelve, con numeros:
--
--   Lunes    Coca a $1.500, costaba $1.000  ->  ganancia $500
--   Viernes  llega mercaderia a $1.300
--
-- Sin esta columna, el informe del lunes se calcula con el costo de HOY y la
-- ganancia del lunes pasa a $200. El lunes ya paso: su ganancia no puede
-- cambiar porque llego un camion el viernes. El costo de una venta es un
-- hecho de esa venta.
--
-- Es el mismo argumento por el que "SaleItem"."price" existe desde siempre.
--
-- Cuatro decimales, como "Product"."cost": se copia tal cual, sin redondear.
-- -------------------------------------------------------------------------
ALTER TABLE "SaleItem" ADD COLUMN "costAtSale" NUMERIC(14,4);


-- -------------------------------------------------------------------------
-- 2. Las ventas anteriores quedan en NULL, A PROPOSITO
--
-- No se rellena con "Product"."cost". Seria inventar exactamente el numero
-- que esta columna existe para no inventar: el costo de hoy aplicado a una
-- venta de hace dos meses es una cifra falsa con apariencia de dato.
--
-- Tampoco se rellena con el historial de costos --que si permitiria estimar
-- cual regia en esa fecha-- porque el historial arranca en la Fase 3B y la
-- mayoria del catalogo entro sin costo. Una reconstruccion parcial mezclaria
-- lineas reales con lineas deducidas sin forma de distinguirlas.
--
-- NULL significa "no se sabia". Los informes de rentabilidad excluyen esas
-- lineas y dicen cuantas fueron, que es la unica respuesta honesta.
-- -------------------------------------------------------------------------


-- -------------------------------------------------------------------------
-- 3. El indice
--
-- La rentabilidad por producto agrupa las lineas de un rango por `productId`.
-- Sin indice, cada informe recorre la tabla entera de items.
-- -------------------------------------------------------------------------
CREATE INDEX "SaleItem_productId_idx" ON "SaleItem"("productId");


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP INDEX IF EXISTS "SaleItem_productId_idx";
-- ALTER TABLE "SaleItem" DROP COLUMN "costAtSale";
--
-- Se pierde el costo historico de las ventas hechas desde esta fase y no hay
-- de donde recuperarlo. Es informacion que solo existe aca.
-- =========================================================================
