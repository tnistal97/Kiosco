// next.config.ts
import type { NextConfig } from 'next'
import createPwaPlugin from 'next-pwa'
import { PWA_EXCLUDE_PATTERNS } from './src/server/pwa/cache-policy'

/**
 * Service worker.
 *
 * Por defecto next-pwa cachea las peticiones same-origin, lo que incluye
 * /api/cash, /api/users y /api/sales. Consecuencia concreta: despues de que
 * un cajero cierra sesion, con el mismo equipo y sin conexion se podia seguir
 * viendo la ultima respuesta guardada en disco.
 *
 * La lista de exclusion vive en src/server/pwa/cache-policy.ts y esta cubierta
 * por tests. Aca solo se aplica.
 */
const withPWA = createPwaPlugin({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,

  // Nada de lo que coincida con estos patrones se guarda ni se sirve desde
  // el cache: siempre va a la red.
  runtimeCaching: [
    {
      urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
        sameOrigin && PWA_EXCLUDE_PATTERNS.some((patron) => patron.test(url.pathname)),
      handler: 'NetworkOnly',
      options: { cacheName: 'sin-cache-datos-privados' },
    },
  ],

  // El fallback de navegacion no debe servir una pantalla cacheada para
  // rutas privadas ni para el login.
  publicExcludes: ['!icons/**/*'],
  buildExcludes: [/middleware-manifest\.json$/],
})

const nextConfig: NextConfig = {
  reactStrictMode: true,

  /**
   * Cabeceras de seguridad. No estaban.
   *
   * `Cache-Control: no-store` sobre /api es la segunda mitad del problema del
   * service worker: sin ella, el cache HTTP del propio navegador guarda las
   * respuestas privadas aunque el service worker no lo haga.
   */
  // eslint-disable-next-line @typescript-eslint/require-await -- Next exige que headers() sea async
  async headers() {
    return [
      {
        source: '/api/:path*',
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

export default withPWA(nextConfig)
