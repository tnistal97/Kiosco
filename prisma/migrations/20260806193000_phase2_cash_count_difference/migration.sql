-- Fase 2 — el arqueo guarda lo esperado y la diferencia
--
-- Aditiva. No borra, no renombra y no cambia el tipo de nada.
--
-- Hasta ahora el servidor calculaba las dos cifras y las metia dentro de
-- `notes` como una frase:
--
--   "Faltan 1.200 | Esperado: 97200. Contado: 96000. Diferencia: -1200."
--
-- Con eso no se puede preguntar "arqueos con diferencia" sin leer texto, y la
-- pantalla de caja no tenia forma de mostrar la columna. Pasan a ser columnas.

-- 1) Las columnas. `DEFAULT 0` para que las filas existentes sean validas.
ALTER TABLE "CashCount"
  ADD COLUMN IF NOT EXISTS "expected" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "CashCount"
  ADD COLUMN IF NOT EXISTS "difference" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- 2) Relleno de lo que ya existe, leyendo la frase que escribia el servidor.
--
--    Solo se tocan las filas cuyo texto encaja exactamente con el formato
--    conocido. Una nota escrita a mano por alguien queda en 0, que es
--    honesto: es preferible un cero visible a un numero inventado.
UPDATE "CashCount"
SET
  "expected" = COALESCE(
    NULLIF(substring("notes" FROM 'Esperado: (-?[0-9]+(?:\.[0-9]+)?)'), '')::DOUBLE PRECISION,
    0
  ),
  "difference" = COALESCE(
    NULLIF(substring("notes" FROM 'Diferencia: (-?[0-9]+(?:\.[0-9]+)?)'), '')::DOUBLE PRECISION,
    0
  )
WHERE "notes" ~ 'Esperado: -?[0-9]';

-- 3) Indice para el listado por sucursal y fecha, que es como se consulta.
CREATE INDEX IF NOT EXISTS "CashCount_branchId_date_idx"
  ON "CashCount" ("branchId", "date");

-- Para revertir:
--
--   DROP INDEX IF EXISTS "CashCount_branchId_date_idx";
--   ALTER TABLE "CashCount" DROP COLUMN IF EXISTS "difference";
--   ALTER TABLE "CashCount" DROP COLUMN IF EXISTS "expected";
--
-- No se pierde ningun arqueo: la frase sigue en `notes`.
