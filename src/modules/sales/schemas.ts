/**
 * Validacion de entrada del dominio de ventas.
 */

import { z } from 'zod'
import { idSchema, paymentMethodSchema, quantitySchema, shortText } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'

/** Tope de lineas por venta. Un ticket de almacen no llega ni cerca. */
export const MAX_ITEMS_POR_VENTA = 200

/** Tope de rango de un reporte: evita traer anos enteros de una vez. */
export const MAX_DIAS_REPORTE = 366

/**
 * Alta de venta.
 *
 * `price`, `subtotal`, `total`, `discount`, `branchId` y `userId` NO estan
 * declarados. No es un olvido: al no estar, `.strict()` hace que la peticion
 * se rechace si el navegador los manda. El precio sale del catalogo, la
 * sucursal y el cajero salen de la sesion.
 *
 * Rechazar en vez de ignorar es deliberado. Ignorar el campo tambien seria
 * seguro, pero silencioso: asi, el intento se ve.
 */
export const crearVentaSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: idSchema,
            quantity: quantitySchema,
          })
          .strict(),
      )
      .min(1, 'La venta no tiene items')
      .max(MAX_ITEMS_POR_VENTA, 'Demasiados items en una sola venta'),
    paymentMethod: paymentMethodSchema,
  })
  .strict()

/**
 * Anulacion.
 *
 * El motivo es obligatorio. Una anulacion mueve dinero y stock: sin motivo
 * no hay forma de distinguir despues un error de cobro de un vaciamiento
 * deliberado de la caja.
 */
export const anularVentaSchema = z
  .object({
    reason: shortText(300),
  })
  .strict()

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD')

/**
 * Reporte administrativo por rango de fechas, paginado.
 *
 * Los filtros son todos opcionales salvo el rango: sin rango, la consulta
 * recorreria la tabla entera.
 */
export const reporteVentasQuerySchema = paginationQuerySchema.extend({
  start: fechaSchema,
  end: fechaSchema,
  estado: z.enum(['todas', 'completed', 'canceled']).default('todas'),
  /** Quien la registro. */
  userId: idSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  /** Numero de venta exacto. Cuando esta, los demas filtros no estorban. */
  saleId: idSchema.optional(),
})

export const listarVentasQuerySchema = paginationQuerySchema.extend({
  start: fechaSchema.optional(),
  end: fechaSchema.optional(),
  estado: z.enum(['todas', 'completed', 'canceled']).default('todas'),
})

export type CrearVentaInput = z.infer<typeof crearVentaSchema>
export type AnularVentaInput = z.infer<typeof anularVentaSchema>
export type ReporteVentasQuery = z.infer<typeof reporteVentasQuerySchema>
