/**
 * Validacion de entrada del dominio de productos.
 */

import { z } from 'zod'
import { amountSchema, idSchema, optionalText, shortText } from '@/server/http/validate'
import { paginationQuerySchema, sortSchema } from '@/server/http/pagination'

/** Tope de unidades por producto. Un almacen no tiene un millon de nada. */
export const STOCK_MAX = 1_000_000

/**
 * Umbral por debajo del cual un producto se considera con stock critico.
 *
 * Vive aca y no en el servicio a proposito: la pantalla de productos lo
 * necesita, y este modulo solo importa zod. Importarlo del servicio
 * arrastraria Prisma al paquete del navegador.
 */
export const STOCK_CRITICO = 10

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
    totalStock: stockInicialSchema.default(0),
  })
  .strict()

/**
 * Edicion de producto.
 *
 * `totalStock` sigue aca por compatibilidad con la pantalla actual, pero
 * exige ademas el permiso stock.adjust y se audita como un ajuste de
 * inventario aparte. Cuando exista StockMovement deja de editarse desde aca.
 */
export const editarProductoSchema = z
  .object({
    name: shortText(150).optional(),
    barcode: barcodeSchema,
    description: optionalText(500),
    price: amountSchema.optional(),
    categoryId: idSchema.optional(),
    totalStock: stockInicialSchema.optional(),
  })
  .strict()

/** Campos por los que se permite ordenar el catalogo. Lista blanca. */
export const CAMPOS_ORDEN_PRODUCTO = ['name', 'price', 'id'] as const

export const listarProductosQuerySchema = paginationQuerySchema
  .extend(sortSchema(CAMPOS_ORDEN_PRODUCTO, 'name').shape)
  .extend({
    /** Busqueda por nombre o codigo de barras. */
    q: z.string().trim().max(100).optional(),
    categoryId: idSchema.optional(),
    /** Solo productos por debajo del umbral de stock critico. */
    lowStock: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
  })

export type CrearProductoInput = z.infer<typeof crearProductoSchema>
export type EditarProductoInput = z.infer<typeof editarProductoSchema>
export type ListarProductosQuery = z.infer<typeof listarProductosQuerySchema>
