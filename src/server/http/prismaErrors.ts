/**
 * Traduccion de errores de Prisma a errores de aplicacion.
 *
 * Un error de Prisma sin traducir es una fuga de informacion. El mensaje de
 * `PrismaClientKnownRequestError` incluye el nombre de la tabla, el de la
 * columna y a veces un fragmento de la consulta:
 *
 *   Unique constraint failed on the fields: (`barcode`)
 *   Invalid `prisma.user.create()` invocation in /var/www/kiosco/...
 *
 * Eso describe el esquema de la base a cualquiera que provoque el error a
 * proposito, y en el segundo caso tambien la ruta de instalacion del
 * servidor. Aca se convierte en un mensaje escrito para el usuario; el
 * original viaja en `cause` y solo llega al log.
 */

import { Prisma } from '@prisma/client'
import { AppError, ConflictError, DatabaseError, NotFoundError, ValidationError } from './errors'

/** Campos cuyo choque de unicidad sabemos explicar en castellano. */
const MENSAJE_POR_CAMPO: Record<
  string,
  { code: 'DUPLICATE_BARCODE' | 'DUPLICATE_USERNAME'; texto: string }
> = {
  barcode: { code: 'DUPLICATE_BARCODE', texto: 'Ya existe un producto con ese codigo de barras' },
  username: { code: 'DUPLICATE_USERNAME', texto: 'Ese nombre de usuario ya esta en uso' },
}

/** Extrae los campos de `meta.target` sin confiar en su tipo. */
function camposDe(meta: unknown): string[] {
  if (typeof meta !== 'object' || meta === null || !('target' in meta)) return []
  const target: unknown = meta.target
  if (Array.isArray(target)) return target.filter((t): t is string => typeof t === 'string')
  if (typeof target === 'string') return [target]
  return []
}

/**
 * Convierte cualquier excepcion en un AppError.
 *
 * Lo que ya es AppError pasa sin tocarse: el servicio decidio que mensaje
 * corresponde y esa decision manda sobre esta traduccion generica.
 */
export function traducirError(error: unknown): AppError {
  if (error instanceof AppError) return error

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return traducirConocido(error)
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    // Llego al motor una consulta mal formada: es un error de programacion,
    // no del usuario. El mensaje trae el esquema entero, asi que no se usa.
    return new DatabaseError('La operacion no es valida.', { cause: error })
  }

  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return new DatabaseError('La base de datos no esta disponible. Intente en unos minutos.', {
      cause: error,
    })
  }

  return new AppError(500, 'INTERNAL', 'Error interno del servidor', { cause: error })
}

function traducirConocido(error: Prisma.PrismaClientKnownRequestError): AppError {
  const campos = camposDe(error.meta)

  switch (error.code) {
    // Choque de restriccion unica.
    case 'P2002': {
      for (const campo of campos) {
        const conocido = MENSAJE_POR_CAMPO[campo]
        if (conocido) {
          return new ConflictError(conocido.texto, { code: conocido.code, cause: error })
        }
      }
      // Campo no catalogado: mensaje generico, sin nombrarlo.
      return new ConflictError('Ya existe un registro con esos datos', { cause: error })
    }

    // Clave foranea: se apunta a algo que no existe.
    case 'P2003':
      return new ValidationError('Alguno de los datos relacionados no existe', { cause: error })

    // Se intento borrar algo de lo que todavia dependen otros registros.
    case 'P2014':
      return new ConflictError('No se puede eliminar: hay registros que dependen de este', {
        cause: error,
      })

    // El registro que la operacion esperaba encontrar no existe.
    case 'P2025':
      return new NotFoundError('No encontrado', { cause: error })

    // Valor mas largo que la columna.
    case 'P2000':
      return new ValidationError('Alguno de los valores es demasiado largo', { cause: error })

    // Fuera del rango que admite la columna.
    case 'P2020':
      return new ValidationError('Alguno de los valores esta fuera del rango permitido', {
        cause: error,
      })

    // Tiempo agotado esperando una conexion del pool.
    case 'P2024':
      return new DatabaseError('El sistema esta con mucha carga. Intente nuevamente.', {
        cause: error,
      })

    // Interbloqueo o fallo de serializacion: reintentar suele bastar.
    case 'P2034':
      return new ConflictError('La operacion se cruzo con otra. Intente nuevamente.', {
        cause: error,
      })

    default:
      return new DatabaseError(undefined, { cause: error })
  }
}
