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
import { AppError, forbidden, type ApiErrorBody } from '@/server/http/errors'
import { ipDe, runWithRequestContext } from '@/server/http/requestContext'
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
 *
 * El tipo miente sobre la ejecucion, y hay que saberlo: Next solo pasa ese
 * argumento a las rutas con segmento dinamico. A las demas --que son casi
 * todas-- las llama con un unico argumento. Declararlo opcional haria que el
 * verificador de rutas rechace el build, asi que el que se defiende es el
 * handler, con un valor por omision.
 */
export type NextRouteArgs = {
  params: Promise<Record<string, string | string[] | undefined>>
}
type NextRouteHandler = (req: NextRequest, args: NextRouteArgs) => Promise<Response>

/**
 * Lo que recibe una ruta sin segmento dinamico.
 *
 * Confiar en el tipo, y hacer `await args.params` sin mas, dejaba toda la API
 * respondiendo 500 en el navegador con las pruebas en verde: el ayudante de
 * tests construia siempre un `params` vacio, es decir, probaba una forma de
 * llamada que en ejecucion no ocurre nunca.
 */
const SIN_PARAMETROS: NextRouteArgs = { params: Promise.resolve({}) }

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
  return async function route(
    req: NextRequest,
    args: NextRouteArgs = SIN_PARAMETROS,
  ): Promise<Response> {
    const requestId = requestIdDe(req)

    // Todo lo que ocurra dentro --incluidos los servicios y `audit()`-- ve
    // este contexto sin que haya que pasarlo como parametro.
    return runWithRequestContext({ requestId, ip: ipDe(req) }, async () => {
      try {
        const session =
          config.auth === 'public' ? await getSessionQuietly(req) : await getSession(req)

        if (config.auth === 'session') {
          if (config.permission) {
            const needed = Array.isArray(config.permission)
              ? config.permission
              : [config.permission]
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
        // Un intento rechazado por falta de permiso deja rastro: es
        // justamente el que interesa mirar despues.
        await auditarRechazo(error, config, req)
        return toErrorResponse(error, config.audit, requestId)
      }
    })
  }
}

/**
 * Registra en la bitacora los intentos rechazados por autorizacion.
 *
 * Solo 403: un 401 significa que no hay sesion, y sin usuario no hay a quien
 * atribuir la entrada (AuditLog.userId es obligatorio). Esos quedan en el
 * log del servidor con su requestId.
 *
 * Nunca propaga su propio error: si falla el registro del rechazo, el
 * rechazo tiene que responderse igual.
 */
async function auditarRechazo(
  error: unknown,
  config: { audit: string },
  req: NextRequest,
): Promise<void> {
  if (!(error instanceof AppError) || error.status !== 403) return

  try {
    const session = await getSessionQuietly(req)
    if (!session) return

    const { prisma } = await import('@/lib/prisma')
    const { audit } = await import('@/server/audit/audit')

    await audit(prisma, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Authorization',
      action: 'deny',
      result: 'failure',
      reason: error.message,
      after: { rol: session.role },
      origin: config.audit,
    })
  } catch (fallo) {
    console.error('[audit] No se pudo registrar el rechazo:', fallo)
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
