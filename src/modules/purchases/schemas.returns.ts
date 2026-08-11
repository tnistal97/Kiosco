/**
 * Validacion de entrada de las devoluciones a proveedor.
 *
 * Lo que NO se acepta del cliente, y es la mitad del contenido de este archivo:
 *
 *   unitCost   sale de la recepcion original, congelado
 *   amount     se calcula
 *   total      se calcula
 *   status     lo decide el servidor
 *   number     lo genera una secuencia
 *   supplierId sale de la recepcion, no del cuerpo
 *
 * El costo es el caso mas importante de los seis. Aceptarlo del navegador
 * permitiria declarar que una caja que entro a $1.100 vale $1.350 al devolverla,
 * y el credito seria por plata que el proveedor nunca cobro. Ver el objetivo 10
 * y docs/PURCHASE_RETURN_ACCOUNTING.md.
 */

import { z } from 'zod'
import { idSchema, optionalText, quantitySchema, shortText } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { ESTADOS_DE_DEVOLUCION, MOTIVOS_DE_DEVOLUCION } from './return-status'

/**
 * Un renglon de la devolucion.
 *
 * `receiptItemId` y no `productId`: se devuelve DE UNA ENTREGA. El mismo
 * producto puede haber llegado dos veces a costos distintos, y sin la linea de
 * origen no habria forma de saber cual de los dos costos acredita el proveedor.
 */
export const lineaDeDevolucionSchema = z
  .object({
    receiptItemId: idSchema,
    /** EN UNIDAD DE COMPRA, igual que la recepcion. "2 cajas" es `2`. */
    quantity: quantitySchema,
  })
  .strict()

const renglones = z
  .array(lineaDeDevolucionSchema)
  .min(1, 'Una devolución sin renglones no devuelve nada')
  .max(200)
  .refine(
    (lista) => new Set(lista.map((l) => l.receiptItemId)).size === lista.length,
    'Un renglón de la entrega no puede aparecer dos veces',
  )

export const crearDevolucionSchema = z
  .object({
    /** La entrega que se deshace. Obligatoria: de ahi salen costo y tope. */
    purchaseReceiptId: idSchema,
    /**
     * Obligatorio, y de la lista. Ver `return-status.ts`: existe para poder
     * preguntar "cuanto devolvimos por rotura", que con texto libre no se
     * contesta.
     */
    reason: z.enum(MOTIVOS_DE_DEVOLUCION),
    /** Lo que el motivo no alcanza a decir. Opcional salvo en 'OTHER'. */
    notes: optionalText(500),
    items: renglones,
  })
  .strict()
  .refine((d) => d.reason !== 'OTHER' || (d.notes ?? '').trim().length > 0, {
    message: 'Si el motivo es "Otro", escribí cuál',
    path: ['notes'],
  })

/**
 * Edicion de un borrador.
 *
 * `items` reemplaza la lista ENTERA, que es como se comporta un formulario. La
 * recepcion de origen NO se puede cambiar: cambiarla convertiria la devolucion
 * en otra distinta, con otros costos y otros topes, conservando su numero.
 */
export const editarDevolucionSchema = z
  .object({
    reason: z.enum(MOTIVOS_DE_DEVOLUCION),
    notes: optionalText(500),
    items: renglones,
  })
  .strict()
  .refine((d) => d.reason !== 'OTHER' || (d.notes ?? '').trim().length > 0, {
    message: 'Si el motivo es "Otro", escribí cuál',
    path: ['notes'],
  })

export const cancelarDevolucionSchema = z
  .object({
    /**
     * Obligatorio. Un borrador descartado sin motivo no se puede explicar tres
     * meses despues, que es justo cuando alguien pregunta por que la mercaderia
     * rota sigue en el deposito.
     */
    reason: shortText(500),
  })
  .strict()

export const listarDevolucionesSchema = paginationQuerySchema.extend({
  supplierId: idSchema.optional(),
  status: z.enum(ESTADOS_DE_DEVOLUCION).optional(),
  /** Numero de devolucion, entero o el pedazo que uno se acuerda. */
  q: z.string().trim().max(40).optional(),
})

export type LineaDeDevolucionInput = z.infer<typeof lineaDeDevolucionSchema>
export type CrearDevolucionInput = z.infer<typeof crearDevolucionSchema>
export type EditarDevolucionInput = z.infer<typeof editarDevolucionSchema>
export type CancelarDevolucionInput = z.infer<typeof cancelarDevolucionSchema>
export type ListarDevolucionesQuery = z.infer<typeof listarDevolucionesSchema>
