/**
 * Validacion de entrada del dominio de stock.
 *
 * Todo ajuste exige motivo. No es burocracia: el motivo es lo unico que
 * distingue, meses despues, un recuento de inventario de una rotura o de un
 * error de carga, y es lo que va a poblar `StockMovement.reason` cuando
 * exista el libro de movimientos.
 */

import { z } from 'zod'
import { shortText } from '@/server/http/validate'
import { STOCK_MAX } from '@/modules/products/schemas'

/** Motivo del ajuste. Obligatorio, con contenido real (shortText recorta). */
export const motivoSchema = shortText(200)

/** PUT: fija la cantidad exacta. Es el recuento de inventario. */
export const ajusteAbsolutoSchema = z
  .object({
    quantity: z.number().int().min(0).max(STOCK_MAX),
    reason: motivoSchema,
  })
  .strict()

/** PATCH: suma o resta unidades. Entrada de mercaderia, rotura, faltante. */
export const ajusteRelativoSchema = z
  .object({
    delta: z
      .number()
      .int('El ajuste debe ser un numero entero')
      .refine((n) => n !== 0, 'El ajuste no puede ser cero')
      .refine((n) => Math.abs(n) <= STOCK_MAX, 'Ajuste fuera de rango'),
    reason: motivoSchema,
  })
  .strict()

export type AjusteAbsolutoInput = z.infer<typeof ajusteAbsolutoSchema>
export type AjusteRelativoInput = z.infer<typeof ajusteRelativoSchema>
