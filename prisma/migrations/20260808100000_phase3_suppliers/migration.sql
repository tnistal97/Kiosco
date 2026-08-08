-- =========================================================================
-- Fase 3C — Proveedores y vinculo producto/proveedor
--
-- Que hace:
--   1. Completa "Supplier" con los datos que hacen falta para comprarle.
--   2. Crea "ProductSupplier": varios proveedores por producto, uno principal.
--   3. Copia cada "Product"."supplierId" existente como proveedor principal.
--
-- Riesgo: BAJO. Es ADITIVA. No borra ni una columna ni una fila.
--
-- Reversible: SI. Ver el ROLLBACK al final.
--
-- Ver docs/SUPPLIER_MODEL.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Los datos del proveedor
--
-- TODOS opcionales menos el nombre, que ya existia. Es la decision central del
-- modelo: un almacen de barrio conoce "Distribuidora Pepe" y un telefono, y
-- eso tiene que ser un proveedor valido. Exigir CUIT o direccion obligaria a
-- inventarlos, y un dato inventado es peor que un dato ausente porque parece
-- verdadero.
--
-- `taxId` y no `cuit`: el modelo no se ata a un pais. La pantalla si dice
-- "CUIT", que es como se llama para quien la usa.
-- -------------------------------------------------------------------------
ALTER TABLE "Supplier" ADD COLUMN "legalName"   TEXT;
ALTER TABLE "Supplier" ADD COLUMN "taxId"       TEXT;
ALTER TABLE "Supplier" ADD COLUMN "phone"       TEXT;
ALTER TABLE "Supplier" ADD COLUMN "email"       TEXT;
ALTER TABLE "Supplier" ADD COLUMN "address"     TEXT;
ALTER TABLE "Supplier" ADD COLUMN "contactName" TEXT;
ALTER TABLE "Supplier" ADD COLUMN "notes"       TEXT;

-- Baja logica. Un proveedor con historial no se borra nunca: hay ordenes y
-- recepciones que lo referencian.
ALTER TABLE "Supplier"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Supplier"
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- `updatedAt` entra en tres pasos y no en uno.
--
-- `ADD COLUMN ... NOT NULL` sin valor falla sobre una tabla con filas, y
-- `ADD COLUMN ... NOT NULL DEFAULT now()` dejaria un DEFAULT que Prisma no
-- declara para `@updatedAt` y que apareceria como deriva en cada `migrate
-- diff`. Nulo, relleno, y recien despues obligatorio.
ALTER TABLE "Supplier" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "Supplier" SET "updatedAt" = CURRENT_TIMESTAMP WHERE "updatedAt" IS NULL;
ALTER TABLE "Supplier" ALTER COLUMN "updatedAt" SET NOT NULL;

-- Un nombre en blanco no identifica a nadie. El tope es generoso: hay razones
-- sociales largas, y cortarlas obligaria a abreviar el nombre legal.
ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_name_check"
  CHECK (length(btrim("name")) BETWEEN 1 AND 200);

-- El correo se comprueba SI VIENE. La expresion es deliberadamente laxa
-- --algo, arroba, algo, punto, algo-- porque la validacion estricta de una
-- direccion de correo rechaza direcciones validas y no atrapa las que no
-- existen. Quien decide de verdad es el mensaje que rebota.
ALTER TABLE "Supplier"
  ADD CONSTRAINT "Supplier_email_check"
  CHECK ("email" IS NULL OR "email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- El listado filtra por activo y ordena por nombre.
CREATE INDEX "Supplier_isActive_name_idx" ON "Supplier"("isActive", "name");


-- -------------------------------------------------------------------------
-- 2. `contact` se jubila
--
-- Era un texto libre donde convivian un nombre de persona, un telefono, o las
-- dos cosas separadas por una barra. Se copia TAL CUAL a `contactName`, sin
-- intentar partirlo: no hay forma confiable de saber cual de las dos cosas es,
-- y adivinar mal convertiria un telefono en el nombre de alguien.
--
-- La columna NO se borra en esta migracion. Regla 2 de
-- docs/DATABASE_MIGRATION_STRATEGY.md: primero deja de escribirse, se
-- despliega, y recien despues se borra. Muere en la Fase 3D.
-- -------------------------------------------------------------------------
UPDATE "Supplier"
   SET "contactName" = btrim("contact")
 WHERE "contact" IS NOT NULL
   AND btrim("contact") <> ''
   AND "contactName" IS NULL;


-- -------------------------------------------------------------------------
-- 3. ProductSupplier
--
-- La misma gaseosa se le compra a quien la tenga esa semana. `Product`.
-- `supplierId` no podia decir eso: un producto, un proveedor, para siempre.
-- -------------------------------------------------------------------------
CREATE TABLE "ProductSupplier" (
  "id"           SERIAL        NOT NULL,
  "productId"    INTEGER       NOT NULL,
  "supplierId"   INTEGER       NOT NULL,
  "supplierCode" TEXT,
  "lastCost"     NUMERIC(14,4),
  "isPreferred"  BOOLEAN       NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3)  NOT NULL,

  CONSTRAINT "ProductSupplier_pkey" PRIMARY KEY ("id")
);

-- Un costo negativo no existe. Cero si: hay mercaderia que entra bonificada.
ALTER TABLE "ProductSupplier"
  ADD CONSTRAINT "ProductSupplier_lastCost_check"
  CHECK ("lastCost" IS NULL OR "lastCost" >= 0);

-- Un codigo de proveedor en blanco es lo mismo que no tenerlo.
ALTER TABLE "ProductSupplier"
  ADD CONSTRAINT "ProductSupplier_supplierCode_check"
  CHECK ("supplierCode" IS NULL OR length(btrim("supplierCode")) BETWEEN 1 AND 64);

-- Un proveedor aparece UNA vez por producto. Dos filas del mismo par serian
-- dos ultimos costos distintos para la misma relacion.
CREATE UNIQUE INDEX "ProductSupplier_productId_supplierId_key"
  ON "ProductSupplier"("productId", "supplierId");

-- Un producto tiene UN proveedor principal.
--
-- Indice unico PARCIAL, el mismo mecanismo que resuelve el codigo de barras
-- principal: permite todos los alternativos que haga falta sin aflojar la
-- unicidad del preferido. Un unico compuesto sobre ("productId","isPreferred")
-- no serviria --admitiria un solo alternativo por producto--.
CREATE UNIQUE INDEX "ProductSupplier_principal_unico"
  ON "ProductSupplier"("productId")
  WHERE "isPreferred";

CREATE INDEX "ProductSupplier_supplierId_idx" ON "ProductSupplier"("supplierId");

-- CASCADE sobre el producto: el vinculo es un atributo, no historia. Sin el
-- producto no significa nada, y conservarlo impediria borrar un producto
-- cargado por error.
--
-- RESTRICT sobre el proveedor: uno con productos asociados no se borra, se
-- desactiva.
ALTER TABLE "ProductSupplier"
  ADD CONSTRAINT "ProductSupplier_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ProductSupplier"
  ADD CONSTRAINT "ProductSupplier_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;


-- -------------------------------------------------------------------------
-- 4. Migracion de los vinculos existentes
--
-- Cada `Product.supplierId` no nulo se convierte en el proveedor PRINCIPAL de
-- su producto. `lastCost` arranca en `Product.cost`, que es lo mas cercano a
-- un costo conocido que hay --y es NULL en todo el catalogo migrado, que es la
-- respuesta honesta--. `supplierCode` arranca nulo: ese dato no existe en
-- ninguna parte y no se inventa.
--
-- Idempotente por el ON CONFLICT: correr la migracion dos veces sobre la misma
-- base no duplica nada.
-- -------------------------------------------------------------------------
INSERT INTO "ProductSupplier" ("productId", "supplierId", "lastCost", "isPreferred", "createdAt", "updatedAt")
SELECT p."id", p."supplierId", p."cost", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM "Product" p
 WHERE p."supplierId" IS NOT NULL
ON CONFLICT ("productId", "supplierId") DO NOTHING;


-- -------------------------------------------------------------------------
-- 5. Comprobacion: no se perdio ningun vinculo
--
-- Si algo quedo afuera, la migracion ABORTA con el nombre de los productos
-- afectados. Un vinculo perdido no es un detalle: significa que un producto
-- deja de saber a quien comprarle.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  perdidos INTEGER;
  cuales   TEXT;
BEGIN
  SELECT count(*), string_agg(p."name", ', ' ORDER BY p."name")
    INTO perdidos, cuales
    FROM "Product" p
   WHERE p."supplierId" IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM "ProductSupplier" ps
        WHERE ps."productId" = p."id" AND ps."supplierId" = p."supplierId"
     );

  IF perdidos > 0 THEN
    RAISE EXCEPTION
      'Migracion abortada: % producto(s) perdieron su proveedor: %',
      perdidos, cuales;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- DROP TABLE "ProductSupplier";
-- DROP INDEX "Supplier_isActive_name_idx";
-- ALTER TABLE "Supplier" DROP CONSTRAINT "Supplier_email_check";
-- ALTER TABLE "Supplier" DROP CONSTRAINT "Supplier_name_check";
-- ALTER TABLE "Supplier"
--   DROP COLUMN "updatedAt", DROP COLUMN "createdAt", DROP COLUMN "isActive",
--   DROP COLUMN "notes", DROP COLUMN "contactName", DROP COLUMN "address",
--   DROP COLUMN "email", DROP COLUMN "phone", DROP COLUMN "taxId",
--   DROP COLUMN "legalName";
--
-- Que se pierde: los datos de contacto cargados despues de esta migracion, y
-- los vinculos producto/proveedor que NO vengan de `Product.supplierId` --es
-- decir, todos los proveedores alternativos--. `Product.supplierId` sigue
-- intacta, asi que el vinculo principal original sobrevive.
--
-- Exportar antes:
--   SELECT * FROM "ProductSupplier" ORDER BY "productId";
--   SELECT "id","name","legalName","taxId","phone","email","address",
--          "contactName","notes","isActive" FROM "Supplier" ORDER BY "id";
-- =========================================================================
