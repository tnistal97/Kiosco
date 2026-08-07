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
import { cantidad, CANTIDAD_MAX, type TextoCantidad } from '@/lib/cantidad'
import { MEDIOS_DE_PAGO, normalizarMedio } from '@/modules/sales/payment-methods'

/** Entero positivo, tambien desde string (parametros de ruta y query). */
export const idSchema = z.coerce.number().int().positive().max(2_147_483_647)

/**
 * Cantidad de mercaderia vendida, ajustada o contada.
 *
 * Decimal desde la Fase 3B: 0,425 kg de queso es una linea de ticket valida.
 * Acepta cadena o numero y SIEMPRE devuelve una cadena canonica --`"0.425"`--
 * para que el servicio la pase a `Decimal` sin volver a tocarla, igual que
 * `amountSchema` con el dinero.
 *
 * Lo que comprueba aca es LA FORMA: positiva, hasta tres decimales, dentro de
 * rango. Lo que NO puede comprobar aca es si esa cantidad es valida para SU
 * unidad --que `1.235` no vale para un producto que se vende por unidad--,
 * porque para eso hay que conocer el producto. Esa mitad la hace el servicio
 * con `motivoDeCantidadInvalida`, y tiene sus pruebas.
 */
export const quantitySchema = z
  .union([z.string(), z.number()])
  .superRefine((valor, ctx) => {
    if (typeof valor === 'number' && !Number.isFinite(valor)) {
      ctx.addIssue({ code: 'custom', message: 'Cantidad invalida' })
      return
    }
    const texto = typeof valor === 'number' ? valor.toString() : valor.trim()
    if (!/^\d+(\.\d{1,3})?$/.test(texto)) {
      ctx.addIssue({
        code: 'custom',
        message: /^-/.test(texto)
          ? 'La cantidad no puede ser negativa'
          : 'La cantidad debe ser un numero con tres decimales como maximo',
      })
      return
    }
    if (Number(texto) <= 0) {
      ctx.addIssue({ code: 'custom', message: 'La cantidad debe ser mayor que cero' })
      return
    }
    if (Number(texto) > CANTIDAD_MAX) {
      ctx.addIssue({ code: 'custom', message: 'Cantidad fuera de rango' })
    }
  })
  .transform((valor): TextoCantidad => cantidad(valor))

/**
 * Igual que `quantitySchema` pero admitiendo cero.
 *
 * Para el stock inicial de un producto y para el minimo de reposicion, donde
 * el cero es una respuesta valida --y en el minimo significa algo concreto:
 * "sin minimo configurado"--.
 */
export const quantityOrZeroSchema = z
  .union([z.string(), z.number()])
  .superRefine((valor, ctx) => {
    if (typeof valor === 'number' && !Number.isFinite(valor)) {
      ctx.addIssue({ code: 'custom', message: 'Cantidad invalida' })
      return
    }
    const texto = typeof valor === 'number' ? valor.toString() : valor.trim()
    if (!/^\d+(\.\d{1,3})?$/.test(texto)) {
      ctx.addIssue({
        code: 'custom',
        message: /^-/.test(texto)
          ? 'La cantidad no puede ser negativa'
          : 'La cantidad debe ser un numero con tres decimales como maximo',
      })
      return
    }
    if (Number(texto) > CANTIDAD_MAX) {
      ctx.addIssue({ code: 'custom', message: 'Cantidad fuera de rango' })
    }
  })
  .transform((valor): TextoCantidad => cantidad(valor))

/**
 * Delta de un ajuste: puede ser negativo, no puede ser cero.
 *
 * "Entraron 12", "se rompieron 3". El cero se rechaza porque un movimiento de
 * cero unidades no registra nada.
 */
export const deltaSchema = z
  .union([z.string(), z.number()])
  .superRefine((valor, ctx) => {
    if (typeof valor === 'number' && !Number.isFinite(valor)) {
      ctx.addIssue({ code: 'custom', message: 'Cantidad invalida' })
      return
    }
    const texto = typeof valor === 'number' ? valor.toString() : valor.trim()
    if (!/^-?\d+(\.\d{1,3})?$/.test(texto)) {
      ctx.addIssue({
        code: 'custom',
        message: 'La cantidad debe ser un numero con tres decimales como maximo',
      })
      return
    }
    if (Number(texto) === 0) {
      ctx.addIssue({ code: 'custom', message: 'Un movimiento de cero unidades no registra nada' })
      return
    }
    if (Math.abs(Number(texto)) > CANTIDAD_MAX) {
      ctx.addIssue({ code: 'custom', message: 'Cantidad fuera de rango' })
    }
  })
  .transform((valor): TextoCantidad => cantidad(valor))

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

/**
 * Costo unitario. Como `amountSchema` pero con hasta CUATRO decimales.
 *
 * El costo se deriva de una division --una caja de 8 a $12.345 da $1.543,125
 * por unidad-- y por eso se guarda con mas resolucion que un precio. Ver
 * docs/PHASE3_MONEY_MIGRATION.md.
 *
 * Devuelve la cadena canonica con la escala que se tipeo; el servicio la pasa
 * a `Decimal` sin volver a tocarla.
 */
export const costSchema = z
  .union([z.string(), z.number()])
  .superRefine((valor, ctx) => {
    if (typeof valor === 'number' && !Number.isFinite(valor)) {
      ctx.addIssue({ code: 'custom', message: 'Costo invalido' })
      return
    }
    const texto = typeof valor === 'number' ? valor.toString() : valor.trim()
    if (!/^\d+(\.\d{1,4})?$/.test(texto)) {
      ctx.addIssue({
        code: 'custom',
        message: /^-/.test(texto)
          ? 'El costo no puede ser negativo'
          : 'El costo debe ser un numero con cuatro decimales como maximo',
      })
      return
    }
    if (Number(texto) > 1_000_000_000) {
      ctx.addIssue({ code: 'custom', message: 'Costo fuera de rango' })
    }
  })
  .transform((valor): string => (typeof valor === 'number' ? valor.toString() : valor.trim()))

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

/**
 * Medio de pago, en cualquiera de los dos vocabularios.
 *
 * Acepta los codigos nuevos --`CASH`, `DEBIT_CARD`…-- y los tres nombres
 * anteriores a la Fase 3, y SIEMPRE devuelve el codigo nuevo. Asi el servicio
 * trabaja con un solo vocabulario sin obligar a actualizar a la vez a todos
 * los clientes.
 *
 * Ver src/modules/sales/payment-methods.ts.
 */
export const paymentMethodSchema = z
  .enum([...MEDIOS_DE_PAGO, 'efectivo', 'tarjeta', 'mercado_pago'])
  .transform(normalizarMedio)

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
