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

/** Rutas accesibles sin sesion. */
const PUBLIC_PATHS = new Set(['/login', '/api/auth/login', '/api/auth/logout'])

/** Prefijos de recursos que no pasan por la comprobacion. */
const PUBLIC_PREFIXES = ['/_next/', '/icons/', '/screenshots/']

/** Archivos sueltos servidos desde public/. */
const PUBLIC_FILES = new Set([
  '/favicon.ico',
  '/manifest.json',
  '/sw.js',
  '/workbox-sw.js',
  '/robots.txt',
])

function esPublica(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true
  if (PUBLIC_FILES.has(pathname)) return true
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true

  // Los archivos generados de Workbox llevan un hash en el nombre.
  if (/^\/workbox-[0-9a-f]+\.js$/.test(pathname)) return true

  return false
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

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

  const destino = new URL('/login', req.url)
  // Para volver a donde estaba despues de iniciar sesion. Solo rutas internas:
  // pasar una URL absoluta permitiria una redireccion abierta.
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
