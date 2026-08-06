/**
 * Identificador de peticion.
 *
 * Cada peticion recibe uno. Aparece en tres lugares a la vez:
 *
 *   - la cabecera `x-request-id` de la respuesta
 *   - el cuerpo de los errores que ve el usuario
 *   - la linea del log del servidor y la entrada de auditoria
 *
 * Sirve para que "me dio error" se convierta en algo investigable: el usuario
 * dice el codigo y aparece exactamente la peticion que fallo, con su stack
 * completo, sin haberle mostrado nada de eso.
 */

const HEADER = 'x-request-id'

/** Formato aceptado si el proxy ya trae uno: solo hex y guiones, hasta 64. */
const FORMATO_VALIDO = /^[a-fA-F0-9-]{8,64}$/

/**
 * Toma el de la cabecera si viene de confianza y tiene forma valida; si no,
 * genera uno nuevo.
 *
 * Se valida el formato porque el valor termina en los logs: aceptarlo crudo
 * permitiria a un cliente inyectar saltos de linea y falsificar entradas.
 */
export function requestIdDe(req: Request): string {
  const entrante = req.headers.get(HEADER)
  if (entrante && FORMATO_VALIDO.test(entrante)) return entrante
  return crypto.randomUUID()
}

export const REQUEST_ID_HEADER = HEADER
