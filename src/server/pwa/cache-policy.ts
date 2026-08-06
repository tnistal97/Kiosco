/**
 * Que puede guardar el service worker y que no.
 *
 * next-pwa cachea por defecto las peticiones same-origin. Eso incluye
 * /api/cash, /api/users y /api/sales. Consecuencia concreta: despues de que
 * un cajero cierra sesion, alguien con el mismo equipo y sin conexion puede
 * seguir viendo en pantalla la ultima respuesta guardada en disco.
 *
 * La politica vive aca, en un unico modulo, para que next.config.ts y los
 * tests miren exactamente la misma lista.
 */

/**
 * Rutas que el service worker no debe guardar nunca.
 *
 * - /api/*      toda respuesta de la API es especifica de la sesion
 * - /login      no tiene sentido servirla desde cache
 * - /admin/*    pantallas con informacion administrativa
 */
export const PWA_EXCLUDE_PATTERNS: RegExp[] = [/^\/api\//, /^\/login\/?$/, /^\/admin\//]

/** true si la ruta puede guardarse en el cache del navegador. */
export function shouldCacheRequest(pathnameOrUrl: string): boolean {
  const pathname = pathnameOrUrl.startsWith('http')
    ? new URL(pathnameOrUrl).pathname
    : pathnameOrUrl.split('?')[0]!

  return !PWA_EXCLUDE_PATTERNS.some((patron) => patron.test(pathname))
}

/**
 * Forma que espera next-pwa en su opcion `publicExcludes`/`buildExcludes` no
 * sirve para esto: esas filtran archivos estaticos, no peticiones en tiempo
 * de ejecucion. Lo que corresponde es `runtimeCaching` con un handler
 * NetworkOnly, mas la lista de exclusion del navigation fallback.
 */
export const PWA_RUNTIME_CACHING = [
  {
    urlPattern: ({ url }: { url: URL }) => !shouldCacheRequest(url.pathname),
    handler: 'NetworkOnly' as const,
    options: {
      cacheName: 'sin-cache-datos-privados',
    },
  },
]
