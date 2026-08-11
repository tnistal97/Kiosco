/**
 * Validacion de entrada del inventario fisico.
 *
 * Lo que NO se acepta del cliente, que es la mitad del contenido: la cantidad
 * ESPERADA, la diferencia y el estado. Los tres los calcula el servidor. Aceptar
 * la esperada del navegador convertiria el mecanismo entero en decorativo.
 */

import { z } from 'zod'
import { idSchema, optionalText, quantityOrZeroSchema, shortText } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { ALCANCES, ESTADOS_DE_INVENTARIO, ESTADOS_DE_LINEA } from './estados'

export const crearInventarioSchema = z
  .object({
    scope: z.enum(ALCANCES).default('ALL'),
    /** Obligatoria si el alcance es CATEGORY, prohibida si no. */
    categoryId: idSchema.optional(),
    /** Obligatoria si el alcance es SELECTION. */
    productIds: z.array(idSchema).min(1).max(2000).optional(),
    /**
     * VERDADERO por omision, y es medio punto del mecanismo: ver "el sistema
     * espera 18" antes de contar hace que la respuesta sea 18.
     */
    blindCount: z.boolean().default(true),
    /**
     * Diferencia absoluta a partir de la cual la linea exige segundo conteo.
     * Ausente es sin doble conteo. Ver el objetivo 32.
     */
    recountThreshold: quantityOrZeroSchema.optional(),
    notes: optionalText(500),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.scope === 'CATEGORY') !== (v.categoryId !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['categoryId'],
        message: 'La categoría va con el alcance "una categoría", y sólo con ese',
      })
    }
    if ((v.scope === 'SELECTION') !== (v.productIds !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['productIds'],
        message: 'La lista de productos va con el alcance "una selección", y sólo con ese',
      })
    }
  })

export type CrearInventarioInput = z.infer<typeof crearInventarioSchema>

/**
 * Cargar conteos. Varias lineas de una vez: el operario recorre una gondola.
 *
 * Solo viaja LO CONTADO. Lo esperado lo lee el servidor EN EL MOMENTO de
 * guardar, que es lo que hace posible contar sin cerrar el local. Ver
 * docs/INVENTORY_COUNT_CONCURRENCY.md.
 */
export const cargarConteoSchema = z
  .object({
    lineas: z
      .array(
        z
          .object({
            lineId: idSchema,
            countedQuantity: quantityOrZeroSchema,
            notes: optionalText(300),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()

export type CargarConteoInput = z.infer<typeof cargarConteoSchema>

/**
 * Resolver una linea sin lote de un producto que los exige.
 *
 * Solo pide la partida: las unidades ESTAN, alguien las conto. Si el operario
 * concluye que se equivoco, vuelve a contar esa linea en cero por el camino
 * normal, que deja rastro de las dos cifras.
 */
export const resolverLineaSchema = z
  .object({
    lotId: idSchema,
    notes: optionalText(300),
  })
  .strict()

export type ResolverLineaInput = z.infer<typeof resolverLineaSchema>

export const cancelarInventarioSchema = z.object({ reason: shortText(300) }).strict()
export type CancelarInventarioInput = z.infer<typeof cancelarInventarioSchema>

export const listarInventariosSchema = paginationQuerySchema.extend({
  estado: z.enum(ESTADOS_DE_INVENTARIO).optional(),
})
export type ListarInventariosQuery = z.infer<typeof listarInventariosSchema>

export const lineasQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  estado: z.enum(ESTADOS_DE_LINEA).optional(),
  /** Los filtros de la pantalla de revision. Ver el objetivo 33. */
  diferencia: z.enum(['todas', 'con', 'positivas', 'negativas']).optional(),
})
export type LineasQuery = z.infer<typeof lineasQuerySchema>
