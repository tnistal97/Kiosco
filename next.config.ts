// next.config.ts
import { randomUUID } from 'node:crypto'
import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'
import { PWA_OFFLINE_PATH } from './src/server/pwa/cache-policy'

/**
 * Service worker: Serwist.
 *
 * Reemplaza a next-pwa, sin mantenimiento desde 2022, que arrastraba Workbox 6
 * y su propio webpack. El detalle del cambio esta en
 * docs/DEPENDENCY_SECURITY.md.
 *
 * La politica de que se guarda y que no vive en
 * `src/server/pwa/cache-policy.ts`, la aplica `src/app/sw.ts` y la comprueban
 * `tests/unit/pwa-cache.test.ts` y `tests/unit/service-worker.test.ts`. Aca
 * solo se conecta.
 *
 * En desarrollo se desactiva: un service worker cacheando durante el
 * desarrollo hace perder horas persiguiendo cambios que ya estaban hechos.
 */
const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV === 'development',
  reloadOnOnline: true,
  register: true,

  /**
   * La pantalla de sin conexion, precargada a mano.
   *
   * El manifiesto que arma Serwist solo lleva `public/` y `_next/static`: una
   * ruta de la aplicacion como `/offline` no entra sola. Sin esto el
   * `fallback` apunta a algo que no esta en el cache y, sin red, el navegador
   * muestra su propio error en vez de la pantalla. Fue exactamente lo que
   * detecto `npm run pwa:check`.
   *
   * `revision` cambia en cada construccion a proposito: la pantalla es HTML
   * generado por Next y tiene que renovarse con el resto.
   */
  additionalPrecacheEntries: [{ url: PWA_OFFLINE_PATH, revision: randomUUID() }],

  // El manifiesto de rutas del middleware nunca se precarga: no es un
  // estatico publico y cambia en cada build.
  exclude: [/middleware-manifest\.json$/, /_next\/app-build-manifest\.json$/],
})

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * El servidor de desarrollo NO escribe donde escribe la construccion.
   *
   * `next dev --turbopack` y `next build` usaban los dos `.next`. Con un
   * servidor de desarrollo olvidado en el puerto 3000, la construccion de
   * produccion quedaba mezclada con artefactos de Turbopack y el servidor
   * levantaba roto:
   *
   *   Error: Cannot find module '../chunks/ssr/[turbopack]_runtime.js'
   *   TypeError: routesManifest.dataRoutes is not iterable
   *
   * y todas las paginas contestaban 500 DESPUES de que el login respondiera
   * 200, con lo cual la suite de extremo a extremo fallaba en `waitForURL` y
   * el sintoma no se parecia en nada a la causa. Paso dos veces (fases 1 y 2).
   *
   * Con `.next-dev` aparte, desarrollo y construccion pueden convivir: son
   * dos carpetas distintas y ninguna pisa a la otra. `next start`, el
   * artefacto de release y el despliegue siguen usando `.next` como siempre.
   *
   * `next dev` pone NODE_ENV en 'development' antes de leer esta configuracion;
   * `next build` y `next start`, en 'production'.
   */
  distDir: process.env.NODE_ENV === 'development' ? '.next-dev' : '.next',

  /**
   * La raiz del proyecto es esta carpeta.
   *
   * Sin esto Next elige la raiz sola mirando donde hay un `package-lock.json`,
   * y en este equipo encuentra uno en el directorio del usuario: da por raiz
   * `C:\Users\nsuni` y avisa en cada construccion. No es solo ruido: el
   * rastreo de archivos para el despliegue parte de ahi.
   */
  outputFileTracingRoot: import.meta.dirname,

  /**
   * Cabeceras de seguridad. No estaban.
   *
   * `Cache-Control: no-store` sobre /api es la segunda mitad del problema del
   * service worker: sin ella, el cache HTTP del propio navegador guarda las
   * respuestas privadas aunque el service worker no lo haga.
   *
   * Menos la foto de un producto (`/api/products/:id/imagen`), que fija su
   * propio cache: es la foto del envase, no un dato privado, y con la version
   * en la direccion se puede guardar para siempre. Si esta regla la pisara, la
   * caja volveria a pedir cada foto en cada pantalla. Ver docs/PRODUCT_IMAGES.md.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Next exige que headers() sea async
  async headers() {
    return [
      {
        source: '/api/:path((?!products/\\d+/imagen$).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(), camera=(self)' },
        ],
      },
    ]
  },
}

export default withSerwist(nextConfig)
