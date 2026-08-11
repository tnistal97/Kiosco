/**
 * Validacion de entrada de compras.
 *
 * Lo que NO se acepta del cliente, y es la mitad del contenido de este archivo:
 *
 *   subtotal   se calcula
 *   total      se calcula
 *   status     lo decide el servidor
 *   number     lo genera una secuencia
 *
 * Es la misma regla que rige el total de una venta desde la Fase 0: lo que
 * llega por la red lo escribe cualquiera. Ver docs/PURCHASE_FLOW.md.
 */

import { z } from 'zod'
import {
  amountSchema,
  costSchema,
  fechaLocalSchema,
  idSchema,
  optionalText,
  quantitySchema,
} from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { UNIDADES_DE_COMPRA } from '@/modules/products/units'
import { MEDIOS_DE_PAGO_A_PROVEEDOR } from '@/modules/sales/payment-methods'
import { ESTADOS_DE_COMPRA } from './status'

/**
 * Cuantas unidades de venta entran en una de compra.
 *
 * Tope de diez mil: no existe una caja con mas unidades adentro, y el limite
 * mantiene la aritmetica entera del navegador dentro de lo exactamente
 * representable. Sin tope, un factor absurdo convertiria una orden de tres
 * cajas en medio millon de unidades de stock.
 */
const unidadesPorUnidadDeCompraSchema = quantitySchema.refine(
  (v) => Number(v) <= 10_000,
  'Una unidad de compra no puede contener mas de 10.000 unidades de venta',
)

/**
 * Una linea de la orden.
 *
 * `purchaseUnit` y `unitsPerPurchaseUnit` son OPCIONALES: sin ellos se copian
 * del producto, que es el caso normal. Se aceptan porque comprar el mismo
 * articulo por caja una semana y por unidad la siguiente es real, y porque la
 * linea los congela --no los lee del producto al recibir--, asi que tienen que
 * poder decir algo distinto del producto.
 *
 * Lo que NO viaja es el subtotal.
 */
export const lineaDeCompraSchema = z
  .object({
    productId: idSchema,
    /** EN UNIDAD DE COMPRA. "5 cajas" es `5`. */
    quantity: quantitySchema,
    /** Costo POR UNIDAD DE COMPRA. Una caja de 8 a $8.800 manda `8800`. */
    unitCost: costSchema,
    purchaseUnit: z.enum(UNIDADES_DE_COMPRA).optional(),
    unitsPerPurchaseUnit: unidadesPorUnidadDeCompraSchema.optional(),
  })
  .strict()

export const crearOrdenSchema = z
  .object({
    supplierId: idSchema,
    notes: optionalText(1000),
    /**
     * Una orden puede nacer vacia: el borrador se arma de a poco, y obligar a
     * cargar la primera linea antes de poder guardar haria perder el trabajo
     * de quien se interrumpe a mitad de camino. Confirmarla si exige al menos
     * una linea, y esa comprobacion vive en el servicio.
     */
    items: z.array(lineaDeCompraSchema).max(200).default([]),
  })
  .strict()

/**
 * Edicion de un borrador.
 *
 * `items` reemplaza la lista ENTERA cuando viene, que es como se comporta un
 * formulario. Sin `items`, las lineas no se tocan: cambiar solo las notas no
 * tiene por que borrar la orden.
 */
export const editarOrdenSchema = z
  .object({
    supplierId: idSchema.optional(),
    notes: optionalText(1000),
    items: z.array(lineaDeCompraSchema).max(200).optional(),
  })
  .strict()

export const cancelarOrdenSchema = z
  .object({
    /**
     * Obligatorio. Una orden cancelada sin motivo no se puede explicar tres
     * meses despues, que es justo cuando alguien pregunta por que nunca llego
     * la mercaderia.
     */
    reason: z.string().trim().min(3, 'Escribí por qué se cancela').max(500),
  })
  .strict()

/**
 * Una linea de la recepcion.
 *
 * `unitCost` es opcional: sin el se recibe al costo pedido, que es lo normal.
 * Mandarlo distinto exige `products.cost.update` --lo comprueba el servicio--
 * y la diferencia queda registrada en vez de reescribir la orden.
 */
export const lineaDeRecepcionSchema = z
  .object({
    orderItemId: idSchema,
    /** EN UNIDAD DE COMPRA. Lo que llego ahora, no el acumulado. */
    quantity: quantitySchema,
    unitCost: costSchema.optional(),
  })
  .strict()

/**
 * Pago inmediato al recibir. Fase 4B, objetivo 17.
 *
 * Opcional. Cuando viene, se registra DESPUES del cargo y en la misma
 * transaccion: primero nace la deuda, despues se paga. Nunca al reves, y nunca
 * saltando el cargo.
 *
 * Esa es la decision entera del objetivo 17: si "pagado al contado" evitara
 * crear la deuda, la cuenta del proveedor no tendria ni la entrega ni el pago, y
 * "¿cuanto le compramos este anio?" habria que responderlo desde otra tabla. El
 * saldo final es el mismo; la historia, no.
 *
 * Sin `imputacion`: un pago hecho en el momento de recibir se imputa solo, y a
 * la entrega que lo motivo --que por ser la mas nueva sin saldar puede no ser la
 * primera del orden FIFO--. Se deja en automatica y se documenta: repartir a
 * mano en la pantalla de recepcion, con el camion en la puerta, no es el
 * momento. Para eso esta la ficha del proveedor.
 */
export const pagoAlRecibirSchema = z
  .object({
    amount: amountSchema,
    method: z.enum(MEDIOS_DE_PAGO_A_PROVEEDOR),
    reference: optionalText(120),
    notes: optionalText(300),
    /** Confirma dejar saldo a favor nuestro. Exige `supplierAccounts.overpay`. */
    acceptCredit: z.boolean().default(false),
  })
  .strict()

export const recibirSchema = z
  .object({
    notes: optionalText(1000),
    /**
     * Al menos una linea. Una recepcion vacia no es "no llego nada": es un
     * papel que dice que alguien vino y no trajo nada, y eso no hay que
     * registrarlo, hay que no registrarlo.
     */
    items: z.array(lineaDeRecepcionSchema).min(1).max(200),
    /**
     * Vencimiento de la obligacion. Fase 4B.
     *
     *   ausente   se calcula con el plazo del proveedor, si tiene uno.
     *   `null`    sin vencimiento, aunque el proveedor tenga plazo.
     *   fecha     esa, y congelada.
     *
     * Los tres casos son distintos y el esquema los distingue: `undefined` es
     * "no dije nada, decidilo vos" y `null` es "decidi que no tenga". Tratarlos
     * igual haria imposible recibir sin vencimiento de un proveedor con plazo.
     */
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato AAAA-MM-DD')
      .nullable()
      .optional(),
    /** Pago en el momento. Ver `pagoAlRecibirSchema`. */
    pago: pagoAlRecibirSchema.optional(),
  })
  .strict()

export const listarOrdenesSchema = paginationQuerySchema.extend({
  supplierId: idSchema.optional(),
  status: z.enum(ESTADOS_DE_COMPRA).optional(),
  /** Numero de orden, entero o el pedazo que uno se acuerda. */
  q: z.string().trim().max(40).optional(),
  /** Dias. El servidor los convierte con la zona de la sucursal. */
  desde: fechaLocalSchema.optional(),
  hasta: fechaLocalSchema.optional(),
})

/** Borrador generado desde los productos bajo minimo. */
export const borradorDesdeReposicionSchema = z
  .object({
    productIds: z.array(idSchema).min(1).max(200),
  })
  .strict()

export type LineaDeCompraInput = z.infer<typeof lineaDeCompraSchema>
export type CrearOrdenInput = z.infer<typeof crearOrdenSchema>
export type EditarOrdenInput = z.infer<typeof editarOrdenSchema>
export type CancelarOrdenInput = z.infer<typeof cancelarOrdenSchema>
export type RecibirInput = z.infer<typeof recibirSchema>
export type ListarOrdenesQuery = z.infer<typeof listarOrdenesSchema>
export type BorradorDesdeReposicionInput = z.infer<typeof borradorDesdeReposicionSchema>
