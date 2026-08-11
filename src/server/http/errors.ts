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
  /** Tiene historial en el libro de inventario: se da de baja, no se borra. */
  | 'PRODUCT_HAS_MOVEMENTS'
  /** Tiene cambios de costo registrados, y ese historial es inmutable. */
  | 'PRODUCT_HAS_COST_HISTORY'
  /**
   * Su unidad de venta ya no se puede cambiar: tiene cantidades guardadas en
   * la unidad anterior y cambiarla reescribiria el significado de su pasado.
   */
  | 'PRODUCT_UNIT_LOCKED'
  /** `1.235` unidades no existe. La unidad no admite esa fraccion. */
  | 'INVALID_QUANTITY_FOR_UNIT'
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
  // Proveedores y compras. Ver docs/PURCHASE_FLOW.md.
  /** Tiene ordenes o productos asociados: se desactiva, no se borra. */
  | 'SUPPLIER_HAS_HISTORY'
  /** Esta dado de baja: no se le puede comprar. */
  | 'SUPPLIER_INACTIVE'
  | 'DUPLICATE_SUPPLIER'
  /** Su estado no admite el cambio que se pidio. */
  | 'ORDER_NOT_EDITABLE'
  | 'ORDER_NOT_RECEIVABLE'
  | 'ORDER_NOT_CANCELLABLE'
  /** Se intento recibir mas de lo que quedaba pendiente. */
  | 'OVER_RECEIPT'
  /**
   * La conversion de unidad de compra a unidad de venta da una cantidad que
   * esa unidad no admite: 3 packs de 2,5 en un producto por unidad son 7,5
   * unidades, y media unidad no existe.
   */
  | 'INVALID_PURCHASE_CONVERSION'
  // Clientes y cuenta corriente. Ver docs/CREDIT_POLICY.md.
  /** Tiene ventas, pagos o movimientos: se da de baja, no se borra. */
  | 'CLIENT_HAS_HISTORY'
  | 'DUPLICATE_CLIENT'
  /** Esta dado de baja: no se le puede fiar. */
  | 'CLIENT_INACTIVE'
  /** Sigue comprando de contado, pero tiene el fiado cortado. */
  | 'CLIENT_CREDIT_DISABLED'
  /** La venta lo dejaria por encima de su limite. Se puede autorizar. */
  | 'CREDIT_LIMIT_EXCEEDED'
  /** Una venta con parte a cuenta necesita saber a quien se le fia. */
  | 'ACCOUNT_SALE_NEEDS_CLIENT'
  /** El cobro deja saldo a favor y nadie lo confirmo todavia. */
  | 'PAYMENT_LEAVES_CREDIT'
  /**
   * El saldo no se movio y ninguna de las causas conocidas lo explica.
   * No deberia ocurrir: existe para no devolver un 500 mudo si ocurre.
   */
  | 'ACCOUNT_NOT_MOVED'
  // Cuentas por pagar a proveedores. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
  /**
   * El pago deja saldo a favor NUESTRO y nadie lo confirmo todavia.
   *
   * Codigo propio y no el `PAYMENT_LEAVES_CREDIT` del cliente, aunque el
   * mecanismo se parezca: el navegador reacciona distinto a cada uno --alla
   * alcanza con confirmar, aca ademas hace falta permiso-- y darles el mismo
   * codigo obligaria a mirar de que endpoint vino para saber que ofrecer.
   */
  | 'SUPPLIER_PAYMENT_LEAVES_CREDIT'
  /** Se quiso imputar a una entrega que no es una obligacion abierta suya. */
  | 'ALLOCATION_TARGET_INVALID'
  /** Se quiso imputar a una entrega mas de lo que le falta. */
  | 'ALLOCATION_EXCEEDS_DEBT'
  /** El reparto suma mas que el pago. */
  | 'ALLOCATION_EXCEEDS_PAYMENT'
  /**
   * La recepcion es anterior a las cuentas por pagar: no tiene obligacion.
   * Ver `PurchaseReceipt.debtRecorded`.
   */
  | 'RECEIPT_NOT_TRACKED'

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
