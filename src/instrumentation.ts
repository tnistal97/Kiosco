/**
 * Se ejecuta una vez, al arrancar el servidor, antes de atender la primera
 * peticion. Es el gancho que Next.js ofrece para esto.
 *
 * Lo unico que hace: comprobar el entorno y morir si esta mal. Ver
 * `src/server/env.ts` para el porque.
 *
 * SOLO en el runtime de Node. El mismo modulo se carga tambien en el Edge
 * --donde corre el middleware-- y ahi `process.exit` no existe; ademas el
 * Edge no necesita `DATABASE_URL`. Sin esta guarda, el build del middleware
 * arrastraria `node:fs` y fallaria.
 */
export function register(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  // Import diferido: en el Edge este modulo ni se evalua.
  void import('@/server/env').then(({ exigirEntorno }) => {
    exigirEntorno()
  })
}
