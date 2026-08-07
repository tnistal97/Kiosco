-- Fase 3 -- Turnos de caja
--
-- `Branch.currentCash` era el efectivo acumulado desde que se instalo el
-- sistema, y el arqueo comparaba contra el. Eso no es un saldo de caja: es un
-- total historico. Un cajero que abre con $10.000 y cierra con $47.500 no
-- tenia forma de saber si cuadraba.
--
-- Ver docs/CASH_SHIFT_MODEL.md para el modelo completo y las reglas.
--
-- ADITIVA. Crea una tabla y agrega columnas opcionales; la version anterior
-- del codigo sigue funcionando --ignora `shiftId` y sigue leyendo
-- `currentCash`, que se sigue actualizando--.

-- 1) La tabla.
--
-- Las claves foraneas van con nombre y con acciones explicitas, iguales a las
-- que genera Prisma: RESTRICT al borrar cuando la relacion es obligatoria,
-- SET NULL cuando es opcional, CASCADE al actualizar. Sin eso, `migrate diff`
-- detecta deriva contra el esquema aunque las columnas sean identicas.
CREATE TABLE "CashShift" (
  "id"             SERIAL PRIMARY KEY,
  "branchId"       INTEGER NOT NULL,
  "openedById"     INTEGER NOT NULL,
  "closedById"     INTEGER,
  "openedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt"       TIMESTAMP(3),
  "openingAmount"  DECIMAL(14,2) NOT NULL,
  "expectedAmount" DECIMAL(14,2),
  "countedAmount"  DECIMAL(14,2),
  "difference"     DECIMAL(14,2),
  "status"         TEXT NOT NULL DEFAULT 'open',
  "openingNotes"   TEXT,
  "closingNotes"   TEXT,
  "authorizedById" INTEGER
);

ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_openedById_fkey"
  FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_closedById_fkey"
  FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_authorizedById_fkey"
  FOREIGN KEY ("authorizedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CashShift_branchId_openedAt_idx" ON "CashShift"("branchId", "openedAt");
CREATE INDEX "CashShift_branchId_status_idx"   ON "CashShift"("branchId", "status");

-- 2) Estados validos, y coherencia entre estado y campos de cierre.
--
-- La restriccion no es decorativa: impide que quede un turno "cerrado" sin
-- fecha de cierre ni monto contado, que es un estado que despues nadie sabe
-- interpretar.
ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_status_check"
  CHECK ("status" IN ('open', 'closed', 'legacy'));

ALTER TABLE "CashShift" ADD CONSTRAINT "CashShift_close_fields_check"
  CHECK (
    ("status" = 'open'
      AND "closedAt" IS NULL AND "closedById" IS NULL
      AND "countedAmount" IS NULL AND "difference" IS NULL)
    OR
    ("status" = 'closed'
      AND "closedAt" IS NOT NULL AND "closedById" IS NOT NULL
      AND "expectedAmount" IS NOT NULL AND "countedAmount" IS NOT NULL
      AND "difference" IS NOT NULL)
    OR
    -- El turno historico esta cerrado por fecha pero nunca se conto nada:
    -- afirmar una diferencia ahi seria inventarla.
    ("status" = 'legacy' AND "closedAt" IS NOT NULL AND "countedAmount" IS NULL)
  );

-- 3) Una sola caja abierta por sucursal, y una sola por usuario.
--
-- Va como indice unico PARCIAL y no como comprobacion en el servicio: dos
-- peticiones de apertura simultaneas pasarian las dos por un `SELECT ... IF
-- NOT EXISTS`. Aca una gana y la otra recibe violacion de unicidad, que el
-- servicio traduce a un 409 legible.
--
-- El de usuario hoy es redundante --un usuario pertenece a una sucursal-- pero
-- deja de serlo el dia que exista mas de una caja por local, y es una linea.
CREATE UNIQUE INDEX "CashShift_one_open_per_branch"
  ON "CashShift"("branchId") WHERE "status" = 'open';

CREATE UNIQUE INDEX "CashShift_one_open_per_user"
  ON "CashShift"("openedById") WHERE "status" = 'open';

-- 4) El vinculo desde lo que ya existia.
ALTER TABLE "CashRegisterMovement" ADD COLUMN "shiftId" INTEGER;
ALTER TABLE "CashCount"            ADD COLUMN "shiftId" INTEGER;

ALTER TABLE "CashRegisterMovement" ADD CONSTRAINT "CashRegisterMovement_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CashCount" ADD CONSTRAINT "CashCount_shiftId_fkey"
  FOREIGN KEY ("shiftId") REFERENCES "CashShift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "CashRegisterMovement_shiftId_paymentMethod_idx"
  ON "CashRegisterMovement"("shiftId", "paymentMethod");
CREATE INDEX "CashCount_shiftId_idx" ON "CashCount"("shiftId");

-- 5) Politica de caja, por sucursal.
ALTER TABLE "Branch" ADD COLUMN "requireOpenShift" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Branch" ADD COLUMN "cashDifferenceThreshold" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- 6) El turno LEGACY.
--
-- NO SE INVENTAN TURNOS HISTORICOS. No hay forma de saber en que turno ocurrio
-- una venta de marzo, y fabricar uno seria peor que no tenerlo.
--
-- Se crea UNO por sucursal que tenga movimientos, con estado 'legacy', y se le
-- cuelga todo lo anterior. Ese turno dice, sin disimulo: "aca esta todo lo que
-- paso antes de que existieran los turnos". Sin monto contado, porque no se
-- conto nada; sin diferencia, porque afirmarla seria inventarla.
--
-- `openedAt` es la fecha del movimiento mas viejo de esa sucursal, que es lo
-- unico verdadero que se puede decir. `openedById` es el usuario mas antiguo
-- de la sucursal: hace falta un responsable por la clave foranea, y elegir al
-- primero es menos arbitrario que elegir a cualquiera. Queda claro por el
-- estado que no es una afirmacion sobre quien abrio nada.
INSERT INTO "CashShift" (
  "branchId", "openedById", "openedAt", "closedAt",
  "openingAmount", "status", "openingNotes"
)
SELECT
  b."id",
  (SELECT u."id" FROM "User" u WHERE u."branchId" = b."id" ORDER BY u."id" LIMIT 1),
  COALESCE(
    (SELECT min(m."date") FROM "CashRegisterMovement" m WHERE m."branchId" = b."id"),
    b."createdAt"
  ),
  CURRENT_TIMESTAMP,
  0,
  'legacy',
  'Turno historico creado al migrar. Agrupa todo lo anterior a que existieran los turnos de caja; no se conto el cajon al abrirlo ni al cerrarlo.'
FROM "Branch" b
WHERE EXISTS (SELECT 1 FROM "User" u WHERE u."branchId" = b."id")
  AND (
    EXISTS (SELECT 1 FROM "CashRegisterMovement" m WHERE m."branchId" = b."id")
    OR EXISTS (SELECT 1 FROM "CashCount" c WHERE c."branchId" = b."id")
  );

UPDATE "CashRegisterMovement" m
   SET "shiftId" = s."id"
  FROM "CashShift" s
 WHERE s."branchId" = m."branchId" AND s."status" = 'legacy';

UPDATE "CashCount" c
   SET "shiftId" = s."id"
  FROM "CashShift" s
 WHERE s."branchId" = c."branchId" AND s."status" = 'legacy';

-- ---------------------------------------------------------------------------
-- DOWN (no se ejecuta; es lo unico que queda si hay que revertir a mano)
--
-- El orden importa: primero las columnas que referencian la tabla, despues la
-- tabla. Las dos columnas de politica de `Branch` se pueden dejar sin problema
-- --son aditivas y con valor por defecto-- pero se listan por completitud.
--
--   DROP INDEX IF EXISTS "CashRegisterMovement_shiftId_paymentMethod_idx";
--   DROP INDEX IF EXISTS "CashCount_shiftId_idx";
--   ALTER TABLE "CashRegisterMovement" DROP COLUMN "shiftId";
--   ALTER TABLE "CashCount" DROP COLUMN "shiftId";
--   ALTER TABLE "Branch" DROP COLUMN "requireOpenShift";
--   ALTER TABLE "Branch" DROP COLUMN "cashDifferenceThreshold";
--   DROP TABLE "CashShift";
--
-- Se pierden los turnos abiertos y cerrados desde la migracion. `currentCash`
-- sigue siendo correcto --nunca se dejo de actualizar-- asi que la caja vuelve
-- a funcionar como antes sin datos inconsistentes.
