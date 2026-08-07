/**
 * Validacion de entrada centralizada.
 *
 * Todos los esquemas son estrictos: una propiedad no declarada hace fallar la
 * peticion en vez de colarse hasta Prisma. Es lo que convertia
 * `prisma.user.create({ data: { ...body } })` en una escalada de privilegios.
 */

import { z } from 'zod'
import { invalid } from '@/server/http/errors'
import { monto, type Monto } from '@/lib/money'

/** Entero positivo, tambien desde string (parametros de ruta y query). */
export const idSchema = z.coerce.number().int().positive().max(2_147_483_647)

/**
 * Cantidad de unidades vendidas o ajustadas.
 *
 * `z.coerce.number()` rechaza NaN e Infinity por si mismo, pero lo dejamos
 * explicito porque es justamente lo que hoy pasa sin control: `Number(body.qty)`
 * con "abc" da NaN, y NaN sobrevive hasta el UPDATE.
 *
 * Entero por ahora. Cuando se agregue venta por peso (kg, g, l), este es el
 * unico lugar que cambia a decimal con precision fija.
 */
export const quantitySchema = z
  .number()
  .int('La cantidad debe ser un numero entero')
  .positive('La cantidad debe ser mayor que cero')
  .max(100_000, 'Cantidad fuera de rango')
  .finite()

/**
 * Importe de dinero. Positivo, con dos decimales como maximo.
 *
 * Acepta cadena o numero y SIEMPRE devuelve una cadena canonica --`"4850.00"`--
 * para que el servicio la pase a `Decimal` sin volver a tocarla.
 *
 * La cadena es la forma preferida y la que manda la aplicacion desde la Fase
 * 3. El numero se sigue aceptando por dos razones: hay clientes viejos que lo
 * mandan asi, y rechazarlo obligaria a una migracion coordinada de cliente y
 * servidor por un cambio que no lo necesita. Un numero de JSON con dos
 * decimales sobrevive el viaje sin perder nada; lo que rompia era operar con
 * el, y eso ya no pasa en ningun lado.
 *
 * `1e9` de tope: mas que eso no es una venta de almacen, es un dedo apoyado.
 */
export const amountSchema = z
  .union([z.string(), z.number()])
  .superRefine((valor, ctx) => {
    if (typeof valor === 'number' && !Number.isFinite(valor)) {
      ctx.addIssue({ code: 'custom', message: 'Importe invalido' })
      return
    }
    const texto = typeof valor === 'number' ? valor.toString() : valor.trim()
    if (!/^\d+(\.\d{1,2})?$/.test(texto)) {
      ctx.addIssue({
        code: 'custom',
        message: /^-/.test(texto)
          ? 'El importe no puede ser negativo'
          : 'El importe debe ser un numero con dos decimales como maximo',
      })
      return
    }
    if (Number(texto) > 1_000_000_000) {
      ctx.addIssue({ code: 'custom', message: 'Importe fuera de rango' })
    }
  })
  .transform((valor): Monto => monto(valor))

/** Texto corto obligatorio con longitud maxima. */
export const shortText = (max = 200) => z.string().trim().min(1).max(max)

/** Texto opcional que normaliza "" a null. */
export const optionalText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()

export const paymentMethodSchema = z.enum(['efectivo', 'tarjeta', 'mercado_pago'])

// La paginacion vive en '@/server/http/pagination', junto al contrato de
// respuesta { data, pagination } y a los limites de tamano de pagina.

/**
 * Parsea y valida el cuerpo JSON. Un cuerpo ausente o mal formado da 400,
 * no 500.
 */
export async function parseJsonBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw invalid('El cuerpo de la peticion debe ser JSON valido')
  }
  return parseWith(schema, raw)
}

/** Valida los parametros de query de la URL. */
export function parseQuery<T>(req: Request, schema: z.ZodType<T>): T {
  const params = Object.fromEntries(new URL(req.url).searchParams.entries())
  return parseWith(schema, params)
}

export function parseWith<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data

  // Se devuelve que campo fallo y por que, pero nunca el valor recibido:
  // podria contener una contrasena.
  const details = result.error.issues.map((issue) => ({
    campo: issue.path.join('.') || '(raiz)',
    problema: issue.message,
  }))
  throw invalid('Datos invalidos', details)
}
