/**
 * Validacion de entrada del dominio de ventas.
 */

import { z } from 'zod'
import {
  amountSchema,
  idSchema,
  optionalText,
  paymentMethodSchema,
  quantitySchema,
  shortText,
} from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { esPositivo } from '@/lib/money'
import { MEDIOS_COBRABLES } from './payment-methods'

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
/**
 * Un pago de la venta.
 *
 * `changeGiven` NO se declara: el vuelto lo calcula el servidor a partir de lo
 * recibido y lo que corresponde a ese pago. Si lo mandara el cliente se podria
 * declarar un vuelto que no coincide con la cuenta.
 */
export const pagoSchema = z
  .object({
    method: z.enum(MEDIOS_COBRABLES),
    amount: amountSchema.refine(esPositivo, 'Un pago de cero no es un pago'),
    /** Con cuanto pago. Solo en efectivo, y sirve para el vuelto. */
    cashReceived: amountSchema.optional(),
    reference: optionalText(120),
  })
  .strict()
  .refine((p) => p.method === 'CASH' || p.cashReceived === undefined, {
    message: 'Solo un pago en efectivo puede declarar con cuánto se pagó',
    path: ['cashReceived'],
  })

/** Tope de pagos por venta. Mas de cuatro medios en un ticket es un error de carga. */
export const MAX_PAGOS_POR_VENTA = 4

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

    /**
     * Forma nueva: uno o varios pagos, que tienen que sumar el total.
     *
     * El total NO se declara. Lo calcula el servidor desde el catalogo, y
     * contra ese numero comprueba la suma. Aceptar un total del cliente
     * permitiria cobrar cualquier cosa por cualquier producto.
     */
    payments: z.array(pagoSchema).min(1).max(MAX_PAGOS_POR_VENTA).optional(),

    /**
     * Forma anterior: un solo medio para toda la venta.
     *
     * Se conserva a proposito. Es lo que manda cualquier cliente que no se
     * actualizo, y rechazarlo obligaria a desplegar navegador y servidor a la
     * vez por un cambio que no lo necesita. El servidor lo convierte en un
     * unico pago por el total.
     */
    paymentMethod: paymentMethodSchema.optional(),
  })
  .strict()
  .refine((v) => v.payments !== undefined || v.paymentMethod !== undefined, {
    message: 'Falta indicar cómo se cobró',
    path: ['payments'],
  })

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
export type PagoInput = z.infer<typeof pagoSchema>
export type AnularVentaInput = z.infer<typeof anularVentaSchema>
export type ReporteVentasQuery = z.infer<typeof reporteVentasQuerySchema>
