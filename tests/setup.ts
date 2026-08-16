/**
 * Preparacion del entorno de pruebas.
 *
 * Los tests corren SIEMPRE contra una base descartable, nunca contra
 * desarrollo y mucho menos contra produccion. Si DATABASE_URL apunta a algo
 * que no se llama *_test, el proceso aborta antes de tocar nada.
 */

// NODE_ENV lo fija vitest en 'test'; no hace falta (ni se puede) reasignarlo.

process.env.DATABASE_URL ??=
  'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_test?schema=public'

// Secreto exclusivo de pruebas. No es un secreto real ni sirve fuera de aca.
process.env.JWT_SECRET ??= 'clave-solo-para-tests-nunca-en-produccion-000'

/**
 * El cliente Prisma se construye con el registro de consultas encendido.
 *
 * Es lo que permite CONTAR las sentencias que hace una ruta sobre el mismo
 * cliente que usa la aplicacion, que es la unica forma de detectar un N+1 de
 * verdad. Va aca --y no en el archivo que mide-- porque la opcion solo se puede
 * dar en el constructor, y el constructor corre cuando alguien importa
 * `@/lib/prisma`: para cuando el archivo de pruebas lo importa, ya es tarde.
 *
 * `pideInstrumentacion()` la ignora en produccion. Ver src/lib/prisma.ts.
 */
process.env.PRISMA_QUERY_EVENTS ??= '1'

const url = process.env.DATABASE_URL
const dbName = url.split('/').pop()?.split('?')[0] ?? ''

if (!dbName.endsWith('_test')) {
  throw new Error(
    `Los tests abortan: DATABASE_URL apunta a la base "${dbName}", que no termina en "_test". ` +
      'Nunca ejecutar la suite contra desarrollo ni produccion.',
  )
}
