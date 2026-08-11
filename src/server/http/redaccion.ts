/**
 * Lo que NO puede terminar escrito en un log.
 *
 * MOTIVO CONCRETO: el log de errores de 500 escribe el error original entero,
 * a proposito --sin el stack no se diagnostica nada--. Pero algunos errores
 * traen consigo cosas que no son diagnostico:
 *
 *   - `PrismaClientInitializationError` incluye la cadena de conexion COMPLETA,
 *     con la contraseña de la base, cuando el servidor no responde.
 *   - un error de `jose` puede arrastrar el secreto de firma.
 *   - un stack de una peticion de login puede llevar el cuerpo, con la clave.
 *
 * Y en el servidor esos logs viven en `logs/error.log`, que hoy tiene permisos
 * de lectura para cualquier usuario del sistema. Un secreto en un log es un
 * secreto publicado: no se puede "des-escribir".
 *
 * COMO: se tacha por VALOR, no por nombre de campo. Buscar claves llamadas
 * `password` no sirve --el problema es una cadena de conexion dentro de un
 * mensaje de texto, no un campo--. Se toman los secretos que el proceso conoce
 * y se reemplaza cada aparicion. Lo que el proceso no conoce no se puede
 * tachar, y por eso ademas se tachan las FORMAS reconocibles: cadenas de
 * conexion, cabeceras de autorizacion, cookies de sesion y JWT.
 */

import type { Entorno } from '@/server/env'

const TACHADO = '[REDACTADO]'

/** Minimo para tachar un secreto literal: por debajo, tachar destruye el log. */
const MIN_SECRETO = 8

/**
 * Formas reconocibles, independientes de lo que este en el entorno.
 *
 * Cubren el caso que importa: un secreto que este proceso no conoce --el de
 * otro servicio, uno que llego en una cabecera-- pero que se reconoce por su
 * forma.
 */
const FORMAS: { patron: RegExp; con: string }[] = [
  // Cadena de conexion de PostgreSQL: se conserva usuario, host y base; se
  // tacha SOLO la contraseña. El resto es diagnostico legitimo.
  { patron: /(postgres(?:ql)?:\/\/[^:@\s]+:)([^@\s]+)(@)/gi, con: `$1${TACHADO}$3` },
  // Authorization: Bearer / Basic
  { patron: /(authorization"?\s*[:=]\s*"?)(bearer|basic)\s+[\w.\-+/=]+/gi, con: `$1$2 ${TACHADO}` },
  // Cookie de sesion del proyecto.
  { patron: /(\btoken=)[\w.\-+/=]+/gi, con: `$1${TACHADO}` },
  // Un JWT suelto: tres bloques base64url separados por puntos.
  { patron: /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, con: TACHADO },
  // Campos de clave en un JSON serializado.
  {
    patron: /("(?:password|contrasena|secret|jwt_secret)"\s*:\s*)"[^"]*"/gi,
    con: `$1"${TACHADO}"`,
  },
]

/**
 * Los secretos que este proceso conoce, tal como estan en el entorno.
 *
 * Se lee en cada llamada y no al importar: las pruebas cambian el entorno, y
 * un valor congelado al arrancar dejaria de tachar justo lo que cambio.
 */
function secretosConocidos(env: Entorno): string[] {
  const url = env.DATABASE_URL ?? ''
  const contrasenaDeLaBase = /postgres(?:ql)?:\/\/[^:@\s]+:([^@\s]+)@/i.exec(url)?.[1] ?? ''

  return (
    [env.JWT_SECRET ?? '', url, contrasenaDeLaBase]
      .filter((s) => s.length >= MIN_SECRETO)
      // Los mas largos primero: tachar la URL entera antes que su contraseña
      // deja un solo `[REDACTADO]` en vez de uno adentro de otro.
      .sort((a, b) => b.length - a.length)
  )
}

/** Tacha secretos en un texto. */
export function redactar(texto: string, env: Entorno = process.env): string {
  let salida = texto

  for (const secreto of secretosConocidos(env)) {
    salida = salida.replaceAll(secreto, TACHADO)
  }
  for (const { patron, con } of FORMAS) {
    salida = salida.replace(patron, con)
  }

  return salida
}

/**
 * Lo que se le pasa a `console.error` en lugar del error crudo.
 *
 * Devuelve una CADENA y no el error: un objeto Error lo serializa la consola
 * despues, y para entonces ya no se puede tachar nada. Se pierde el formato
 * con colores de la consola y se gana que el stack pase por el filtro.
 */
export function paraLog(valor: unknown, env: Entorno = process.env): string {
  return redactar(textoDe(valor), env)
}

/** Cualquier cosa a texto, sin lanzar nunca. */
function textoDe(valor: unknown): string {
  if (valor instanceof Error) {
    const base = valor.stack ?? `${valor.name}: ${valor.message}`
    // `cause` no entra en el stack y suele ser donde vive el error de red.
    // Se serializa recursivamente y no con `String`: una causa que sea un
    // objeto daria "[object Object]" y se perderia justo el dato util.
    return valor.cause === undefined ? base : `${base}\ncausa: ${textoDe(valor.cause)}`
  }
  if (typeof valor === 'string') return valor
  try {
    // Una estructura circular hace lanzar a JSON.stringify; ahi al menos queda
    // el tipo, que es mas de lo que da un log vacio.
    return JSON.stringify(valor)
  } catch {
    return Object.prototype.toString.call(valor)
  }
}
