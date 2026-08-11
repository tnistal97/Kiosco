-- =========================================================================
-- Fase 4C — La mercaderia que sale: PURCHASE_RETURN
--
-- Que hace:
--   1. Amplia la tabla de signos de "StockMovement" con 'PURCHASE_RETURN'.
--
-- Riesgo: BAJO. AFLOJA una restriccion: acepta un tipo que antes no existia.
-- Ninguna fila existente puede volverse invalida por aceptar un valor mas.
--
-- Reversible: SI, mientras no haya movimientos de ese tipo. El rollback al pie
-- lo comprueba y aborta si los hay, en vez de dejar una restriccion que las
-- filas ya escritas no cumplen.
--
-- POR QUE UN TIPO PROPIO Y NO UN AJUSTE. Un `MANUAL_ADJUSTMENT` diria que
-- faltan ocho unidades. Un `PURCHASE_RETURN` dice que ocho unidades volvieron al
-- proveedor, y esa diferencia es el unico dato que despues permite preguntar
-- cuanto se devolvio en el trimestre y separarlo de lo que se perdio. Es el
-- mismo motivo por el que `LOSS` y `BREAKAGE` no son el mismo tipo.
--
-- Y ES NEGATIVO SIEMPRE. La entrada de mercaderia tiene su tipo
-- (`PURCHASE_RECEIPT`, positivo); esto es la salida. Un `PURCHASE_RETURN` que
-- sumara unidades no es un error que haya que buscar: es una fila que PostgreSQL
-- rechaza.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La tabla de signos
--
-- Se reemplaza entera en vez de agregarle una restriccion aparte, para que siga
-- habiendo UNA sola tabla de signos y no dos que haya que leer juntas. La lista
-- es identica a la de la Fase 3A mas el tipo nuevo; se repite completa a
-- proposito, porque asi el archivo dice cual es la regla resultante y no solo
-- que le cambio.
-- -------------------------------------------------------------------------
ALTER TABLE "StockMovement"
  DROP CONSTRAINT "StockMovement_tipo_signo_check";

ALTER TABLE "StockMovement"
  ADD CONSTRAINT "StockMovement_tipo_signo_check"
  CHECK (
       ("type" = 'INITIAL'                                             AND "quantity" >= 0)
    OR ("type" IN ('SALE', 'LOSS', 'BREAKAGE', 'INTERNAL_USE',
                   'PURCHASE_RETURN')                                  AND "quantity" < 0)
    OR ("type" IN ('SALE_CANCEL', 'PURCHASE_RECEIPT')                  AND "quantity" > 0)
    OR ("type" = 'MANUAL_ADJUSTMENT'                                   AND "quantity" <> 0)
  );


-- -------------------------------------------------------------------------
-- 2. Comprobacion posterior
--
-- Que la restriccion nueva acepte todo lo que ya estaba escrito. Es barata y
-- cierra la unica forma de equivocarse al reescribir una lista: olvidarse un
-- tipo que ya se usaba.
-- -------------------------------------------------------------------------
DO $$
DECLARE tipos TEXT;
BEGIN
  SELECT string_agg(DISTINCT "type", ', ') INTO tipos
    FROM "StockMovement"
   WHERE "type" NOT IN ('INITIAL', 'SALE', 'SALE_CANCEL', 'MANUAL_ADJUSTMENT',
                        'LOSS', 'BREAKAGE', 'INTERNAL_USE', 'PURCHASE_RECEIPT',
                        'PURCHASE_RETURN');

  IF tipos IS NOT NULL THEN
    RAISE EXCEPTION
      'El libro de inventario tiene tipos que la tabla de signos nueva no '
      'contempla: %. Agregarlos antes de continuar.', tipos;
  END IF;
END $$;


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
--   -- Aborta si ya hay devoluciones en el libro: la restriccion vieja las
--   -- rechazaria, y ALTER TABLE fallaria a mitad de camino con un mensaje mucho
--   -- menos claro que este.
--   DO $$
--   DECLARE cuantos INTEGER;
--   BEGIN
--     SELECT count(*) INTO cuantos
--       FROM "StockMovement" WHERE "type" = 'PURCHASE_RETURN';
--     IF cuantos > 0 THEN
--       RAISE EXCEPTION
--         'Hay % movimientos PURCHASE_RETURN en el libro de inventario. Son '
--         'mercaderia que ya salio del deposito: no se pueden borrar sin '
--         'falsear el stock. Revertir primero las devoluciones.', cuantos;
--     END IF;
--   END $$;
--
--   ALTER TABLE "StockMovement" DROP CONSTRAINT "StockMovement_tipo_signo_check";
--   ALTER TABLE "StockMovement"
--     ADD CONSTRAINT "StockMovement_tipo_signo_check"
--     CHECK (
--          ("type" = 'INITIAL'                                        AND "quantity" >= 0)
--       OR ("type" IN ('SALE', 'LOSS', 'BREAKAGE', 'INTERNAL_USE')    AND "quantity" < 0)
--       OR ("type" IN ('SALE_CANCEL', 'PURCHASE_RECEIPT')             AND "quantity" > 0)
--       OR ("type" = 'MANUAL_ADJUSTMENT'                              AND "quantity" <> 0)
--     );
--
-- Que se pierde: nada, si la comprobacion de arriba paso. Es literalmente la
-- restriccion anterior.
-- =========================================================================
