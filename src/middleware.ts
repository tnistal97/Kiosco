// src/middleware.ts
import { NextResponse, type NextRequest } from 'next/server'
import { verifySessionToken, SESSION_COOKIE } from '@/server/auth/token'
import type { ApiErrorBody } from '@/server/http/errors'
import { REQUEST_ID_HEADER, requestIdDe } from '@/server/http/requestId'
import { funcionesHabilitadas, rutaDeshabilitada } from '@/lib/funciones'

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
 *
 * La lista sale de `KIOSCO_HOSTS` --nombres separados por coma--, leida al
 * atender y no al construir: el middleware corre en el sandbox Edge de
 * `next start`, que arma `process.env` con el entorno del proceso. Es lo que
 * permite levantar la instancia de otro comercio, con su dominio, sin tocar el
 * codigo ni recompilar. Cada instancia contesta SOLO por los suyos.
 *
 * Sin la variable valen los tres de siempre, para que la instalacion actual no
 * dependa de agregarla antes del proximo despliegue.
 */
const HOSTS_POR_OMISION = ['luchandopormas.com', 'www.luchandopormas.com', 'kiosco.nistal.net']

let hostsLeidos: { crudo: string | undefined; hosts: ReadonlySet<string> } | null = null

function hostsPublicos(crudo: string | undefined = process.env.KIOSCO_HOSTS): ReadonlySet<string> {
  if (hostsLeidos !== null && hostsLeidos.crudo === crudo) return hostsLeidos.hosts

  const declarados = (crudo ?? '')
    .split(/[\s,]+/)
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '')

  const hosts = new Set(declarados.length > 0 ? declarados : HOSTS_POR_OMISION)
  hostsLeidos = { crudo, hosts }
  return hosts
}

/**
 * La propia maquina, en cualquier puerto.
 *
 * El chequeo de salud y el diagnostico entran por aca --`curl
 * http://127.0.0.1:3099/api/health`-- y no pasan por Nginx, asi que su `Host`
 * nunca va a ser un dominio publico. Se acepta CUALQUIER puerto y no solo el
 * 3099: `next dev` escucha en el 3000, la suite de extremo a extremo levanta
 * la aplicacion en el 3101 y `pwa:check` en el 3100, y con la lista fija de
 * antes los tres recibian "Host no reconocido" (auditoria UX, H-40). Un nombre
 * de loopback con otro puerto sigue siendo esta maquina: lo que la lista
 * protege es que un `Host` inventado no se conteste, y eso no cambia.
 */
function esHostLocal(host: string): boolean {
  const nombre = host.split(':')[0] ?? ''
  return nombre === 'localhost' || nombre === '127.0.0.1'
}

/**
 * El nombre por el que preguntan, si es uno de los que servimos. Si no, `null`.
 *
 * `X-Forwarded-Host` se mira ANTES que `Host` porque es el que lleva el nombre
 * que escribio la persona cuando hay un proxy delante. Se toma solo el primer
 * valor: una cadena de proxies los acumula separados por coma, y quedarse con
 * la lista entera es como se cuelan valores que nadie valido.
 *
 * Devolver el nombre --y no un booleano-- es lo que permite construir la
 * redireccion con el dominio correcto SIN confiar a ciegas en la cabecera:
 * lo que sale de aca ya paso por la lista de permitidos.
 */
function hostDeLaPeticion(req: NextRequest): string | null {
  const crudo = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? ''
  const host = (crudo.split(',')[0] ?? '').trim().toLowerCase()

  if (hostsPublicos().has(host) || esHostLocal(host)) return host

  return null
}

/**
 * El origen publico con el que armar una redireccion.
 *
 * El esquema sale de `X-Forwarded-Proto`, que es lo unico que sabe si la
 * persona entro por HTTPS: la conexion que ve la aplicacion es siempre HTTP
 * plano contra 127.0.0.1. Se acepta solo `http` o `https`; cualquier otra cosa
 * cae a `https`, que es como se sirve de verdad.
 *
 * Sin esa cabecera --alguien hablando directo con el puerto interno-- se usa
 * `http`, que es lo que efectivamente esta pasando.
 */
function origenDe(req: NextRequest, host: string): string {
  const declarado = (req.headers.get('x-forwarded-proto')?.split(',')[0] ?? '').trim().toLowerCase()
  const esquema =
    declarado === 'https' || declarado === 'http' ? declarado : esHostLocal(host) ? 'http' : 'https'

  return `${esquema}://${host}`
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Antes que nada: si el nombre no es de los nuestros, no se contesta. Va
  // primero para que tampoco lo aprovechen las rutas publicas.
  const host = hostDeLaPeticion(req)
  if (host === null) {
    return new NextResponse('Host no reconocido', {
      status: 421,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  if (esPublica(pathname)) return NextResponse.next()

  const token = req.cookies.get(SESSION_COOKIE)?.value
  const claims = token ? await verifySessionToken(token) : null

  if (claims) {
    // Pantallas de una funcion que esta instalacion no usa (lotes, compras):
    // se va a la pantalla que si usa, con una redireccion limpia y no con una
    // pagina a medio dibujar. La API no pasa por aca. Ver `@/lib/funciones`.
    const destino = pathname.startsWith('/api/')
      ? null
      : rutaDeshabilitada(pathname, funcionesHabilitadas(process.env))
    if (destino !== null) return NextResponse.redirect(new URL(destino, origenDe(req, host)))
    return NextResponse.next()
  }

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

  // La redireccion se arma con el nombre PUBLICO, no con `req.url`.
  //
  // Antes decia `new URL('/login', req.url)` y en produccion eso mandaba a
  // `https://localhost:3099/login`: la barra de direcciones terminaba en una
  // direccion que solo existe dentro del servidor y el sitio era inusable.
  //
  // El motivo es que `req.url` NO se arma con la cabecera `Host`: Next usa la
  // direccion en la que escucha el proceso --127.0.0.1:3099--. Comprobado
  // pidiendole a la aplicacion sin Nginx delante:
  //
  //   sin cabeceras          -> http://localhost:3099/login
  //   con Host: luchando...  -> http://localhost:3099/login   <-- lo ignora
  //   agregando XF-Proto     -> https://localhost:3099/login  <-- solo cambia
  //                                                               el esquema
  //
  // Un `Location` relativo seria mas simple y fue lo primero que se intento,
  // pero Next valida la cabecera y la rechaza: `TypeError: Invalid URL,
  // input: '/login'`, con lo que la raiz pasaba a responder 500.
  //
  // Asi que se arma absoluta, con `host` --que ya paso por la lista de
  // permitidos-- y el esquema declarado por el proxy. Como el nombre esta
  // validado antes de llegar aca, no hay confianza ciega en la cabecera: un
  // `Host` inventado no llega a este punto.
  //
  // `pathname` viene de `req.nextUrl` y siempre empieza con `/`, asi que el
  // valor de `next` no puede convertirse en una redireccion a otro sitio.
  // `destinoSeguro()` en la pantalla de login lo vuelve a comprobar.
  const destino = new URL('/login', origenDe(req, host))
  if (pathname !== '/') destino.searchParams.set('next', pathname)

  const res = NextResponse.redirect(destino)
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
