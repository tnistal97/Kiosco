/**
 * Errores de aplicacion con traduccion unica a HTTP.
 *
 * Regla: los servicios y los handlers lanzan una de estas clases, nunca arman
 * respuestas de error a mano. Asi un mismo fallo devuelve siempre el mismo
 * estado y el mismo cuerpo, y ningun detalle interno (stack, mensaje de
 * Prisma, nombre de tabla, fragmento de SQL) llega al navegador.
 *
 * El cuerpo que ve el cliente es siempre:
 *
 *   { "error": { "code": "INSUFFICIENT_STOCK",
 *                "message": "No hay stock suficiente",
 *                "requestId": "3f1c..." } }
 *
 * `code` es para el programa: permite reaccionar a una condicion concreta sin
 * comparar textos. `message` es para la persona. `requestId` es el hilo que
 * une lo que vio el usuario con la linea del log del servidor.
 */

/**
 * Catalogo cerrado de codigos.
 *
 * Cerrado a proposito: si fueran cadenas libres, cada ruta inventaria la suya
 * y el cliente no podria confiar en ninguna. Agregar un caso nuevo obliga a
 * agregarlo aca, que es donde se ve el conjunto completo.
 */
export type ErrorCode =
  // Genericos, uno por categoria.
  | 'VALIDATION'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'DATABASE'
  // Especificos de dominio. El cliente puede tratarlos distinto.
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_DISABLED'
  | 'SESSION_EXPIRED'
  | 'INSUFFICIENT_STOCK'
  | 'PRODUCT_NOT_IN_BRANCH'
  | 'SALE_ALREADY_CANCELED'
  | 'SALE_NOT_CANCELABLE'
  | 'PRODUCT_HAS_SALES'
  | 'DUPLICATE_BARCODE'
  | 'DUPLICATE_USERNAME'
  | 'INSUFFICIENT_CASH'
  | 'CASH_REGISTER_MISMATCH'
  // Turnos de caja. Ver docs/CASH_SHIFT_MODEL.md.
  | 'NO_OPEN_SHIFT'
  | 'SHIFT_ALREADY_OPEN'
  | 'SHIFT_ALREADY_CLOSED'
  | 'LEGACY_SHIFT'
  | 'DIFFERENCE_NEEDS_AUTHORIZATION'
  // Pagos de una venta.
  | 'PAYMENTS_DO_NOT_MATCH_TOTAL'

/** Forma exacta del cuerpo de error. Compartida con el cliente. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    requestId: string
    /**
     * Solo en errores de validacion: que campo fallo y por que.
     * Nunca contiene el valor recibido, que podria ser una contrasena.
     */
    details?: unknown
  }
}

export interface AppErrorOptions {
  /** Codigo especifico. Si se omite se usa el generico de la clase. */
  code?: ErrorCode
  /** Detalle seguro de mostrar. Nunca datos internos. */
  details?: unknown
  /** Error original. Va al log del servidor, nunca a la respuesta. */
  cause?: unknown
}

/**
 * Base de todos los errores previstos.
 *
 * "Previsto" significa que el mensaje fue escrito para que lo lea un usuario.
 * Cualquier excepcion que no herede de esta clase se considera un fallo
 * interno y se responde con un mensaje generico.
 */
export class AppError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(status: number, code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = new.target.name
    this.status = status
    this.code = options.code ?? code
    this.details = options.details
  }
}

/** 400 — la entrada no cumple el esquema o viola una regla de forma. */
export class ValidationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(400, 'VALIDATION', message, options)
  }
}

/** 401 — no hay sesion, o la que hay ya no vale. */
export class AuthenticationError extends AppError {
  constructor(message = 'No autenticado', options: AppErrorOptions = {}) {
    super(401, 'UNAUTHENTICATED', message, options)
  }
}

/** 403 — hay sesion, pero no alcanza para esta operacion. */
export class AuthorizationError extends AppError {
  constructor(
    message = 'No tiene permiso para realizar esta accion',
    options: AppErrorOptions = {},
  ) {
    super(403, 'FORBIDDEN', message, options)
  }
}

/** 404 — no existe, o existe en otra sucursal y no corresponde revelarlo. */
export class NotFoundError extends AppError {
  constructor(message = 'No encontrado', options: AppErrorOptions = {}) {
    super(404, 'NOT_FOUND', message, options)
  }
}

/** 409 — el estado actual del sistema impide la operacion. */
export class ConflictError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(409, 'CONFLICT', message, options)
  }
}

/** 429 — demasiados intentos. */
export class RateLimitError extends AppError {
  constructor(
    message = 'Demasiados intentos. Espere unos minutos.',
    options: AppErrorOptions = {},
  ) {
    super(429, 'RATE_LIMITED', message, options)
  }
}

/**
 * 500 — fallo de la base de datos ya identificado.
 *
 * El mensaje que se pasa aca es el que vera el usuario, asi que tiene que
 * estar escrito para el. El detalle tecnico va en `cause` y solo al log.
 */
export class DatabaseError extends AppError {
  constructor(
    message = 'No se pudo completar la operacion. Intente nuevamente.',
    options: AppErrorOptions = {},
  ) {
    super(500, 'DATABASE', message, options)
  }
}

// ---------------------------------------------------------------------------
// Atajos. Existian en la Fase 0 y se conservan porque las rutas ya los usan.
// ---------------------------------------------------------------------------

export const unauthenticated = (message?: string, options?: AppErrorOptions) =>
  new AuthenticationError(message, options)

export const forbidden = (message?: string, options?: AppErrorOptions) =>
  new AuthorizationError(message, options)

export const notFound = (message?: string, options?: AppErrorOptions) =>
  new NotFoundError(message, options)

export const invalid = (message: string, details?: unknown, options: AppErrorOptions = {}) =>
  new ValidationError(message, { ...options, details })

export const conflict = (message: string, options?: AppErrorOptions) =>
  new ConflictError(message, options)

export const rateLimited = (message?: string, options?: AppErrorOptions) =>
  new RateLimitError(message, options)
