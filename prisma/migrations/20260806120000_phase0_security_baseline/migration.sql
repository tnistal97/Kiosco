-- =============================================================================
-- Fase 0 · Cambios minimos de esquema exigidos por las correcciones P0
-- =============================================================================
--
-- Migracion ADITIVA. No borra columnas, no borra filas, no cambia tipos.
-- Todas las columnas nuevas son NULL o traen DEFAULT, por lo que el codigo
-- anterior sigue funcionando sin modificaciones contra este esquema.
--
-- Motivo de cada cambio:
--
--   User.isActive        Requisito "verificar usuario activo". Hoy no existe
--                        forma de dar de baja a un empleado sin borrarlo, y
--                        borrarlo rompe las claves foraneas de ventas y caja.
--
--   User.sessionVersion  Requisito "revocacion o invalidacion de sesiones".
--                        El JWT es autocontenido y dura 1 dia: sin esto, un
--                        token robado sigue siendo valido aunque se cambie la
--                        contrasena. El token lleva la version con la que fue
--                        emitido y el servidor la compara en cada peticion.
--
--   Sale.status          Requisito "anulacion logica". Hoy anular una venta
--   Sale.canceledAt      la BORRA fisicamente junto con sus items, lo que
--   Sale.canceledById    destruye el registro financiero y lo saca de todos
--   Sale.cancelReason    los reportes historicos.
--
--   CashRegisterMovement.saleId
--                        Hoy la unica forma de saber a que venta corresponde
--                        un movimiento de caja es parsear la cadena
--                        "Venta #123" del campo description con una expresion
--                        regular. Si alguien edita la descripcion, la relacion
--                        se pierde. La anulacion atomica necesita esta relacion.
--
-- Compatibilidad hacia atras:
--   - Las filas existentes quedan con status = 'completed', que es lo que eran.
--   - isActive = true para todos los usuarios existentes.
--   - sessionVersion = 0; los tokens emitidos antes de esta migracion no
--     llevan el claim y son rechazados: hay que volver a iniciar sesion una vez.
--   - saleId se rellena a partir de la descripcion historica (ver mas abajo).
--
-- Reversibilidad: al final del archivo hay un bloque DOWN comentado.
-- =============================================================================

-- ── 1) Usuarios: baja logica y revocacion de sesiones ────────────────────────
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;

-- ── 2) Ventas: anulacion logica ──────────────────────────────────────────────
ALTER TABLE "Sale" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'completed';
ALTER TABLE "Sale" ADD COLUMN "canceledAt" TIMESTAMP(3);
ALTER TABLE "Sale" ADD COLUMN "canceledById" INTEGER;
ALTER TABLE "Sale" ADD COLUMN "cancelReason" TEXT;

ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_canceledById_fkey"
  FOREIGN KEY ("canceledById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Solo se aceptan estos dos estados. Si una version futura agrega otro,
-- debera reemplazar esta restriccion explicitamente.
ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_status_check"
  CHECK ("status" IN ('completed', 'canceled'));

-- Coherencia: una venta anulada tiene siempre fecha, responsable y motivo.
-- Una venta vigente no tiene ninguno de los tres.
ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_cancel_fields_check"
  CHECK (
    ("status" = 'completed'
      AND "canceledAt" IS NULL AND "canceledById" IS NULL AND "cancelReason" IS NULL)
    OR
    ("status" = 'canceled'
      AND "canceledAt" IS NOT NULL AND "canceledById" IS NOT NULL AND "cancelReason" IS NOT NULL)
  );

-- ── 3) Caja: vinculo explicito con la venta ──────────────────────────────────
ALTER TABLE "CashRegisterMovement" ADD COLUMN "saleId" INTEGER;

-- Rellenado historico. Recupera la relacion desde la descripcion "Venta #N"
-- que genera el codigo actual. Solo asigna el vinculo cuando la venta
-- referenciada existe de verdad, para no violar la clave foranea.
UPDATE "CashRegisterMovement" AS m
SET "saleId" = extraido.sale_id
FROM (
  SELECT
    "id",
    (substring("description" FROM '[Vv]enta[[:space:]]*#([0-9]+)'))::integer AS sale_id
  FROM "CashRegisterMovement"
  WHERE "description" ~ '[Vv]enta[[:space:]]*#[0-9]+'
) AS extraido
WHERE m."id" = extraido."id"
  AND extraido.sale_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Sale" s WHERE s."id" = extraido.sale_id);

ALTER TABLE "CashRegisterMovement"
  ADD CONSTRAINT "CashRegisterMovement_saleId_fkey"
  FOREIGN KEY ("saleId") REFERENCES "Sale"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4) Indices ───────────────────────────────────────────────────────────────
-- Las tres consultas mas frecuentes del sistema recorren la tabla entera hoy.
CREATE INDEX "CashRegisterMovement_saleId_idx"       ON "CashRegisterMovement"("saleId");
CREATE INDEX "CashRegisterMovement_branchId_date_idx" ON "CashRegisterMovement"("branchId", "date");
CREATE INDEX "Sale_branchId_date_idx"                 ON "Sale"("branchId", "date");
CREATE INDEX "Sale_status_idx"                        ON "Sale"("status");

-- =============================================================================
-- DOWN (no se ejecuta; queda documentado para poder revertir a mano)
-- =============================================================================
-- DROP INDEX "Sale_status_idx";
-- DROP INDEX "Sale_branchId_date_idx";
-- DROP INDEX "CashRegisterMovement_branchId_date_idx";
-- DROP INDEX "CashRegisterMovement_saleId_idx";
-- ALTER TABLE "CashRegisterMovement" DROP CONSTRAINT "CashRegisterMovement_saleId_fkey";
-- ALTER TABLE "CashRegisterMovement" DROP COLUMN "saleId";
-- ALTER TABLE "Sale" DROP CONSTRAINT "Sale_cancel_fields_check";
-- ALTER TABLE "Sale" DROP CONSTRAINT "Sale_status_check";
-- ALTER TABLE "Sale" DROP CONSTRAINT "Sale_canceledById_fkey";
-- ALTER TABLE "Sale" DROP COLUMN "cancelReason";
-- ALTER TABLE "Sale" DROP COLUMN "canceledById";
-- ALTER TABLE "Sale" DROP COLUMN "canceledAt";
-- ALTER TABLE "Sale" DROP COLUMN "status";
-- ALTER TABLE "User" DROP COLUMN "sessionVersion";
-- ALTER TABLE "User" DROP COLUMN "isActive";
