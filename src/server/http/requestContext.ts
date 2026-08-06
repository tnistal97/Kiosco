/**
 * Contexto de la peticion en curso.
 *
 * Guarda el requestId y la direccion de origen para que `audit()` los
 * escriba sin que haya que pasarlos como parametro por toda la cadena de
 * llamadas. Un servicio que registra un ajuste de stock no deberia tener que
 * recibir el requestId solo para reenviarlo.
 *
 * Usa AsyncLocalStorage, que es el mecanismo de Node para esto: cada peticion
 * ve su propio valor aunque haya muchas en vuelo a la vez. Funciona porque
 * todas las rutas declaran `runtime = 'nodejs'`. En el Edge no existe, y por
 * eso el middleware no lo usa.
 *
 * Si no hay contexto --por ejemplo en un script de mantenimiento que llama a
 * un servicio directamente-- las funciones devuelven null y la auditoria se
 * escribe igual, sin esos campos. Nunca falla por esto.
 */

import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  /** Direccion de origen ya normalizada. Puede ser null detras de un proxy mal configurado. */
  ip: string | null
}

const almacen = new AsyncLocalStorage<RequestContext>()

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return almacen.run(ctx, fn)
}

export function currentRequestId(): string | null {
  return almacen.getStore()?.requestId ?? null
}

export function currentIp(): string | null {
  return almacen.getStore()?.ip ?? null
}

/**
 * Direccion de origen de la peticion.
 *
 * Detras de nginx llega en X-Forwarded-For. Se toma el primer elemento y se
 * descarta si queda vacio: una cadena vacia no identifica a nadie y agruparia
 * en un mismo valor a todos los clientes de un proxy mal configurado.
 *
 * Se recorta a 45 caracteres, que es lo que ocupa una IPv6 con zona: el valor
 * termina en la base y en los logs, y sin limite un cliente podria mandar una
 * cabecera de megabytes.
 */
export function ipDe(req: Request): string | null {
  const primero = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (primero) return primero.slice(0, 45)
  const real = req.headers.get('x-real-ip')?.trim()
  return real ? real.slice(0, 45) : null
}
