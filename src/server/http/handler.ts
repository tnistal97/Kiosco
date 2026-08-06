/**
 * Envoltorio unico de las rutas de API.
 *
 * Cada ruta declara de forma explicita:
 *   - auth        si es publica o exige sesion
 *   - permission  que permiso hace falta
 *   - body/query  con que esquema se valida la entrada
 *   - audit       nombre de la operacion, usado en la bitacora y en los logs
 *
 * Nada de eso queda implicito ni depende de que el middleware haya corrido.
 * La autorizacion se comprueba aca, en el servidor, en cada peticion.
 */

import { NextResponse, type NextRequest } from 'next/server'
import type { z } from 'zod'
import { getSession, type Session } from '@/server/auth/session'
import { requirePermission, requireUser } from '@/server/authz/require'
import type { Permission } from '@/server/authz/permissions'
import { AppError } from '@/server/http/errors'
import { parseJsonBody, parseQuery } from '@/server/http/validate'

type AuthMode = 'public' | 'session'

/** Con `auth: 'session'` la sesion nunca es null dentro del handler. */
type SessionFor<A extends AuthMode> = A extends 'session' ? Session : Session | null

export interface RouteConfig<A extends AuthMode, TBody, TQuery> {
  /** `public` solo para login, logout y validate. Todo lo demas es `session`. */
  auth: A
  /** Permiso exigido. Si se pasa una lista, alcanza con tener uno. */
  permission?: Permission | readonly Permission[]
  body?: z.ZodType<TBody>
  query?: z.ZodType<TQuery>
  /** Identificador de la operacion, p. ej. "POST /api/sales". */
  audit: string
}

export interface RouteContext<A extends AuthMode, TBody, TQuery> {
  req: NextRequest
  session: SessionFor<A>
  body: TBody
  query: TQuery
  /** Parametros de ruta ya resueltos, p. ej. { id: "12" }. */
  params: Record<string, string | undefined>
  /** Igual que config.audit. Se pasa a `audit()` como origen. */
  origin: string
}

/**
 * Forma exacta que exige el verificador de tipos de rutas de Next 15: el
 * segundo argumento es obligatorio y `params` es una promesa.
 */
export type NextRouteArgs = {
  params: Promise<Record<string, string | string[] | undefined>>
}
type NextRouteHandler = (req: NextRequest, args: NextRouteArgs) => Promise<Response>

/** Rutas catch-all pueden traer arrays; ninguna del proyecto lo hace hoy. */
function normalizarParams(
  crudos: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const salida: Record<string, string | undefined> = {}
  for (const [clave, valor] of Object.entries(crudos)) {
    salida[clave] = Array.isArray(valor) ? valor[0] : valor
  }
  return salida
}

export function handler<A extends AuthMode, TBody = undefined, TQuery = undefined>(
  config: RouteConfig<A, TBody, TQuery>,
  fn: (ctx: RouteContext<A, TBody, TQuery>) => Promise<Response | unknown>,
): NextRouteHandler {
  return async function route(req: NextRequest, args: NextRouteArgs): Promise<Response> {
    try {
      const session =
        config.auth === 'public' ? await getSessionQuietly(req) : await getSession(req)

      if (config.auth === 'session') {
        if (config.permission) {
          const needed = Array.isArray(config.permission) ? config.permission : [config.permission]
          // Con un solo permiso el mensaje de error es mas util.
          if (needed.length === 1) {
            requirePermission(session, needed[0]!)
          } else {
            requireAny(session, needed)
          }
        } else {
          requireUser(session)
        }
      }

      const body = config.body ? await parseJsonBody(req, config.body) : (undefined as TBody)
      const query = config.query ? parseQuery(req, config.query) : (undefined as TQuery)
      const params = args?.params ? normalizarParams(await args.params) : {}

      const result = await fn({
        req,
        // Seguro: si auth === 'session', requireUser/requirePermission ya
        // garantizaron que no es null.
        session: session as SessionFor<A>,
        body: body as TBody,
        query: query as TQuery,
        params,
        origin: config.audit,
      })

      if (result instanceof Response) return result
      return NextResponse.json(result ?? { ok: true })
    } catch (error) {
      return toErrorResponse(error, config.audit)
    }
  }
}

function requireAny(session: Session | null, permissions: readonly Permission[]): void {
  const user = requireUser(session)
  if (!permissions.some((p) => user.permissions.has(p))) {
    throw new AppError('FORBIDDEN', `Falta alguno de los permisos: ${permissions.join(', ')}`)
  }
}

/** En rutas publicas la sesion es informativa: si falla, simplemente no hay. */
async function getSessionQuietly(req: NextRequest): Promise<Session | null> {
  try {
    return await getSession(req)
  } catch {
    return null
  }
}

/**
 * Traduce cualquier error a una respuesta HTTP.
 *
 * Los errores no previstos devuelven 500 con un mensaje generico: el detalle
 * va al log del servidor, nunca al cliente. Antes varias rutas devolvian
 * `error.message` crudo, que en el caso de Prisma incluye nombres de tabla,
 * de columna y fragmentos de la consulta.
 */
function toErrorResponse(error: unknown, origin: string): Response {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, ...(error.details ? { detalles: error.details } : {}) },
      { status: error.status },
    )
  }

  console.error(`[${origin}] Error no controlado:`, error)
  return NextResponse.json({ error: 'Error interno del servidor' }, { status: 500 })
}
