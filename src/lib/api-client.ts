/**
 * Cliente HTTP del navegador.
 *
 * Existe por dos motivos.
 *
 * El primero es de tipos. `await res.json()` devuelve `any`, y ese `any` se
 * propaga: `data.error`, `data.productos.map(...)` y todo lo que siga deja de
 * comprobarse. Era el origen de 81 de los hallazgos de ESLint. Aca el `any`
 * se detiene en un unico lugar: `parse` recibe `unknown` y el llamador dice
 * que forma espera.
 *
 * El segundo es de errores. Antes cada pantalla extraia el mensaje a mano
 * (`err.error || 'Error al...'`), con un texto distinto por sitio y sin
 * distinguir un 401 de un 409. Ahora todas reciben un `ApiError` con codigo,
 * mensaje y requestId.
 */

import type { ApiErrorBody, ErrorCode } from '@/server/http/errors'

/** Error de una respuesta HTTP con el contrato del servidor ya interpretado. */
export class ApiError extends Error {
  readonly code: ErrorCode
  readonly status: number
  readonly requestId: string
  readonly details?: unknown

  constructor(args: {
    code: ErrorCode
    message: string
    status: number
    requestId: string
    details?: unknown
  }) {
    super(args.message)
    this.name = 'ApiError'
    this.code = args.code
    this.status = args.status
    this.requestId = args.requestId
    this.details = args.details
  }

  /** true si conviene mandar al usuario a iniciar sesion de nuevo. */
  get esSesionVencida(): boolean {
    return this.status === 401
  }
}

/** Error de red: no hubo respuesta. Distinto de "el servidor dijo que no". */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super('No se pudo conectar con el servidor. Revise la conexion.', { cause })
    this.name = 'NetworkError'
  }
}

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Se serializa como JSON. */
  body?: unknown
  /** Convierte la respuesta cruda en el tipo esperado. */
  parse: (data: unknown) => T
  signal?: AbortSignal
}

/** Comprueba que el cuerpo tenga la forma del contrato de error. */
function esCuerpoDeError(data: unknown): data is ApiErrorBody {
  if (typeof data !== 'object' || data === null || !('error' in data)) return false
  const error: unknown = data.error
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof (error as { message: unknown }).message === 'string'
  )
}

async function leerJson(res: Response): Promise<unknown> {
  const texto = await res.text()
  if (!texto) return null
  try {
    return JSON.parse(texto) as unknown
  } catch {
    return null
  }
}

/**
 * Hace la peticion y devuelve el cuerpo ya tipado, o lanza.
 *
 * Lanza `ApiError` si el servidor respondio con un error, y `NetworkError` si
 * no hubo respuesta. Ninguna de las dos deja pasar un `any`.
 */
export async function apiRequest<T>(path: string, options: RequestOptions<T>): Promise<T> {
  const { method = 'GET', body, parse, signal } = options

  let res: Response
  try {
    res = await fetch(path, {
      method,
      credentials: 'include',
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    })
  } catch (causa) {
    // AbortError no es un fallo: lo pidio el propio componente al desmontarse.
    if (causa instanceof DOMException && causa.name === 'AbortError') throw causa
    throw new NetworkError(causa)
  }

  const data = await leerJson(res)

  if (!res.ok) {
    if (esCuerpoDeError(data)) {
      throw new ApiError({
        code: data.error.code,
        message: data.error.message,
        status: res.status,
        requestId: data.error.requestId || res.headers.get('x-request-id') || '',
        details: data.error.details,
      })
    }
    // Respuesta de error que no sigue el contrato: no deberia ocurrir dentro
    // de la aplicacion, pero si puede venir de nginx o de un proxy.
    throw new ApiError({
      code: 'INTERNAL',
      message: `Error del servidor (${res.status})`,
      status: res.status,
      requestId: res.headers.get('x-request-id') ?? '',
    })
  }

  return parse(data)
}

// ---------------------------------------------------------------------------
// Ayudantes de lectura
//
// Convierten `unknown` en tipos concretos comprobando de verdad. No son un
// validador completo --para eso esta Zod en el servidor-- sino lo justo para
// que el navegador no explote si la respuesta no tiene la forma esperada.
// ---------------------------------------------------------------------------

export function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function texto(v: unknown, porDefecto = ''): string {
  return typeof v === 'string' ? v : porDefecto
}

export function numero(v: unknown, porDefecto = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : porDefecto
}

export function booleano(v: unknown, porDefecto = false): boolean {
  return typeof v === 'boolean' ? v : porDefecto
}

export function textoOpcional(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

export function numeroOpcional(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Aplica `fn` a cada elemento si `v` es un array; si no, devuelve []. */
export function lista<T>(v: unknown, fn: (item: unknown) => T): T[] {
  return Array.isArray(v) ? v.map(fn) : []
}

/** Mensaje legible de cualquier excepcion, para mostrar en un toast. */
export function mensajeDeError(error: unknown, porDefecto = 'Ocurrio un error inesperado'): string {
  if (error instanceof ApiError || error instanceof NetworkError) return error.message
  if (error instanceof Error && error.message) return error.message
  return porDefecto
}
