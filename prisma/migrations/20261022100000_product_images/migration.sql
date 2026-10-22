-- =============================================================================
-- Fotos de productos
--
-- Que hace: crea "ProductImage", una foto como mucho por producto, guardada en
-- la base como una miniatura WebP.
--
-- Por que en la base y no en el disco: son pocas y chicas (480 px, entre 10 y
-- 40 kB cada una), el respaldo de la base ya las incluye y la restauracion las
-- trae junto con su producto, y no hay una carpeta mas que crear en el
-- servidor, permisos que ajustar ni archivos huerfanos que limpiar.
--
-- Por que una tabla aparte y no una columna de "Product": el listado y la
-- caja leen el producto en cada tecla, y no tienen por que arrastrar los
-- bytes. Leen solo la huella, que es la version de la foto, y la leen de
-- "Product"."imageSha256": un disparador la copia ahi, asi el lector de
-- codigos no paga una consulta mas por un dato que ni muestra.
--
-- Aditiva: una tabla nueva que nadie referencia y una columna que admite
-- null. La version anterior del codigo sigue funcionando (no las lee) y la
-- vuelta atras es volver a desplegar, sin tocar la base.
-- Ver docs/PRODUCT_IMAGES.md.
-- =============================================================================

CREATE TABLE "ProductImage" (
    "productId" INTEGER      NOT NULL,
    "mimeType"  TEXT         NOT NULL,
    "data"      BYTEA        NOT NULL,
    "width"     INTEGER      NOT NULL,
    "height"    INTEGER      NOT NULL,
    "sha256"    CHAR(64)     NOT NULL,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("productId")
);

-- El servidor vuelve a codificar toda foto que recibe: lo que se guarda es
-- siempre WebP, chico, y de un tamano que la pantalla puede mostrar. Una fila
-- que no cumple no la escribio la aplicacion, y es mejor que no entre.
ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_mimeType_check" CHECK ("mimeType" = 'image/webp');

ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_data_check" CHECK (octet_length("data") BETWEEN 1 AND 1048576);

ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_size_check"
  CHECK ("width" BETWEEN 1 AND 1024 AND "height" BETWEEN 1 AND 1024);

-- La huella viaja en la direccion de la foto: tiene que ser hexadecimal tal
-- cual, sin mayusculas que la vuelvan otra direccion para la misma foto.
ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

-- De donde salio, si salio de internet. Solo https: es un enlace que alguien
-- va a abrir para comprobar que la foto es la del producto.
ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_sourceUrl_check"
  CHECK ("sourceUrl" IS NULL OR ("sourceUrl" ~ '^https://' AND length("sourceUrl") <= 2048));

-- CASCADE, como los codigos de barras: una foto no es historia, es un
-- atributo. Sin el producto no significa nada, y conservarla impediria borrar
-- un producto cargado por error.
ALTER TABLE "ProductImage"
  ADD CONSTRAINT "ProductImage_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -------------------------------------------------------------------------
-- La version de la foto, en el producto
--
-- La escribe SOLO este disparador: cualquier alta, cambio o baja de una foto
-- --desde la aplicacion, un guion o un psql a mano-- la deja al dia en la
-- misma transaccion. Que la aplicacion tambien la escribiera seria tener dos
-- lugares que se pueden contradecir.
--
-- AFTER y no BEFORE: cuando se borra un producto, su foto se va en cascada y
-- este disparador corre sobre un producto que ya no esta; el UPDATE no
-- encuentra la fila y no hace nada, que es lo correcto.
--
-- TRUNCATE no dispara disparadores de fila: el reinicio de la base de
-- pruebas vacia las dos tablas a la vez y no deja nada desfasado.
-- -------------------------------------------------------------------------
ALTER TABLE "Product" ADD COLUMN "imageSha256" CHAR(64);

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_imageSha256_check"
  CHECK ("imageSha256" IS NULL OR "imageSha256" ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION "product_image_version"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE "Product" SET "imageSha256" = NULL WHERE "id" = OLD."productId";
    RETURN OLD;
  END IF;
  -- La foto se paso a otro producto: el anterior se queda sin ella.
  IF TG_OP = 'UPDATE' AND OLD."productId" <> NEW."productId" THEN
    UPDATE "Product" SET "imageSha256" = NULL WHERE "id" = OLD."productId";
  END IF;
  UPDATE "Product" SET "imageSha256" = NEW."sha256" WHERE "id" = NEW."productId";
  RETURN NEW;
END $$;

CREATE TRIGGER "ProductImage_version_en_producto"
  AFTER INSERT OR UPDATE OR DELETE ON "ProductImage"
  FOR EACH ROW EXECUTE FUNCTION "product_image_version"();

-- DOWN (manual, no lo ejecuta Prisma; borra las fotos cargadas):
-- DROP TRIGGER "ProductImage_version_en_producto" ON "ProductImage";
-- DROP FUNCTION "product_image_version"();
-- ALTER TABLE "Product" DROP CONSTRAINT "Product_imageSha256_check";
-- ALTER TABLE "Product" DROP COLUMN "imageSha256";
-- DROP TABLE "ProductImage";
