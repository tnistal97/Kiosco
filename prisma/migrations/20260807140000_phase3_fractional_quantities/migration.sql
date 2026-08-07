-- =========================================================================
-- Fase 3B — Cantidades fraccionadas
--
-- Que hace:
--   Convierte las seis columnas de cantidad de INTEGER a NUMERIC(14,3).
--
-- Por que NUMERIC y no DOUBLE PRECISION: la Fase 3A dejo escrito en la base
--
--   CHECK ("resultingQuantity" = "previousQuantity" + "quantity")
--
-- y en punto flotante `0.1 + 0.2` da `0.30000000000000004`. Un ajuste de 100 g
-- sobre un saldo de 200 g no produciria un numero feo: produciria una fila que
-- PostgreSQL RECHAZA. La restriccion no es un adorno; es lo que hace que el
-- libro signifique algo.
--
-- Riesgo: MEDIO. Es la segunda migracion NO ADITIVA del proyecto, despues de
-- la del dinero. Cambia el tipo de columnas con datos.
--
-- A favor: INTEGER -> NUMERIC es una AMPLIACION. Todo entero es un decimal
-- exacto, ninguna fila puede fallar la conversion y ningun valor cambia. Por
-- eso no hay comprobacion previa de rango: no hay nada que comprobar.
--
-- En contra: el codigo anterior recibe un objeto Decimal donde espera un
-- number, y `24 + 1` sobre un objeto da la cadena "241". No revienta: calcula
-- mal. Por eso el orden de despliegue es CODIGO PRIMERO, migracion despues.
--
-- Reversible: SI en estructura, NO en informacion. Ver el ROLLBACK al final.
--
-- Ver docs/PHASE3_QUANTITY_MIGRATION.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. El saldo de stock
--
-- `BranchStock`.`quantity` es el saldo materializado del libro. Es la columna
-- que decide si una venta entra o no, asi que es la primera.
-- -------------------------------------------------------------------------
ALTER TABLE "BranchStock"
  ALTER COLUMN "quantity" TYPE NUMERIC(14,3) USING "quantity"::numeric(14,3);


-- -------------------------------------------------------------------------
-- 2. El libro
--
-- Las tres columnas van en un solo ALTER TABLE: PostgreSQL reescribe la tabla
-- una vez en vez de tres, y las tres restricciones CHECK se revalidan juntas
-- contra el estado final. Separarlas obligaria a que cada paso intermedio
-- cumpliera `resultingQuantity = previousQuantity + quantity` con tipos
-- mezclados, que es cierto pero innecesariamente delicado.
--
-- El disparador de inmutabilidad NO estorba: es `FOR EACH ROW BEFORE UPDATE`,
-- y la reescritura de tabla de un ALTER TYPE no dispara disparadores de fila.
-- Es DDL, no un UPDATE. Hay una prueba que lo comprueba, porque de este
-- detalle depende que la migracion se pueda aplicar.
-- -------------------------------------------------------------------------
ALTER TABLE "StockMovement"
  ALTER COLUMN "quantity"          TYPE NUMERIC(14,3) USING "quantity"::numeric(14,3),
  ALTER COLUMN "previousQuantity"  TYPE NUMERIC(14,3) USING "previousQuantity"::numeric(14,3),
  ALTER COLUMN "resultingQuantity" TYPE NUMERIC(14,3) USING "resultingQuantity"::numeric(14,3);


-- -------------------------------------------------------------------------
-- 3. Las lineas de venta
--
-- La tabla mas grande de las cuatro. Sigue siendo cuestion de segundos con
-- decenas de miles de filas, pero es la que justifica la ventana de
-- mantenimiento.
-- -------------------------------------------------------------------------
ALTER TABLE "SaleItem"
  ALTER COLUMN "quantity" TYPE NUMERIC(14,3) USING "quantity"::numeric(14,3);


-- -------------------------------------------------------------------------
-- 4. El minimo de reposicion
--
-- Se convierte por la misma razon que el resto: `stock <= minimo` tiene que
-- comparar dos numeros del mismo tipo y en la misma unidad. Un minimo de
-- 3,5 kg de queso no se puede expresar con un entero.
--
-- El DEFAULT se vuelve a declarar explicitamente. PostgreSQL lo conserva al
-- cambiar el tipo, pero dejarlo escrito evita que un `migrate diff` lo reporte
-- como deriva si en algun momento cambia la forma en que Prisma lo genera.
-- -------------------------------------------------------------------------
ALTER TABLE "Product"
  ALTER COLUMN "minimumStock" TYPE NUMERIC(14,3) USING "minimumStock"::numeric(14,3);

ALTER TABLE "Product"
  ALTER COLUMN "minimumStock" SET DEFAULT 0;


-- -------------------------------------------------------------------------
-- 5. Comprobacion posterior
--
-- Dos cosas que tienen que seguir siendo ciertas despues de convertir:
--
--   a) el libro cuadra con el saldo, producto por producto;
--   b) ninguna cantidad cambio de valor.
--
-- La (b) se comprueba de la unica forma que queda despues de un ALTER: que
-- toda cantidad siga siendo un entero exacto. Antes de esta migracion no
-- existia ninguna fraccionada, asi que cualquier residuo decimal seria un
-- daño introducido por la conversion.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  descuadres integer;
  rotas      integer;
BEGIN
  SELECT count(*) INTO descuadres
    FROM "BranchStock" bs
    LEFT JOIN (
      SELECT "branchId", "productId", sum("quantity") AS total
        FROM "StockMovement"
       GROUP BY "branchId", "productId"
    ) sm ON sm."branchId" = bs."branchId" AND sm."productId" = bs."productId"
   WHERE bs."quantity" <> COALESCE(sm.total, 0);

  IF descuadres > 0 THEN
    RAISE EXCEPTION
      'El libro de inventario dejo de cuadrar en % producto(s) al convertir a '
      'decimal. No se aplica la migracion.', descuadres;
  END IF;

  SELECT count(*) INTO rotas
    FROM "BranchStock"
   WHERE "quantity" <> trunc("quantity");

  IF rotas > 0 THEN
    RAISE EXCEPTION
      'La conversion dejo % saldo(s) con parte decimal, y antes de esta '
      'migracion no existia ninguna cantidad fraccionada. Algo se corrompio.',
      rotas;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- ALTER TABLE "BranchStock"
--   ALTER COLUMN "quantity" TYPE INTEGER USING round("quantity")::integer;
--
-- ALTER TABLE "StockMovement"
--   ALTER COLUMN "quantity"          TYPE INTEGER USING round("quantity")::integer,
--   ALTER COLUMN "previousQuantity"  TYPE INTEGER USING round("previousQuantity")::integer,
--   ALTER COLUMN "resultingQuantity" TYPE INTEGER USING round("resultingQuantity")::integer;
--
-- ALTER TABLE "SaleItem"
--   ALTER COLUMN "quantity" TYPE INTEGER USING round("quantity")::integer;
--
-- ALTER TABLE "Product"
--   ALTER COLUMN "minimumStock" TYPE INTEGER USING round("minimumStock")::integer;
-- ALTER TABLE "Product" ALTER COLUMN "minimumStock" SET DEFAULT 0;
--
-- ADVERTENCIA — acá SÍ hay pérdida, al revés que en la ida.
--
-- Volver a INTEGER redondea toda cantidad fraccionada: 0,425 kg de queso pasa
-- a ser 0 kg. Si para cuando se revierta ya se vendio mercaderia por peso, esa
-- informacion NO ESTA EN NINGUN OTRO LADO, y ademas el redondeo puede romper
-- la restriccion `resultingQuantity = previousQuantity + quantity`, con lo que
-- el ALTER fallaria a mitad de camino.
--
-- Este bloque es una salida de emergencia estructural, no un boton de deshacer.
-- La vuelta atras buena es restaurar el respaldo previo.
-- =========================================================================
