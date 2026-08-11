-- =========================================================================
-- Fase 4C — Anticipos: la imputacion deja de ser irrepetible
--
-- Que hace:
--   1. Agrega "SupplierPaymentAllocation"."createdById" y lo rellena.
--   2. REEMPLAZA el indice unico (pago, recepcion) por uno comun.
--
-- Riesgo: BAJO. Agrega una columna con relleno determinista y AFLOJA una
-- restriccion. Aflojar no puede invalidar ningun dato existente: todo lo que
-- cumplia la regla vieja cumple la nueva.
--
-- Reversible: CON UNA CONDICION. Volver al indice unico exige que no haya
-- quedado ningun par repetido; si lo hay, hay que decidir que hacer con esas
-- filas antes. El rollback al pie lo comprueba y aborta si no se cumple.
--
-- POR QUE DEJA DE SER UNICO. La Fase 4B escribia TODAS las imputaciones de un
-- pago dentro de la transaccion de ese pago, de una sola vez. Con eso, el par
-- unico no estorbaba: nunca habia una segunda oportunidad de imputar.
--
-- La imputacion DIFERIDA de esta fase rompe ese supuesto. Un anticipo de
-- $50.000 cubre $30.000 de una entrega hoy; la semana que viene llega la nota
-- que faltaba y corresponde aplicarle los $20.000 restantes A LA MISMA ENTREGA.
-- Con el par unico esa segunda imputacion es IMPOSIBLE --y no hay salida,
-- porque una imputacion tampoco se edita--: el dinero queda varado, con la
-- entrega abierta y el pago con saldo disponible, sin forma de juntarlos.
--
-- Lo que se pierde: "cuanto le puso este pago a esta entrega" pasa a ser una
-- suma en vez de una fila. Es exactamente como este sistema contesta el saldo de
-- un proveedor (suma del libro) y el stock de un producto (suma de movimientos),
-- asi que no es una excepcion: es volver a la regla de la casa.
--
-- Lo que NO se pierde: cada fila sigue siendo un hecho inmutable, con su fecha,
-- su importe y --desde esta migracion-- su autor. El disparador de
-- inmutabilidad sigue en pie y no se toca. Ver
-- docs/SUPPLIER_PAYMENT_ALLOCATION.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. Quien imputo
--
-- Nace NULL para poder rellenarla, y termina NOT NULL. En la Fase 4B la
-- respuesta era siempre la misma persona que pago --no habia otro camino que
-- escribiera esta tabla-- asi que el relleno no es una suposicion: es el dato
-- exacto, leido del pago.
--
-- EL DISPARADOR DE INMUTABILIDAD HAY QUE APAGARLO PARA RELLENAR, y que haya
-- hecho falta es la prueba de que funciona: la Fase 4B prometio que ninguna
-- imputacion se actualiza nunca, y cuando esta migracion intento el UPDATE del
-- relleno, la base lo rechazo. Es el sistema defendiendose, no un obstaculo.
--
-- Se apaga y se vuelve a encender DENTRO de la misma transaccion de la
-- migracion, asi que no hay ningun instante en el que otra sesion pueda escribir
-- con la guardia baja. Y a diferencia de lo que hubo que hacer con el
-- vencimiento de una recepcion --donde una columna quedo editable para
-- siempre--, aca el disparador vuelve INTACTO: sigue rechazando todo, incluida
-- la columna nueva. Nada queda mas flojo de lo que estaba.
-- -------------------------------------------------------------------------
ALTER TABLE "SupplierPaymentAllocation" DISABLE TRIGGER "SupplierPaymentAllocation_inmutable";

ALTER TABLE "SupplierPaymentAllocation"
  ADD COLUMN "createdById" INTEGER;

UPDATE "SupplierPaymentAllocation" a
   SET "createdById" = p."paidById"
  FROM "SupplierPayment" p
 WHERE p."id" = a."paymentId"
   AND a."createdById" IS NULL;

ALTER TABLE "SupplierPaymentAllocation" ENABLE TRIGGER "SupplierPaymentAllocation_inmutable";

-- Si algo quedo sin rellenar, la migracion se detiene. Una imputacion sin autor
-- no puede existir y forzar un id por defecto seria atribuirle a alguien una
-- decision que no tomo.
DO $$
DECLARE huerfanas INTEGER;
BEGIN
  SELECT count(*) INTO huerfanas
    FROM "SupplierPaymentAllocation" WHERE "createdById" IS NULL;

  IF huerfanas > 0 THEN
    RAISE EXCEPTION
      'Quedaron % imputaciones sin autor. Cada una tiene que apuntar a un pago '
      'existente antes de continuar.', huerfanas;
  END IF;
END $$;

ALTER TABLE "SupplierPaymentAllocation"
  ALTER COLUMN "createdById" SET NOT NULL;

ALTER TABLE "SupplierPaymentAllocation"
  ADD CONSTRAINT "SupplierPaymentAllocation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SupplierPaymentAllocation_createdById_idx"
  ON "SupplierPaymentAllocation"("createdById");


-- -------------------------------------------------------------------------
-- 2. El par deja de ser unico
--
-- El indice se reemplaza, no se borra: "cuanto puso este pago" sigue siendo una
-- consulta del modulo --la usa el disponible de cada anticipo, que es la
-- pregunta central de esta fase-- y sin indice pasaria a recorrer la tabla.
--
-- El orden importa: primero el nuevo, despues el viejo. Al reves quedaria un
-- instante sin ningun indice por "paymentId", y aunque la transaccion de la
-- migracion lo hace invisible, el orden correcto no cuesta nada.
-- -------------------------------------------------------------------------
CREATE INDEX "SupplierPaymentAllocation_paymentId_idx"
  ON "SupplierPaymentAllocation"("paymentId");

DROP INDEX "SupplierPaymentAllocation_paymentId_receiptId_key";


-- -------------------------------------------------------------------------
-- 3. Comprobacion posterior
--
-- La regla que SI sigue en pie, y que es la que importaba de verdad: lo imputado
-- de un pago no puede superar su importe. El indice unico nunca garantizo eso
-- --dos filas contra entregas distintas siempre pudieron pasarse-- lo garantiza
-- el servicio, bajo bloqueo de fila, y lo comprueba la reconciliacion.
-- -------------------------------------------------------------------------
DO $$
DECLARE excedidos INTEGER;
BEGIN
  SELECT count(*) INTO excedidos FROM (
    SELECT a."paymentId"
      FROM "SupplierPaymentAllocation" a
      JOIN "SupplierPayment" p ON p."id" = a."paymentId"
     GROUP BY a."paymentId", p."amount"
    HAVING sum(a."amount") > p."amount"
  ) x;

  IF excedidos > 0 THEN
    RAISE EXCEPTION
      '% pagos tienen imputado mas que su importe. Revisar antes de continuar.',
      excedidos;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   -- Volver al par unico EXIGE que no haya repetidos. Esto aborta si los hay,
--   -- en vez de borrar filas: cual de las dos imputaciones sobra es una
--   -- decision de negocio, no de una migracion.
--   DO $$
--   DECLARE repetidos INTEGER;
--   BEGIN
--     SELECT count(*) INTO repetidos FROM (
--       SELECT "paymentId", "receiptId"
--         FROM "SupplierPaymentAllocation"
--        GROUP BY "paymentId", "receiptId"
--       HAVING count(*) > 1
--     ) x;
--     IF repetidos > 0 THEN
--       RAISE EXCEPTION
--         'Hay % pares (pago, entrega) con mas de una imputacion. Consolidarlos '
--         'a mano antes de restaurar el indice unico.', repetidos;
--     END IF;
--   END $$;
--
--   CREATE UNIQUE INDEX "SupplierPaymentAllocation_paymentId_receiptId_key"
--     ON "SupplierPaymentAllocation"("paymentId", "receiptId");
--   DROP INDEX "SupplierPaymentAllocation_paymentId_idx";
--
--   DROP INDEX "SupplierPaymentAllocation_createdById_idx";
--   ALTER TABLE "SupplierPaymentAllocation"
--     DROP CONSTRAINT "SupplierPaymentAllocation_createdById_fkey";
--   ALTER TABLE "SupplierPaymentAllocation" DROP COLUMN "createdById";
--
-- Que se pierde: quien imputo cada fila. Se puede reconstruir para las de la
-- Fase 4B --era quien pago-- y NO para las diferidas de la 4C, que es
-- justamente el dato que esta columna existe para guardar.
-- =========================================================================
