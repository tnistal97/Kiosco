/**
 * Guarda de los guiones heredados de datos de ejemplo.
 *
 * `insertUsers`, `insertData` e `insertCategories` vienen de antes de la
 * Fase 0 y no miraban contra que base corrian. `insertUsers` crea un `admin`
 * con una clave de ejemplo que esta en el repositorio, que es publico: corrido
 * contra una instancia real, dejaba una puerta abierta con la llave a la
 * vista. Ahora se niegan salvo contra una base terminada en `_dev`, la misma
 * regla que `prisma/seed-demo.ts`.
 *
 * Importa `./entorno` para mirar la MISMA `DATABASE_URL` que despues va a usar
 * Prisma, que tambien lee `.env`.
 */

import './entorno'

export function exigirBaseDeDesarrollo(guion: string): void {
  const url = process.env.DATABASE_URL ?? ''
  const base = url.split('/').pop()?.split('?')[0] ?? ''
  if (base.endsWith('_dev')) return

  console.error(
    `${guion} crea datos de ejemplo con claves conocidas y solo corre contra una base ` +
      `terminada en "_dev". Recibido: "${base || '(vacio)'}". ` +
      'Para una instancia real: npm run alta:instancia -- --ayuda',
  )
  process.exit(1)
}
