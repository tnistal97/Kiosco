-- Fase 3 -- El dinero deja de ser punto flotante
--
-- Siete columnas en cinco tablas pasan de `double precision` a
-- `numeric(14,2)`. La decision --por que 14, por que 2, por que ahora-- esta
-- en docs/PHASE3_MONEY_MIGRATION.md.
--
-- Resumen: `Float` es binario de base 2 y los precios se escriben en base 10.
-- 0.1 + 0.2 da 0.30000000000000004. El codigo lo compensaba redondeando en
-- cada paso, y aun asi la suma de subtotales podia diferir del total en un
-- centavo. La Fase 3 introduce pagos combinados, donde la comparacion
-- "suma de pagos == total" es literal: con `Float` esa igualdad falla sola.
--
-- ESTA MIGRACION NO ES ADITIVA. Es la primera del proyecto que no lo es, y
-- hay que decirlo: si se aplica y despues se revierte el despliegue a la
-- version anterior de la aplicacion, el codigo viejo recibe `Decimal` donde
-- espera `number` y calcula mal en silencio. El orden correcto es primero el
-- codigo nuevo --que lee las dos cosas-- y despues esto. La vuelta atras real
-- es el bloque DOWN del final.
--
-- BLOQUEO: `ALTER COLUMN TYPE` toma un ACCESS EXCLUSIVE y reescribe la tabla.
-- Con decenas de miles de filas son segundos, pero `Sale`, `SaleItem` y
-- `CashRegisterMovement` son las tablas calientes: va en ventana.

-- 1) Comprobacion previa.
--
-- Un importe mayor a 999.999.999.999,99 haria fallar el ALTER con
-- "numeric field overflow" a mitad de camino. Se comprueba antes y se falla
-- con un mensaje que se entienda. Todo esto corre dentro de la transaccion de
-- la migracion: si algo revienta aca, no queda nada aplicado.
DO $$
DECLARE
  fuera_de_rango integer;
BEGIN
  SELECT count(*) INTO fuera_de_rango FROM (
    SELECT "price"       AS v FROM "Product"
    UNION ALL SELECT "price"       FROM "SaleItem"
    UNION ALL SELECT "currentCash" FROM "Branch"
    UNION ALL SELECT "amount"      FROM "CashRegisterMovement"
    UNION ALL SELECT "amount"      FROM "CashCount"
    UNION ALL SELECT "expected"    FROM "CashCount"
    UNION ALL SELECT "difference"  FROM "CashCount"
  ) AS todos
  WHERE v IS NOT NULL AND abs(v) >= 1e12;

  IF fuera_de_rango > 0 THEN
    RAISE EXCEPTION
      'Hay % importes que no entran en numeric(14,2). Revisarlos antes de migrar.',
      fuera_de_rango;
  END IF;
END $$;

-- 2) Conversion.
--
-- El `USING` es obligatorio: sin el, PostgreSQL se niega a pasar de
-- `double precision` a `numeric` porque la conversion puede perder
-- informacion. `ROUND(...::numeric, 2)` la vuelve explicita, y es la perdida
-- que buscamos: un precio guardado como 4850.000000001 --residuo de haber
-- sumado en Float-- queda 4850.00, que es lo que siempre fue.

ALTER TABLE "Product"
  ALTER COLUMN "price" TYPE DECIMAL(14,2) USING ROUND("price"::numeric, 2);

ALTER TABLE "SaleItem"
  ALTER COLUMN "price" TYPE DECIMAL(14,2) USING ROUND("price"::numeric, 2);

ALTER TABLE "Branch"
  ALTER COLUMN "currentCash" DROP DEFAULT,
  ALTER COLUMN "currentCash" TYPE DECIMAL(14,2) USING ROUND("currentCash"::numeric, 2);
ALTER TABLE "Branch"
  ALTER COLUMN "currentCash" SET DEFAULT 0;

ALTER TABLE "CashRegisterMovement"
  ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "CashCount"
  ALTER COLUMN "amount" TYPE DECIMAL(14,2) USING ROUND("amount"::numeric, 2);

ALTER TABLE "CashCount"
  ALTER COLUMN "expected" DROP DEFAULT,
  ALTER COLUMN "expected" TYPE DECIMAL(14,2) USING ROUND("expected"::numeric, 2);
ALTER TABLE "CashCount"
  ALTER COLUMN "expected" SET DEFAULT 0;

ALTER TABLE "CashCount"
  ALTER COLUMN "difference" DROP DEFAULT,
  ALTER COLUMN "difference" TYPE DECIMAL(14,2) USING ROUND("difference"::numeric, 2);
ALTER TABLE "CashCount"
  ALTER COLUMN "difference" SET DEFAULT 0;

-- 3) Comprobacion posterior.
--
-- Que no quede ninguna. Si mañana alguien agrega una columna monetaria en
-- `Float` sin darse cuenta, esta consulta la encuentra --y la prueba de
-- migraciones la corre tambien desde fuera--.
DO $$
DECLARE
  restantes integer;
BEGIN
  SELECT count(*) INTO restantes
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND data_type = 'double precision'
    AND table_name IN (
      'Product', 'SaleItem', 'Branch', 'CashRegisterMovement', 'CashCount', 'Sale'
    );

  IF restantes > 0 THEN
    RAISE EXCEPTION 'Quedaron % columnas monetarias en double precision.', restantes;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- DOWN (no se ejecuta; es lo unico que queda si hay que revertir a mano)
--
-- Devuelve la ESTRUCTURA, no la informacion. Los decimales que se redondearon
-- al aplicar no vuelven: eran ruido de punto flotante y ya no estan. Si eso
-- importara --no deberia-- la unica fuente es el respaldo previo.
--
--   ALTER TABLE "Product"
--     ALTER COLUMN "price" TYPE DOUBLE PRECISION USING "price"::double precision;
--
--   ALTER TABLE "SaleItem"
--     ALTER COLUMN "price" TYPE DOUBLE PRECISION USING "price"::double precision;
--
--   ALTER TABLE "Branch"
--     ALTER COLUMN "currentCash" DROP DEFAULT,
--     ALTER COLUMN "currentCash" TYPE DOUBLE PRECISION USING "currentCash"::double precision;
--   ALTER TABLE "Branch" ALTER COLUMN "currentCash" SET DEFAULT 0;
--
--   ALTER TABLE "CashRegisterMovement"
--     ALTER COLUMN "amount" TYPE DOUBLE PRECISION USING "amount"::double precision;
--
--   ALTER TABLE "CashCount"
--     ALTER COLUMN "amount" TYPE DOUBLE PRECISION USING "amount"::double precision;
--   ALTER TABLE "CashCount"
--     ALTER COLUMN "expected" DROP DEFAULT,
--     ALTER COLUMN "expected" TYPE DOUBLE PRECISION USING "expected"::double precision;
--   ALTER TABLE "CashCount" ALTER COLUMN "expected" SET DEFAULT 0;
--   ALTER TABLE "CashCount"
--     ALTER COLUMN "difference" DROP DEFAULT,
--     ALTER COLUMN "difference" TYPE DOUBLE PRECISION USING "difference"::double precision;
--   ALTER TABLE "CashCount" ALTER COLUMN "difference" SET DEFAULT 0;
