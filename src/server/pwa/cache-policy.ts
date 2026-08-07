/**
 * Que puede guardar el service worker y que no.
 *
 * **Es una lista blanca, no una lista negra.** Se guarda lo que esta
 * explicitamente permitido y todo lo demas va a la red. Con una lista negra,
 * cada pantalla nueva nacia cacheada hasta que alguien se acordara de
 * agregarla, y agregarla se olvida: la Fase 2 renombro casi todas las rutas
 * --`/admin/*` dejo de existir-- y la lista vieja habria dejado a
 * `/auditoria`, `/usuarios` y `/ventas` guardandose en disco sin que nadie lo
 * notara.
 *
 * El problema concreto que evita: despues de que un cajero cierra sesion,
 * alguien con el mismo equipo y sin conexion podia seguir viendo en pantalla
 * la ultima respuesta guardada.
 *
 * La politica vive en un unico modulo para que la configuracion del service
 * worker y los tests miren exactamente la misma lista.
 */

/**
 * Lo unico que se puede guardar.
 *
 * Todo publico y todo estatico: nada aca depende de quien haya iniciado
 * sesion.
 *
 * - `/_next/static/`      bundles y CSS con hash en el nombre
 * - `/icon-192x192.png`   iconos de la aplicacion
 * - `/manifest.json`      manifiesto de la PWA
 * - `/offline`            pantalla publica de "sin conexion"
 * - `/favicon.ico`, `/robots.txt`
 */
export const PWA_ALLOW_PATTERNS: RegExp[] = [
  /^\/_next\/static\//,
  /^\/icon-\d+x\d+\.png$/,
  /^\/icons\//,
  /^\/manifest\.json$/,
  /^\/offline\/?$/,
  /^\/favicon\.ico$/,
  /^\/robots\.txt$/,
]

/**
 * Rutas que nunca se guardan, aunque alguien agregue un patron permisivo.
 *
 * Redundante con la lista blanca a proposito: es la barrera que queda si
 * mañana alguien afloja `PWA_ALLOW_PATTERNS`. Las pruebas comprueban las dos.
 */
export const PWA_DENY_PATTERNS: RegExp[] = [
  /^\/api\//,
  /^\/login\/?$/,
  /^\/venta\/?$/,
  /^\/ventas\b/,
  /^\/caja\/?$/,
  /^\/productos\b/,
  /^\/stock\b/,
  /^\/auditoria\b/,
  /^\/usuarios\b/,
  /^\/sucursales\b/,
  /^\/configuracion\b/,
  // Rutas de la version anterior. Se conservan por si queda un service
  // worker viejo instalado en algun equipo.
  /^\/admin\//,
  /^\/control\//,
]

/** Ruta de la pantalla publica que se muestra sin conexion. */
export const PWA_OFFLINE_PATH = '/offline'

/** true si la ruta puede guardarse en el cache del navegador. */
export function shouldCacheRequest(pathnameOrUrl: string): boolean {
  // split siempre devuelve al menos un elemento, pero el tipo no lo sabe:
  // ante la duda se conserva la cadena entera, que es la opcion segura
  // (mas probable que coincida con un patron de exclusion, no menos).
  const pathname = pathnameOrUrl.startsWith('http')
    ? new URL(pathnameOrUrl).pathname
    : (pathnameOrUrl.split('?')[0] ?? pathnameOrUrl)

  if (PWA_DENY_PATTERNS.some((p) => p.test(pathname))) return false
  return PWA_ALLOW_PATTERNS.some((p) => p.test(pathname))
}
