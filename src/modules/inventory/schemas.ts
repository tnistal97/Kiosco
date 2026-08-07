/**
 * Validacion de entrada de la consulta del libro de inventario.
 */

import { z } from 'zod'
import { idSchema } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { TIPOS_MOVIMIENTO } from './movement-types'
import { REFERENCIAS } from './referencias'

export const consultarMovimientosQuerySchema = paginationQuerySchema.extend({
  /** Busqueda por nombre o codigo de barras del producto. */
  q: z.string().trim().max(100).optional(),
  productId: idSchema.optional(),
  tipo: z.enum(TIPOS_MOVIMIENTO).optional(),
  usuarioId: idSchema.optional(),
  /** "Que movio la venta #4832": referenceType=Sale&referenceId=4832. */
  referenceType: z.enum(REFERENCIAS).optional(),
  referenceId: idSchema.optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
})

export type ConsultarMovimientosQuery = z.infer<typeof consultarMovimientosQuerySchema>
