-- =========================================================================
-- Fase 4B — La recepcion pasa a ser una obligacion
--
-- Que hace:
--   1. Agrega "PurchaseReceipt"."total": lo que ESA entrega costo de verdad.
--   2. Lo RECALCULA para las recepciones que ya existian, desde sus lineas.
--   3. Agrega "PurchaseReceipt"."dueDate": cuando vence la obligacion.
--   4. Agrega "PurchaseReceipt"."debtRecorded": si entro al libro del proveedor.
--   5. Indexa el vencimiento y el par (deuda registrada, vencimiento).
--
-- Riesgo: BAJO. Es ADITIVA. Tres columnas nuevas y un UPDATE que solo escribe
-- sobre una columna recien creada; no toca ninguna columna existente.
--
-- Reversible: SI, sin perdida de informacion. `total` se recalcula desde las
-- lineas cuando haga falta; `dueDate` y `debtRecorded` si se pierden, pero
-- nacen vacios en esta migracion.
--
-- LA DECISION DE ESTA MIGRACION, y es la del objetivo 4:
--
--   LA DEUDA NACE DE LA RECEPCION, NO DE LA ORDEN.
--
-- Una orden de compra es un pedido: se puede cancelar, el proveedor puede
-- mandar la mitad, puede no mandar nada. Nada de eso se debe. Lo que se debe es
-- lo que LLEGO, y lo que llego es una recepcion. Por eso el importe y el
-- vencimiento van aca y no en "PurchaseOrder", y por eso una orden con dos
-- entregas produce DOS obligaciones con dos vencimientos propios.
--
-- Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 0. El disparador de inmutabilidad, apagado para el relleno
--
-- "PurchaseReceipt" es INMUTABLE desde la Fase 3C: tiene un disparador que
-- rechaza todo UPDATE. Y funciono: el primer intento de esta migracion murio
-- ahi, con el mensaje "Una recepcion confirmada es inmutable (intento de UPDATE
-- sobre PurchaseReceipt id 171)".
--
-- Que una migracion tenga que apagarlo NO es hacerle trampa a la garantia. La
-- garantia dice que la APLICACION no reescribe una recepcion; una migracion es
-- justamente lo otro: un cambio de esquema, revisado, versionado y ejecutado
-- una sola vez. El apagado dura hasta el punto 4b, donde el disparador se
-- reemplaza por uno nuevo --y un disparador recien creado nace encendido--.
-- Todo esto ocurre DENTRO de una transaccion: si algo falla en el medio, no
-- queda ni la columna ni el disparador apagado.
--
-- Se apaga solo el de la CABECERA. El de "PurchaseReceiptItem" no se toca: las
-- lineas no cambian en esta migracion.
-- -------------------------------------------------------------------------
ALTER TABLE "PurchaseReceipt" DISABLE TRIGGER "PurchaseReceipt_inmutable";


-- -------------------------------------------------------------------------
-- 1. El importe de la obligacion
--
-- Al costo REAL de la factura, no al esperado de la orden. Es el objetivo 6: si
-- se pidio a $100.000 y vino a $104.500, se le deben $104.500. La diferencia no
-- desaparece --sigue linea por linea en "expectedUnitCost", y el reporte la
-- muestra-- pero no es deuda: deuda es lo que hay que pagar.
-- -------------------------------------------------------------------------
ALTER TABLE "PurchaseReceipt"
  ADD COLUMN "total" NUMERIC(14,2) NOT NULL DEFAULT 0;


-- -------------------------------------------------------------------------
-- 2. El recalculo de lo que ya existia
--
-- Esto NO es inventar deuda. Es completar un dato que siempre estuvo: el
-- importe de una recepcion es la suma de sus lineas, y esa suma ya existia
-- --distribuida en "receivedQuantity" y "unitCost"-- desde la Fase 3C. Se
-- materializa porque la tabla de deudas abiertas ordena y filtra por el, y
-- recalcularlo en cada lectura obligaria a un JOIN con agregacion para pintar
-- una columna.
--
-- Lo que SI seria inventar deuda es darle un cargo en el libro del proveedor, y
-- eso NO se hace: ver el punto 4.
--
-- `round(..., 2)` linea por linea y despues la suma, en ese orden y no al
-- reves: es como se arma una factura. Sumar exacto y redondear al final daria
-- un total que no coincide con el papel.
-- -------------------------------------------------------------------------
UPDATE "PurchaseReceipt" r
   SET "total" = COALESCE((
         SELECT sum(round(i."receivedQuantity" * i."unitCost", 2))
           FROM "PurchaseReceiptItem" i
          WHERE i."purchaseReceiptId" = r."id"
       ), 0);


-- -------------------------------------------------------------------------
-- 3. El vencimiento
--
-- CONGELADO al recibir. NULL = sin fecha registrada, y NULL no significa
-- "vence hoy" ni "no vence nunca": significa que nadie lo cargo. Una obligacion
-- sin vencimiento no aparece jamas como vencida y va ultima en la imputacion
-- automatica.
--
-- Todas las recepciones anteriores quedan en NULL, que es la verdad: nadie
-- registro un vencimiento para ellas porque el campo no existia. Calcularlo
-- hacia atras con el plazo actual del proveedor seria inventar una fecha de
-- reclamo sobre un acuerdo que ni siquiera sabemos que regia entonces.
--
-- Esto NO es el vencimiento del producto. Es cuando hay que pagar, no cuando la
-- mercaderia deja de servir. El vencimiento de producto es otra fase.
-- -------------------------------------------------------------------------
ALTER TABLE "PurchaseReceipt"
  ADD COLUMN "dueDate" TIMESTAMP(3);


-- -------------------------------------------------------------------------
-- 4. Si la recepcion entro al libro del proveedor
--
-- Esta columna existe por el objetivo 36, y responde a una pregunta que sin
-- ella no tiene respuesta: "esta recepcion sin cargo, ¿es anterior al modulo o
-- es un error?".
--
-- Las dos cosas se ven igual --una fila de "PurchaseReceipt" sin ninguna de
-- "SupplierAccountMovement"-- y son opuestas. La primera es correcta: en
-- produccion no se genera deuda historica, porque una entrega de hace seis
-- meses casi con seguridad ya se pago. La segunda es exactamente lo que la
-- reconciliacion tiene que gritar: alguien escribio una recepcion por fuera del
-- servicio y la deuda no se registro.
--
-- Con la columna, la invariante queda EXACTA y en las dos direcciones:
--
--   "debtRecorded" = true   <=>   existe exactamente un PURCHASE_CHARGE suyo
--
-- Es dato redundante --se deduce de la otra tabla-- y por eso mismo la
-- reconciliacion lo comprueba en los dos sentidos: un booleano que se cree sin
-- que nadie lo controle es peor que no tenerlo.
--
-- Todas las recepciones que ya existian quedan en `false`. El DEFAULT queda en
-- `false` tambien: lo pone en `true` el servicio, en la misma transaccion en la
-- que escribe el cargo, y nunca antes.
-- -------------------------------------------------------------------------
ALTER TABLE "PurchaseReceipt"
  ADD COLUMN "debtRecorded" BOOLEAN NOT NULL DEFAULT false;


-- -------------------------------------------------------------------------
-- 4b. El disparador vuelve, y ahora dice EXACTAMENTE que esta congelado
--
-- El de la Fase 3C rechazaba todo UPDATE sin mirar nada. Ya no alcanza: el
-- VENCIMIENTO tiene que poder corregirse. El objetivo 33 lo pide por su nombre
-- --"modificacion de vencimiento autorizada" esta en la lista de lo que hay que
-- auditar-- y el caso es real: el plazo se pacto por telefono y se cargo mal, o
-- el proveedor concede dos semanas mas.
--
-- Y es legitimo, porque el vencimiento NO es un hecho sobre la mercaderia. La
-- inmutabilidad de la Fase 3C protege lo que la recepcion HIZO: movio stock y
-- cambio un costo. El vencimiento no movio nada; es una condicion comercial que
-- se acuerda entre personas y que puede cambiar sin que la entrega cambie.
--
-- La comparacion se hace sobre la fila ENTERA menos esa columna:
--
--   (to_jsonb(NEW) - 'dueDate') = (to_jsonb(OLD) - 'dueDate')
--
-- y no columna por columna, que era la alternativa. La diferencia importa y es
-- el motivo de escribirlo asi: una lista de columnas hay que acordarse de
-- ampliarla, y la columna que alguien agregue el anio que viene y se olvide de
-- sumar a la lista quedaria EDITABLE sin que nadie lo note. Comparando la fila
-- entera, lo que se agregue nace congelado. Falla cerrado.
--
-- El importe (`total`) queda congelado: es lo que se debe, y cambiarlo despues
-- seria reescribir la deuda en vez de corregirla con una nota de credito.
-- `debtRecorded` tambien: lo escribe el INSERT y no se toca mas.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "purchase_receipt_cabecera_inmutable"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'dueDate') = (to_jsonb(OLD) - 'dueDate') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION
    'Una recepcion confirmada es inmutable (intento de % sobre % id %). '
    'Lo unico que se puede corregir es el vencimiento. Para el resto, registra '
    'un ajuste de inventario, un cambio de costo o una nota de credito.',
    TG_OP, TG_TABLE_NAME, OLD."id";
END $$;

DROP TRIGGER "PurchaseReceipt_inmutable" ON "PurchaseReceipt";

CREATE TRIGGER "PurchaseReceipt_inmutable"
  BEFORE UPDATE OR DELETE ON "PurchaseReceipt"
  FOR EACH ROW EXECUTE FUNCTION "purchase_receipt_cabecera_inmutable"();

-- El de las LINEAS no cambia: sigue con la funcion original, que rechaza todo.
-- Una linea de recepcion si es un hecho sobre la mercaderia --cuanto llego y a
-- que costo-- y no tiene ninguna columna que corresponda corregir.


-- -------------------------------------------------------------------------
-- 5. Los indices
--
-- El primero, para "que vence pronto" y para la imputacion automatica, que
-- ordena por vencimiento.
--
-- El segundo es PARCIAL --solo las que entraron al libro-- porque la tabla de
-- deudas abiertas nunca mira las otras. Un indice parcial sobre el 100 % de las
-- filas nuevas y el 0 % de las viejas es mas chico y mas rapido que uno
-- completo, y ademas dice lo que se quiso decir.
-- -------------------------------------------------------------------------
CREATE INDEX "PurchaseReceipt_dueDate_idx"
  ON "PurchaseReceipt"("dueDate");

CREATE INDEX "PurchaseReceipt_deuda_abierta_idx"
  ON "PurchaseReceipt"("dueDate", "receivedAt")
  WHERE "debtRecorded" = true;


-- -------------------------------------------------------------------------
-- 6. Comprobacion posterior
--
-- El total de toda recepcion tiene que ser la suma de sus lineas. Acaba de
-- calcularse asi, con lo cual es trivialmente cierto, y por eso mismo vale la
-- pena dejarlo escrito: es lo unico que hace que una re-aplicacion sobre una
-- base donde alguien ya toco la columna no pase inadvertida.
-- -------------------------------------------------------------------------
DO $$
DECLARE
  descuadres integer;
BEGIN
  SELECT count(*) INTO descuadres
    FROM "PurchaseReceipt" r
   WHERE r."total" <> COALESCE((
           SELECT sum(round(i."receivedQuantity" * i."unitCost", 2))
             FROM "PurchaseReceiptItem" i
            WHERE i."purchaseReceiptId" = r."id"
         ), 0);

  IF descuadres > 0 THEN
    RAISE EXCEPTION
      'El importe no cierra contra las lineas en % recepcion(es) despues de migrar. '
      'No se aplica la migracion.', descuadres;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   DROP INDEX "PurchaseReceipt_deuda_abierta_idx";
--   DROP INDEX "PurchaseReceipt_dueDate_idx";
--   ALTER TABLE "PurchaseReceipt" DROP COLUMN "debtRecorded";
--   ALTER TABLE "PurchaseReceipt" DROP COLUMN "dueDate";
--   ALTER TABLE "PurchaseReceipt" DROP COLUMN "total";
--
-- Que se pierde: los VENCIMIENTOS. `total` se recalcula desde las lineas con el
-- UPDATE del punto 2, y `debtRecorded` se recalcula desde el libro; el
-- vencimiento no esta en ningun otro lado, porque es informacion nueva. Un
-- proveedor que reclame "esto vencia el 9" no va a tener contra que
-- comprobarlo. Exportarlos antes:
--
--   \copy (SELECT "id", "dueDate" FROM "PurchaseReceipt" WHERE "dueDate" IS NOT NULL
--          ORDER BY "id") TO 'vencimientos.csv' CSV HEADER
-- =========================================================================
