/**
 * Validacion de entrada del dominio de caja.
 */

import { z } from 'zod'
import { amountSchema, optionalText, paymentMethodSchema } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'

export const TIPOS_MOVIMIENTO = ['ingreso', 'retiro', 'deposito'] as const
export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number]

/**
 * Movimiento manual de caja.
 *
 * El monto se declara siempre positivo y el signo lo decide el servidor a
 * partir de `movementType`. Aceptar un monto negativo dejaria registrar un
 * "ingreso de -5000", que en los listados se lee como un ingreso y en el
 * saldo resta.
 */
export const movimientoManualSchema = z
  .object({
    amount: amountSchema.refine((n) => n > 0, 'El monto debe ser mayor que cero'),
    paymentMethod: paymentMethodSchema,
    description: optionalText(300),
    movementType: z.enum(TIPOS_MOVIMIENTO),
  })
  .strict()

/**
 * Arqueo de caja.
 *
 * `amount` es lo que se conto fisicamente. La diferencia contra lo esperado
 * la calcula el servidor: si la mandara el cliente, se podria declarar un
 * arqueo cuadrado sobre una caja que no lo esta.
 */
export const arqueoSchema = z
  .object({
    amount: amountSchema,
    notes: optionalText(500),
  })
  .strict()

export const listarMovimientosQuerySchema = paginationQuerySchema.extend({
  /** Dias hacia atras. El listado por defecto son ayer y hoy. */
  dias: z.coerce.number().int().min(1).max(90).default(2),
  tipo: z.enum(['todos', 'sale', 'sale_cancel', 'manual', 'retiro', 'deposito']).default('todos'),
})

export type MovimientoManualInput = z.infer<typeof movimientoManualSchema>
export type ArqueoInput = z.infer<typeof arqueoSchema>
export type ListarMovimientosQuery = z.infer<typeof listarMovimientosQuerySchema>
