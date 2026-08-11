/**
 * Validacion de entrada de lotes y vencimientos.
 *
 * Las fechas entran como `YYYY-MM-DD` y NUNCA como instante: un vencimiento es
 * un dato de calendario impreso en un envase. Ver docs/LOT_EXPIRATION_POLICY.md.
 */

import { z } from 'zod'
import { fechaLocalSchema, idSchema, optionalText, quantitySchema } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import {
  CODIGO_DE_LOTE,
  ESTADOS_DE_VENCIMIENTO,
  LARGO_MAXIMO_DE_CODIGO,
  POLITICAS_DE_LOTE,
  POLITICAS_DE_VENCIMIENTO,
} from './politicas'

/** El codigo tal cual viene del envase. El servidor lo normaliza aparte. */
const codigoDeLoteSchema = z
  .string()
  .trim()
  .min(1, 'El código del lote es obligatorio')
  .max(LARGO_MAXIMO_DE_CODIGO)
  .regex(CODIGO_DE_LOTE, 'El código admite letras, números, espacios y los signos . _ / -')

export const crearLoteSchema = z.object({
  productId: idSchema,
  code: codigoDeLoteSchema,
  expirationDate: fechaLocalSchema.nullable().optional(),
  manufacturedAt: fechaLocalSchema.nullable().optional(),
  notes: optionalText(300),
})

export type CrearLoteInput = z.infer<typeof crearLoteSchema>

/**
 * Lo unico editable de un lote con historial.
 *
 * El codigo y el producto NO estan: son la identidad de la partida y quedan
 * congelados en cuanto movio mercaderia --hay un disparador en la base--.
 * El vencimiento si, porque una fecha mal tipeada decide si la mercaderia se
 * vende o se tira, y es el error mas facil de cometer de los tres.
 */
export const editarLoteSchema = z.object({
  expirationDate: fechaLocalSchema.nullable().optional(),
  manufacturedAt: fechaLocalSchema.nullable().optional(),
  notes: optionalText(300),
})

export type EditarLoteInput = z.infer<typeof editarLoteSchema>

export const listarLotesQuerySchema = paginationQuerySchema.extend({
  /** Nombre del producto o codigo del lote. */
  q: z.string().trim().max(100).optional(),
  productId: idSchema.optional(),
  estado: z.enum(ESTADOS_DE_VENCIMIENTO).optional(),
  /** Con `false` (por omision) los lotes en cero no aparecen. */
  agotados: z.coerce.boolean().optional(),
})

export type ListarLotesQuery = z.infer<typeof listarLotesQuerySchema>

/**
 * Atribuir stock existente a lotes.
 *
 * Es la operacion que hace posible activar `REQUIRED` sobre un producto que ya
 * tiene unidades. NO mueve stock: dice de que partida son las que ya estan.
 */
export const atribuirStockSchema = z.object({
  productId: idSchema,
  reason: z.string().trim().min(1, 'El motivo es obligatorio').max(300),
  lineas: z
    .array(z.object({ lotId: idSchema, quantity: quantitySchema }))
    .min(1, 'Hay que atribuir al menos un lote')
    .max(50),
})

export type AtribuirStockInput = z.infer<typeof atribuirStockSchema>

/**
 * Cambiar la politica de un producto.
 *
 * Las dos juntas y no una por una: la combinacion tiene que ser valida --un
 * vencimiento sin lote no tiene donde guardarse-- y comprobarla exige verlas a
 * las dos. Cambiar una sola obligaria a leer la otra y a decidir si la
 * combinacion resultante vale, que es la misma cuenta escrita en otro lado.
 */
export const cambiarPoliticaSchema = z.object({
  lotTracking: z.enum(POLITICAS_DE_LOTE),
  expirationTracking: z.enum(POLITICAS_DE_VENCIMIENTO),
})

export type CambiarPoliticaInput = z.infer<typeof cambiarPoliticaSchema>
