/**
 * Validacion de entrada del dominio de caja.
 */

import { z } from 'zod'
import { amountSchema, optionalText } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { esPositivo } from '@/lib/money'
import { MEDIOS_DE_CAJA } from '@/modules/sales/payment-methods'

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
    // `esPositivo` y no `> 0`: despues de `amountSchema` el importe es una
    // cadena, y `'9.00' > 0` en JavaScript no es la comparacion que parece.
    amount: amountSchema.refine(esPositivo, 'El monto debe ser mayor que cero'),
    // `MEDIOS_DE_CAJA` y no todos los medios: `ACCOUNT` no puede aparecer en un
    // movimiento de caja, porque un cargo a cuenta no es plata que entro ni
    // salio del cajon. Ver src/modules/sales/payment-methods.ts.
    paymentMethod: z.enum(MEDIOS_DE_CAJA),
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

/** Ultimos arqueos. Tope acotado: es una lista de trabajo, no un informe. */
export const listarArqueosQuerySchema = z
  .object({
    limite: z.coerce.number().int().min(1).max(50).default(10),
  })
  .strict()

export const listarMovimientosQuerySchema = paginationQuerySchema.extend({
  /** Dias hacia atras. El listado por defecto son ayer y hoy. */
  dias: z.coerce.number().int().min(1).max(90).default(2),
  tipo: z.enum(['todos', 'sale', 'sale_cancel', 'manual', 'retiro', 'deposito']).default('todos'),
})

/**
 * Apertura de caja.
 *
 * `openingAmount` es lo que se cuenta en el cajon al empezar. Puede ser cero
 * --una caja que arranca vacia-- pero tiene que venir: abrir sin declarar
 * cuanto habia deja el turno sin punto de partida y el cierre no significa
 * nada.
 */
export const abrirTurnoSchema = z
  .object({
    openingAmount: amountSchema,
    notes: optionalText(500),
  })
  .strict()

/**
 * Cierre de caja.
 *
 * `countedAmount` es lo que se conto. El esperado y la diferencia los calcula
 * el servidor: si los mandara el cliente se podria declarar un cierre cuadrado
 * sobre una caja que no lo esta.
 *
 * `autorizar` es la confirmacion explicita de una diferencia por encima del
 * umbral de la sucursal. Sin ella, el cierre se rechaza con un 409 que dice
 * cuanto falta y cuanto es el limite.
 */
export const cerrarTurnoSchema = z
  .object({
    countedAmount: amountSchema,
    notes: optionalText(500),
    autorizar: z.boolean().default(false),
  })
  .strict()

export const listarTurnosQuerySchema = paginationQuerySchema.extend({
  estado: z.enum(['todos', 'open', 'closed', 'legacy']).default('todos'),
})

export type MovimientoManualInput = z.infer<typeof movimientoManualSchema>
export type ArqueoInput = z.infer<typeof arqueoSchema>
export type ListarMovimientosQuery = z.infer<typeof listarMovimientosQuerySchema>
export type ListarArqueosQuery = z.infer<typeof listarArqueosQuerySchema>
export type AbrirTurnoInput = z.infer<typeof abrirTurnoSchema>
export type CerrarTurnoInput = z.infer<typeof cerrarTurnoSchema>
export type ListarTurnosQuery = z.infer<typeof listarTurnosQuerySchema>
