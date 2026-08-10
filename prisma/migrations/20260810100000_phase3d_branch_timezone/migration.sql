-- =========================================================================
-- Fase 3D — La sucursal declara su zona horaria
--
-- Que hace: agrega "Branch"."timeZone" con la zona del negocio, en formato
-- IANA.
--
-- Riesgo: BAJO. Aditiva, con valor por omision. Ninguna fila existente
-- cambia de significado: el valor por defecto es exactamente lo que el
-- sistema venia suponiendo.
--
-- Reversible: si, sin perdida. Ver el ROLLBACK al final.
--
-- Ver docs/TIMEZONE_POLICY.md.
-- =========================================================================


-- -------------------------------------------------------------------------
-- 1. La columna
--
-- Por que un identificador IANA y no un desfase:
--
--   'America/Argentina/Buenos_Aires'  es una REGLA
--   'UTC-3'                           es un NUMERO
--
-- Argentina tuvo horario de verano entre 2007 y 2009. Una consulta sobre
-- diciembre de 2008 tiene que usar UTC-2, que es lo que regia entonces. Con
-- un numero fijo, todo ese verano queda corrido una hora hacia atras y no hay
-- forma de arreglarlo despues sin saber que dias eran cuales.
--
-- El valor por omision alcanza para todo el catalogo existente: es el unico
-- que podria ser correcto para los datos que ya estan, y ademas coincide con
-- lo que el sistema hacia implicitamente al usar la zona del proceso.
-- -------------------------------------------------------------------------
ALTER TABLE "Branch"
  ADD COLUMN "timeZone" TEXT NOT NULL DEFAULT 'America/Argentina/Buenos_Aires';


-- -------------------------------------------------------------------------
-- 2. Que no quede vacia
--
-- PostgreSQL no conoce la lista IANA, asi que no puede comprobar que la zona
-- exista: eso lo valida el servicio contra `Intl`, que si la trae. Lo que si
-- puede garantizar la base es que no sea la cadena vacia ni un desfase
-- disfrazado, que son los dos errores que un editor de base de datos comete
-- a mano.
--
-- El patron exige una barra --'America/Argentina/Buenos_Aires'-- o la palabra
-- UTC, que es la unica zona valida sin barra y la que usan las pruebas.
-- -------------------------------------------------------------------------
ALTER TABLE "Branch"
  ADD CONSTRAINT "Branch_timeZone_check"
  CHECK ("timeZone" = 'UTC' OR "timeZone" ~ '^[A-Za-z][A-Za-z0-9_+-]*/[A-Za-z0-9_/+-]+$');


-- =========================================================================
-- ROLLBACK (documentado, NO se ejecuta)
--
-- ALTER TABLE "Branch" DROP CONSTRAINT "Branch_timeZone_check";
-- ALTER TABLE "Branch" DROP COLUMN "timeZone";
--
-- Sin perdida real: al volver, el sistema retoma la zona del proceso, que es
-- de donde salia el dia hasta esta fase.
-- =========================================================================
