/**
 * Preparacion del entorno de pruebas.
 *
 * Los tests corren SIEMPRE contra una base descartable, nunca contra
 * desarrollo y mucho menos contra produccion. Si DATABASE_URL apunta a algo
 * que no se llama *_test, el proceso aborta antes de tocar nada.
 */

process.env.NODE_ENV = 'test'

process.env.DATABASE_URL ??=
  'postgresql://kiosco_dev:kiosco_dev@127.0.0.1:5433/kiosco_test?schema=public'

// Secreto exclusivo de pruebas. No es un secreto real ni sirve fuera de aca.
process.env.JWT_SECRET ??= 'clave-solo-para-tests-nunca-en-produccion-000'

const url = process.env.DATABASE_URL
const dbName = url.split('/').pop()?.split('?')[0] ?? ''

if (!dbName.endsWith('_test')) {
  throw new Error(
    `Los tests abortan: DATABASE_URL apunta a la base "${dbName}", que no termina en "_test". ` +
      'Nunca ejecutar la suite contra desarrollo ni produccion.',
  )
}
