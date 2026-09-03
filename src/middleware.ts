// src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { verifySessionToken, SESSION_COOKIE } from '@/server/auth/token'
import type { ApiErrorBody } from '@/server/http/errors'
import { REQUEST_ID_HEADER, requestIdDe } from '@/server/http/requestId'

/**
 * Middleware de navegacion.
 *
 * UBICACION: este archivo tiene que estar en `src/`, no en la raiz.
 * Con un directorio `src/`, Next.js solo reconoce `src/middleware.ts`. Un
 * `middleware.ts` en la raiz se excluye del build sin ningun aviso: compila,
 * no da error, y sencillamente no se ejecuta. Asi estuvo hasta ahora, que es
 * por lo que la autenticacion de navegacion nunca corrio en produccion.
 * El test `tests/authorization/removed-endpoints.test.ts` y el paso de CI
 * comprueban que siga aca.
 *
 * ALCANCE: esto es una comodidad, no la defensa. Solo redirige al login a
 * quien no tiene una cookie con firma valida, para que no vea pantallas vacias.
 * La autorizacion real la hace cada endpoint por su cuenta, en el servidor,
 * comprobando permiso, sucursal y estado del usuario contra la base.
 *
 * RUNTIME: corre en el Edge. Por eso usa `jose` y no `jsonwebtoken`, y por eso
 * NO consulta Prisma: el motor de consultas no funciona en ese runtime. La
 * version anterior importaba `@/lib/prisma` y hacia un findUnique por cada
 * navegacion a /admin.
 */

/**
 * Rutas accesibles sin sesion.
 *
 * `/offline` es la pantalla que muestra el service worker cuando no hay red.
 * Tiene que ser publica: se llega a ella justamente cuando no se puede
 * comprobar nada contra el servidor. No contiene ningun dato del comercio.
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/offline',
  '/api/auth/login',
  '/api/auth/logout',
  // El monitor consulta la salud sin credenciales. Si exigiera sesion, un
  // fallo de la base --que es justo lo que viene a detectar-- se veria como
  // un 401 y no como un 503.
  '/api/health',
])

/** Prefijos de recursos que no pasan por la comprobacion. */
const PUBLIC_PREFIXES = ['/_next/', '/icons/', '/screenshots/']

/** Archivos sueltos servidos desde public/. */
const PUBLIC_FILES = new Set([
  '/favicon.ico',
  '/manifest.json',
  '/sw.js',
  '/robots.txt',
  '/icon-192x192.png',
  '/icon-512x512.png',
])

function esPublica(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (PUBLIC_FILES.has(pathname)) return true
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true

  return false
}

/**
 * Los nombres con los que se llega a esta aplicacion.
 *
 * Nginx ya filtra por `server_name` y manda al vhost `default` cualquier otro
 * nombre, asi que esto no deberia recibir nada raro. Se comprueba igual: si
 * mañana alguien agrega un `proxy_pass` sin `server_name`, o se prueba la
 * aplicacion sin proxy delante, un `Host` inventado deja de ser un problema
 * silencioso. No hay confianza ciega en la cabecera.
 */
const HOSTS_PUBLICOS = new Set([
  'luchandopormas.com',
  'www.luchandopormas.com',
  'kiosco.nistal.net',
])

/**
 * La propia maquina. El chequeo de salud y el diagnostico entran por aca
 * --`curl http://127.0.0.1:3099/api/health`-- y no pasan por Nginx, asi que
 * su `Host` nunca va a ser un dominio publico.
 */
const HOSTS_LOCALES = new Set([
  '127.0.0.1:3099',
  'localhost:3099',
  '127.0.0.1',
  'localhost',
])

/**
 * Si el nombre por el que preguntan es uno de los que servimos.
 *
 * `X-Forwarded-Host` se mira ANTES que `Host` porque es el que lleva el nombre
 * que escribio la persona cuando hay un proxy delante. Se toma solo el primer
 * valor: una cadena de proxies los acumula separados por coma, y quedarse con
 * la lista entera es como se cuelan valores que nadie valido.
 */
function hostPermitido(req: NextRequest): boolean {
  const crudo = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const host = (crudo.split(',')[0] ?? '').trim().toLowerCase()

  return HOSTS_PUBLICOS.has(host) || HOSTS_LOCALES.has(host)
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Antes que nada: si el nombre no es de los nuestros, no se contesta. Va
  // primero para que tampoco lo aprovechen las rutas publicas.
  if (!hostPermitido(req)) {
    return new NextResponse('Host no reconocido', {
      status: 421,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  if (esPublica(pathname)) return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const claims = token ? await verifySessionToken(token) : null

  if (claims) return NextResponse.next()

  // Las APIs responden 401; no tiene sentido redirigir una peticion fetch al
  // HTML del login. Ademas asi el cliente puede distinguir "sesion vencida".
  if (pathname.startsWith('/api/')) {
    // Mismo contrato de error que el resto de la aplicacion, para que el
    // cliente no tenga que distinguir si respondio el middleware o la ruta.
    const requestId = requestIdDe(req)
    const cuerpo: ApiErrorBody = {
      error: {
        code: token ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED',
        message: token ? 'La sesion expiro. Vuelva a iniciar sesion.' : 'No autenticado',
        requestId,
      },
    }
    const res = NextResponse.json(cuerpo, { status: 401 })
    res.headers.set(REQUEST_ID_HEADER, requestId)
    if (token) res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
    return res
  }

  // `Location` RELATIVO, y es la correccion de un fallo que rompia el sitio
  // entero.
  //
  // Antes decia `new URL('/login', req.url)`. En produccion eso mandaba a
  // `https://localhost:3099/login`: la barra de direcciones del navegador
  // terminaba en una direccion que solo existe DENTRO del servidor.
  //
  // El motivo es que `req.url` NO se arma con la cabecera `Host`. Next usa la
  // direccion en la que escucha el proceso --127.0.0.1:3099-- y por eso el
  // nombre publico nunca aparecia. Comprobado pidiendole a la aplicacion, sin
  // Nginx delante:
  //
  //   sin cabeceras          -> http://localhost:3099/login
  //   con Host: luchando...  -> http://localhost:3099/login   <-- lo ignora
  //   agregando XF-Proto     -> https://localhost:3099/login  <-- solo cambia
  //                                                               el esquema
  //
  // Una referencia relativa (RFC 7231 §7.1.2) la resuelve el navegador contra
  // la direccion que pidio. Sale el dominio correcto sea cual sea de los tres,
  // sin que la aplicacion tenga que adivinarlo ni fiarse de una cabecera. Es
  // ademas la unica forma que no vuelve a romperse al agregar un dominio.
  //
  // `pathname` viene de `req.nextUrl` y siempre empieza con `/`, asi que el
  // valor de `next` no puede convertirse en una redireccion a otro sitio.
  // `destinoSeguro()` en la pantalla de login lo vuelve a comprobar.
  const destino = pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`

  const res = new NextResponse(null, { status: 307, headers: { Location: destino } })
  // Si habia una cookie y no valida, se limpia para no reintentar en bucle.
  if (token) res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}

export const config = {
  /**
   * Se excluyen los estaticos por rendimiento. La comprobacion fina la hace
   * `esPublica`, no este patron: la version anterior usaba
   * `/\.(.*)$/` para dejar pasar "cualquier ruta con un punto", con lo cual
   * una peticion a `/admin/usuarios.json` salteaba el middleware entero.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
