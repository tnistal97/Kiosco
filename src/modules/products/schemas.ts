/**
 * Validacion de entrada del dominio de productos.
 */

import { z } from 'zod'
import { amountSchema, idSchema, optionalText, shortText } from '@/server/http/validate'
import { paginationQuerySchema, sortSchema } from '@/server/http/pagination'

/** Tope de unidades por producto. Un almacen no tiene un millon de nada. */
export const STOCK_MAX = 1_000_000

/**
 * Unidades por debajo de las cuales hay que reponer.
 *
 * Cero significa sin minimo configurado. Ver
 * `@/modules/inventory/minimum`, que es donde vive la regla de estados.
 */
export const minimoSchema = z.number().int().min(0).max(STOCK_MAX)

/**
 * Codigo de barras.
 *
 * Se acepta vacio y se guarda como null, no como cadena vacia: `barcode` es
 * unico global, y dos productos sin codigo con "" chocarian entre si.
 */
export const barcodeSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[0-9A-Za-z-]*$/, 'Codigo de barras invalido')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

export const stockInicialSchema = z.number().int().min(0).max(STOCK_MAX)

/**
 * Alta de producto.
 *
 * No declara `branchId`: la sucursal sale de la sesion.
 */
export const crearProductoSchema = z
  .object({
    name: shortText(150),
    barcode: barcodeSchema,
    description: optionalText(500),
    price: amountSchema,
    categoryId: idSchema,
    supplierId: idSchema.nullable().optional(),
    totalStock: stockInicialSchema.default(0),
    minimumStock: minimoSchema.default(0),
  })
  .strict()

/**
 * Edicion de producto.
 *
 * `price` exige ademas el permiso `products.price.update`, y `totalStock`
 * exige `stock.adjust` mas un motivo. Los dos se comprueban en el servicio:
 * el esquema solo dice que forma tiene la entrada, no quien puede mandarla.
 */
export const editarProductoSchema = z
  .object({
    name: shortText(150).optional(),
    barcode: barcodeSchema,
    description: optionalText(500),
    price: amountSchema.optional(),
    categoryId: idSchema.optional(),
    supplierId: idSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    minimumStock: minimoSchema.optional(),
    totalStock: stockInicialSchema.optional(),
    /**
     * Motivo del ajuste de inventario. Obligatorio si viene `totalStock`.
     *
     * Antes el ajuste se guardaba con el texto fijo "Ajuste desde la ficha
     * del producto", que en la bitacora no explica nada.
     */
    stockReason: shortText(200).optional(),
  })
  .strict()
  .refine((v) => v.totalStock === undefined || (v.stockReason ?? '').trim().length >= 3, {
    message: 'Un ajuste de stock necesita un motivo',
    path: ['stockReason'],
  })

/** Campos por los que se permite ordenar el catalogo. Lista blanca. */
export const CAMPOS_ORDEN_PRODUCTO = ['name', 'price', 'id'] as const

/** Filtro de estado del catalogo. La caja usa siempre `activos`. */
export const ESTADOS_PRODUCTO = ['activos', 'inactivos', 'todos'] as const

/**
 * Lista de identificadores separados por coma.
 *
 * La usa la caja para restaurar el ticket guardado: pide de una sola vez los
 * productos que tenia y vuelve con precio y stock frescos. Sin esto serian
 * quince peticiones para un ticket de quince lineas.
 */
const idsSchema = z
  .string()
  .trim()
  .regex(/^\d+(,\d+)*$/, 'Lista de identificadores invalida')
  .transform((v) => v.split(',').map(Number))
  .refine((v) => v.length <= 100, 'Como maximo 100 identificadores')
  .optional()

export const listarProductosQuerySchema = paginationQuerySchema
  .extend(sortSchema(CAMPOS_ORDEN_PRODUCTO, 'name').shape)
  .extend({
    /** Busqueda por nombre o codigo de barras. */
    q: z.string().trim().max(100).optional(),
    categoryId: idSchema.optional(),
    ids: idsSchema,
    estado: z.enum(ESTADOS_PRODUCTO).default('todos'),
    /**
     * Solo productos que llegaron a su minimo configurado y todavia tienen
     * unidades. Un producto sin minimo (cero) nunca aparece aca.
     */
    lowStock: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    /** Solo productos sin unidades. */
    sinStock: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })

export type CrearProductoInput = z.infer<typeof crearProductoSchema>
export type EditarProductoInput = z.infer<typeof editarProductoSchema>
export type ListarProductosQuery = z.infer<typeof listarProductosQuerySchema>
