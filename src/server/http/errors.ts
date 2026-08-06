/**
 * Errores de aplicacion con traduccion unica a HTTP.
 *
 * Regla: los handlers lanzan AppError, nunca arman respuestas de error a mano.
 * Asi un mismo fallo devuelve siempre el mismo codigo y el mismo cuerpo, y
 * ningun detalle interno (stack, mensaje de Prisma, nombre de tabla) se filtra
 * al cliente.
 */

export type AppErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'

const HTTP_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION: 400,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
}

export class AppError extends Error {
  readonly code: AppErrorCode
  /** Detalle seguro para mostrar al usuario. Nunca incluir datos internos. */
  readonly details?: unknown

  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'AppError'
    this.code = code
    this.details = details
  }

  get status(): number {
    return HTTP_STATUS[this.code]
  }
}

export const unauthenticated = (message = 'No autenticado') =>
  new AppError('UNAUTHENTICATED', message)

export const forbidden = (message = 'No tiene permiso para realizar esta accion') =>
  new AppError('FORBIDDEN', message)

export const notFound = (message = 'No encontrado') => new AppError('NOT_FOUND', message)

export const invalid = (message: string, details?: unknown) =>
  new AppError('VALIDATION', message, details)

export const conflict = (message: string) => new AppError('CONFLICT', message)

export const rateLimited = (message = 'Demasiados intentos. Espere unos minutos.') =>
  new AppError('RATE_LIMITED', message)
