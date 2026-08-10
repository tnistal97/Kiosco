-- =========================================================================
-- Fase 4A — Clientes
--
-- Que hace:
--   1. Crea "Client" con sus restricciones, claves e indices.
--
-- Riesgo: BAJO. Es ADITIVA. Crea una tabla nueva y no toca ninguna existente.
-- Todo el codigo anterior sigue funcionando sin enterarse de que existe.
--
-- Reversible: SI, sin perdida, MIENTRAS no haya clientes cargados. Un DROP
-- posterior a la carga se lleva los clientes, que son informacion nueva y no
-- una copia de algo que ya existiera.
--
-- Ver docs/CUSTOMER_MODEL.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La tabla
--
-- Lo UNICO obligatorio es el nombre. Es la misma decision que en "Supplier":
-- un almacen conoce "Juan el del kiosco" y un telefono, y eso tiene que ser un
-- cliente valido. Exigir DNI obligaria a inventarlo, y un documento inventado
-- es peor que ninguno porque parece un dato.
-- -------------------------------------------------------------------------
CREATE TABLE "Client" (
  "id"              SERIAL       NOT NULL,
  "branchId"        INTEGER      NOT NULL,
  "name"            TEXT         NOT NULL,
  "document"        TEXT,
  "taxId"           TEXT,
  "phone"           TEXT,
  "email"           TEXT,
  "address"         TEXT,
  "notes"           TEXT,
  "isActive"        BOOLEAN      NOT NULL DEFAULT true,

  -- NULL = sin limite configurado. 0 = no se le fia. Ver el CHECK de abajo:
  -- lo unico prohibido es un limite negativo.
  "creditLimit"     NUMERIC(14,2),

  "isCreditEnabled" BOOLEAN      NOT NULL DEFAULT true,

  -- Saldo materializado del libro. Positivo = debe. Arranca en cero para
  -- TODOS: el sistema anterior no tenia cuenta corriente, asi que no hay
  -- deuda historica que migrar y no se inventa ninguna. Ver el objetivo 27.
  "balance"         NUMERIC(14,2) NOT NULL DEFAULT 0,

  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- El nombre no puede quedar vacio ni ser solo espacios. Es lo unico que se
-- pide, asi que tiene que significar algo: un cliente llamado "" no se puede
-- buscar, no se puede mostrar y no se puede reclamar.
ALTER TABLE "Client"
  ADD CONSTRAINT "Client_nombre_check"
  CHECK (length(btrim("name")) > 0);

-- Un limite negativo no significa nada. Cero si: "no se le fia".
ALTER TABLE "Client"
  ADD CONSTRAINT "Client_limite_check"
  CHECK ("creditLimit" IS NULL OR "creditLimit" >= 0);


-- -------------------------------------------------------------------------
-- 2. Claves foraneas
--
-- Escritas a mano con nombre y acciones explicitas para que coincidan con lo
-- que genera Prisma. Un REFERENCES en linea produce NO ACTION en vez de
-- RESTRICT/CASCADE, y `prisma migrate diff` lo reporta como deriva.
-- -------------------------------------------------------------------------
ALTER TABLE "Client"
  ADD CONSTRAINT "Client_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "Branch"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 3. Indices
--
-- Uno por consulta real de la pantalla de clientes:
--
--   listado y busqueda por nombre       (branchId, isActive, name)
--   "con deuda" / "con saldo a favor"   (branchId, balance)
--   busqueda por telefono y documento   (branchId, phone) / (branchId, document)
--
-- La busqueda por NOMBRE parcial (`ILIKE '%pere%'`) NO usa el indice de arriba:
-- ningun btree sirve para un comodin a la izquierda. Se midio con 10.000
-- clientes antes de decidir --ver docs/CUSTOMER_MODEL.md, seccion de
-- rendimiento-- y a ese volumen el recorrido secuencial tarda menos que lo que
-- cuesta mantener un indice de trigramas. El dia que un comercio tenga cien mil
-- clientes, la respuesta es `pg_trgm` con un indice GIN, y esta escrito donde
-- corresponde para no tener que volver a averiguarlo.
-- -------------------------------------------------------------------------
CREATE INDEX "Client_branchId_isActive_name_idx" ON "Client"("branchId", "isActive", "name");
CREATE INDEX "Client_branchId_balance_idx"       ON "Client"("branchId", "balance");
CREATE INDEX "Client_branchId_phone_idx"         ON "Client"("branchId", "phone");
CREATE INDEX "Client_branchId_document_idx"      ON "Client"("branchId", "document");


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP TABLE "Client";
--
-- Advertencia: se lleva los clientes cargados. No hay de donde reconstruirlos,
-- porque el sistema anterior no los tenia. Exportar antes:
--   \copy (SELECT * FROM "Client") TO 'clientes.csv' CSV HEADER
--
-- Tiene que ejecutarse DESPUES del rollback de phase4_customer_accounts,
-- phase4_customer_payments y phase4_sale_client, que la referencian.
-- =========================================================================
