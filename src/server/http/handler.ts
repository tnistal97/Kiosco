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
import { forbidden, type ApiErrorBody } from '@/server/http/errors'
import { traducirError } from '@/server/http/prismaErrors'
import { REQUEST_ID_HEADER, requestIdDe } from '@/server/http/requestId'
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
  /** Identificador de esta peticion. Va al log, a la auditoria y al error. */
  requestId: string
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
  // Devuelve una `Response` cuando la ruta necesita fijar el estado o una
  // cookie; cualquier otro valor se serializa como JSON con estado 200.
  fn: (ctx: RouteContext<A, TBody, TQuery>) => Promise<unknown>,
): NextRouteHandler {
  return async function route(req: NextRequest, args: NextRouteArgs): Promise<Response> {
    const requestId = requestIdDe(req)

    try {
      const session =
        config.auth === 'public' ? await getSessionQuietly(req) : await getSession(req)

      if (config.auth === 'session') {
        if (config.permission) {
          const needed = Array.isArray(config.permission) ? config.permission : [config.permission]
          requireAny(session, needed)
        } else {
          requireUser(session)
        }
      }

      const body = config.body ? await parseJsonBody(req, config.body) : (undefined as TBody)
      const query = config.query ? parseQuery(req, config.query) : (undefined as TQuery)
      const params = normalizarParams(await args.params)

      const result = await fn({
        req,
        // Seguro: si auth === 'session', requireUser/requireAny ya
        // garantizaron que no es null.
        session: session as SessionFor<A>,
        body,
        query,
        params,
        requestId,
        origin: config.audit,
      })

      const res = result instanceof Response ? result : NextResponse.json(result ?? { ok: true })
      res.headers.set(REQUEST_ID_HEADER, requestId)
      return res
    } catch (error) {
      return toErrorResponse(error, config.audit, requestId)
    }
  }
}

/**
 * Exige al menos uno de los permisos.
 *
 * Con uno solo el mensaje nombra ese permiso; con varios los enumera. Se
 * resuelve mirando la longitud de la lista dentro de la funcion en vez de
 * elegir la funcion desde afuera, para no tener que indexar `needed[0]`.
 */
function requireAny(session: Session | null, permissions: readonly Permission[]): void {
  const [unico, ...resto] = permissions

  if (unico === undefined) {
    // Lista de permisos vacia: se exige sesion y nada mas.
    requireUser(session)
    return
  }

  if (resto.length === 0) {
    requirePermission(session, unico)
    return
  }

  const user = requireUser(session)
  if (!permissions.some((p) => user.permissions.has(p))) {
    throw forbidden(`Falta alguno de los permisos: ${permissions.join(', ')}`)
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
 * Traduce cualquier error a la unica forma de respuesta de error que existe.
 *
 * Todo lo que no sea un AppError previsto pasa antes por `traducirError`,
 * que convierte los fallos de Prisma en mensajes escritos para el usuario.
 * El detalle tecnico --stack, SQL, nombres de tabla, ruta del servidor-- se
 * escribe en el log junto al requestId y no viaja nunca en la respuesta.
 */
function toErrorResponse(error: unknown, origin: string, requestId: string): Response {
  const appError = traducirError(error)

  // 5xx significa fallo nuestro: se registra entero, con la causa original.
  // 4xx es el uso normal del sistema (falta un permiso, falta stock) y no
  // merece ruido en el log; solo se deja rastro de los intentos rechazados
  // por autorizacion, que si interesan.
  if (appError.status >= 500) {
    console.error(`[${origin}] [${requestId}] ${appError.code}:`, error)
  } else if (appError.status === 401 || appError.status === 403) {
    console.warn(`[${origin}] [${requestId}] ${appError.code}: ${appError.message}`)
  }

  const cuerpo: ApiErrorBody = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
      ...(appError.details === undefined ? {} : { details: appError.details }),
    },
  }

  const res = NextResponse.json(cuerpo, { status: appError.status })
  res.headers.set(REQUEST_ID_HEADER, requestId)
  return res
}
