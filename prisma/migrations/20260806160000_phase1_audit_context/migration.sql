-- Fase 1 · Contexto de auditoria
--
-- Aditiva y reversible. No borra columnas, no borra filas, no cambia tipos.
-- Todas las columnas nuevas admiten null o traen valor por defecto, asi que
-- las filas historicas siguen siendo validas sin tocarlas.
--
-- Motivo: la bitacora registraba quien, que y cuando, pero no en que
-- sucursal, ni con que peticion, ni desde donde, ni si la operacion termino
-- bien. Con una sola sucursal eso todavia se podia deducir; con dos, no.

-- ---------------------------------------------------------------- columnas

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "branchId"  INTEGER;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "requestId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "ip"        VARCHAR(45);
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "reason"    TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "result"    TEXT NOT NULL DEFAULT 'success';

-- Solo dos valores. Un CHECK y no un enum: agregar un valor a un enum de
-- PostgreSQL exige ALTER TYPE, que no se puede ejecutar dentro de una
-- transaccion en todas las versiones.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_result_check'
  ) THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_result_check"
      CHECK ("result" IN ('success', 'failure'));
  END IF;
END $$;

-- --------------------------------------------------------------- relaciones

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AuditLog_branchId_fkey'
  ) THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ------------------------------------------------------------------ relleno
--
-- La sucursal historica se toma de la del usuario que hizo el cambio. Es una
-- aproximacion: si alguien fue trasladado despues, sus entradas viejas
-- quedan con la sucursal actual. Se acepta porque hoy hay una sola sucursal
-- y ningun traslado; de aqui en adelante el valor lo escribe la aplicacion
-- con la sucursal real del evento.

UPDATE "AuditLog" a
SET "branchId" = u."branchId"
FROM "User" u
WHERE a."userId" = u."id"
  AND a."branchId" IS NULL;

-- Motivo: hasta ahora se guardaba dentro de changes.after.motivo.
UPDATE "AuditLog"
SET "reason" = "changes" -> 'after' ->> 'motivo'
WHERE "reason" IS NULL
  AND "changes" -> 'after' ->> 'motivo' IS NOT NULL;

-- Los intentos de login fallidos ya se registraban con esa accion.
UPDATE "AuditLog"
SET "result" = 'failure'
WHERE "actionType" = 'login_failed';

-- ------------------------------------------------------------------ indices

CREATE INDEX IF NOT EXISTS "AuditLog_branchId_timestamp_idx"
  ON "AuditLog" ("branchId", "timestamp");

CREATE INDEX IF NOT EXISTS "AuditLog_tableName_actionType_timestamp_idx"
  ON "AuditLog" ("tableName", "actionType", "timestamp");

CREATE INDEX IF NOT EXISTS "AuditLog_requestId_idx"
  ON "AuditLog" ("requestId");

-- ---------------------------------------------------------------------------
-- DOWN (no lo ejecuta Prisma; queda documentado para una vuelta atras manual)
-- ---------------------------------------------------------------------------
--
-- DROP INDEX IF EXISTS "AuditLog_requestId_idx";
-- DROP INDEX IF EXISTS "AuditLog_tableName_actionType_timestamp_idx";
-- DROP INDEX IF EXISTS "AuditLog_branchId_timestamp_idx";
-- ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_branchId_fkey";
-- ALTER TABLE "AuditLog" DROP CONSTRAINT IF EXISTS "AuditLog_result_check";
-- ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "result";
-- ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "reason";
-- ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "ip";
-- ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "requestId";
-- ALTER TABLE "AuditLog" DROP COLUMN IF EXISTS "branchId";
