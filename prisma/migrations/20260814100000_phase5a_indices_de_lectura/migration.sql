-- =============================================================================
-- Fase 5A — El indice que faltaba desde 2025
--
-- Que hace: crea un indice sobre "SaleItem"("saleId").
--
-- Por que: PostgreSQL NO indexa las claves foraneas. Crear
-- `SaleItem_saleId_fkey` obliga a que el valor exista en "Sale", y nada mas;
-- buscar los renglones DE una venta sigue recorriendo la tabla entera. Esa
-- columna no tuvo indice en ninguna de las 42 migraciones anteriores, y la
-- consulta que la usa es la mas frecuente que hay: abrir una venta, anularla,
-- listar un comprobante.
--
-- Como aparecio: midiendo la ventana de mantenimiento con volumen de
-- produccion (`npm run rehearsal:prodlike`). La migracion
-- `phase3_sale_payments` tardo 113 ms con los datos reales y 31.119 ms con
-- veinte veces esos datos. Veinte veces el volumen, doscientas setenta y cinco
-- veces el tiempo: eso no es lento, es cuadratico. La causa es el relleno
--
--     UPDATE "Sale" s SET "total" = (SELECT sum(...) FROM "SaleItem" i
--                                     WHERE i."saleId" = s."id")
--
-- que sin indice hace un recorrido completo de "SaleItem" por cada venta.
--
-- POR QUE ACA Y NO ARREGLANDO AQUELLA MIGRACION
--
-- Corregir `phase3_sale_payments` cambiaria su checksum. Produccion todavia no
-- la aplico --esta en la migracion 1 de 43-- asi que ahi seria inofensivo,
-- pero desarrollo, pruebas y el ensayo si la tienen aplicada, y `migrate
-- deploy` se niega a seguir cuando un checksum no coincide. Esa negativa es
-- una garantia del proyecto y no se afloja para ganar 113 ms en una ventana
-- que se corre una sola vez.
--
-- El costo que este indice si elimina es el PERMANENTE: el de cada venta que
-- se abre, cada anulacion y cada comprobante, todos los dias. Ese es el
-- motivo real del cambio; la migracion lenta fue como se descubrio.
--
-- Reversible: si. Un indice se crea y se borra sin tocar un solo dato.
-- Bloqueo: SHARE sobre "SaleItem" mientras se construye. Con las 1.701 filas
-- de produccion es instantaneo.
-- =============================================================================

-- IF NOT EXISTS: la Fase 3D creo `SaleItem_productId_idx` sobre la misma tabla
-- y alguien podria haber agregado este a mano en un servidor. Que la migracion
-- se pueda correr dos veces sin fallar es la regla del proyecto.
CREATE INDEX IF NOT EXISTS "SaleItem_saleId_idx" ON "SaleItem" ("saleId");

-- ---------------------------------------------------------------------------
-- Comprobacion: el indice existe y la columna es la que se penso.
--
-- Un indice sobre la columna equivocada es peor que ninguno: no acelera nada y
-- hace creer que el problema esta resuelto.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'SaleItem'
       AND indexname  = 'SaleItem_saleId_idx'
       AND indexdef LIKE '%("saleId")%'
  ) THEN
    RAISE EXCEPTION 'No se creo SaleItem_saleId_idx sobre ("saleId")';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- DOWN (no se ejecuta; queda escrito para poder revertir a mano)
--
--   DROP INDEX IF EXISTS "SaleItem_saleId_idx";
--
-- Sin efecto sobre los datos. Volver atras solo devuelve la lentitud.
-- ---------------------------------------------------------------------------
