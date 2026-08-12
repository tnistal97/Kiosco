/**
 * Validacion de entrada del dominio de productos.
 */

import { z } from 'zod'
import {
  amountSchema,
  costSchema,
  idSchema,
  optionalText,
  quantityOrZeroSchema,
  shortText,
} from '@/server/http/validate'
import { paginationQuerySchema, sortSchema } from '@/server/http/pagination'
import { CANTIDAD_MAX } from '@/lib/cantidad'
import { UNIDADES_DE_COMPRA, UNIDADES_DE_VENTA } from './units'
import { LARGO_MAXIMO_CODIGO, motivoDeCodigoInvalido } from './barcode'

/**
 * Tope de unidades por producto.
 *
 * Reexportado desde `@/lib/cantidad`, que es donde vive desde la Fase 3B para
 * que los esquemas puedan usarlo sin arrastrar Prisma. El nombre viejo se
 * conserva porque lo usan varios modulos y renombrarlo no arreglaria nada.
 */
export const STOCK_MAX = CANTIDAD_MAX

/**
 * Cantidad por debajo de la cual hay que reponer, en la unidad de venta.
 *
 * Cero significa sin minimo configurado. Ver `@/modules/inventory/minimum`,
 * que es donde vive la regla de estados.
 */
export const minimoSchema = quantityOrZeroSchema

/**
 * Un codigo de barras suelto.
 *
 * Se recorta y nada mas. NO se pasa a mayusculas: para un lector, dos codigos
 * que difieren en mayusculas son dos codigos distintos, y normalizarlos aca
 * haria que un producto quedara inalcanzable con su propia etiqueta.
 *
 * La regla en si vive en `./barcode`, sin Zod, para que la caja pueda aplicar
 * exactamente la misma antes de mandar nada: es lo que le permite distinguir un
 * codigo INVALIDO --que no tiene sentido ofrecerse a crear-- de uno valido y NO
 * REGISTRADO. Que fueran dos definiciones distintas es justo lo que haria que
 * las dos puntas discrepen.
 */
export const codigoSchema = z
  .string()
  .trim()
  .min(1, 'El codigo de barras no puede estar vacio')
  .max(LARGO_MAXIMO_CODIGO)
  .superRefine((valor, ctx) => {
    const motivo = motivoDeCodigoInvalido(valor)
    if (motivo !== null) ctx.addIssue({ code: 'custom', message: motivo })
  })

/**
 * Codigo de barras PRINCIPAL.
 *
 * Se acepta vacio y se guarda como null, no como cadena vacia: un producto
 * puede no tener codigo --se busca por nombre-- y dos productos sin codigo con
 * "" chocarian entre si en el indice unico.
 */
export const barcodeSchema = z
  .string()
  .trim()
  .max(64)
  .regex(/^[0-9A-Za-z-]*$/, 'Codigo de barras invalido')
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()

/**
 * Codigos ALTERNATIVOS.
 *
 * Sin duplicados dentro de la misma lista: mandar dos veces el mismo codigo no
 * es un intento de nada, pero guardarlo daria dos filas iguales y la segunda
 * chocaria con el indice unico con un mensaje de PostgreSQL en vez de uno
 * legible.
 *
 * Veinte de tope. Un producto con veinte codigos distintos ya es un problema
 * de catalogo, no una funcionalidad.
 */
export const codigosAlternativosSchema = z
  .array(codigoSchema)
  .max(20, 'Como maximo 20 codigos alternativos')
  .refine((v) => new Set(v).size === v.length, 'Hay codigos repetidos en la lista')
  .optional()

export const stockInicialSchema = quantityOrZeroSchema

/** Unidad de venta. Cinco valores; PACK y BOX no se venden. */
export const unidadDeVentaSchema = z.enum(UNIDADES_DE_VENTA)

/** Unidad de compra. Las cinco de venta mas PACK y BOX. */
export const unidadDeCompraSchema = z.enum(UNIDADES_DE_COMPRA)

/**
 * Cuantas unidades de venta trae una unidad de compra.
 *
 * Mayor que cero: un cero seria una division por cero en la Fase 3C, cuando
 * este numero se use para repartir el costo de una caja entre sus unidades.
 */
export const unidadesPorCompraSchema = z
  .union([z.string(), z.number()])
  .superRefine((valor, ctx) => {
    const texto = typeof valor === 'number' ? valor.toString() : valor.trim()
    if (!/^\d+(\.\d{1,3})?$/.test(texto) || Number(texto) <= 0) {
      ctx.addIssue({ code: 'custom', message: 'Las unidades por compra tienen que ser mayores que cero' }) // prettier-ignore
      return
    }
    if (Number(texto) > CANTIDAD_MAX) {
      ctx.addIssue({ code: 'custom', message: 'Unidades por compra fuera de rango' })
    }
  })
  .transform((valor): string => (typeof valor === 'number' ? valor.toString() : valor.trim()))

/**
 * Alta de producto.
 *
 * No declara `branchId`: la sucursal sale de la sesion.
 *
 * `cost` no exige motivo aca, a diferencia de la edicion: un alta no es un
 * CAMBIO de costo y no escribe historial. El costo con el que nace un producto
 * queda en la bitacora de su creacion.
 */
export const crearProductoSchema = z
  .object({
    name: shortText(150),
    barcode: barcodeSchema,
    alternateBarcodes: codigosAlternativosSchema,
    description: optionalText(500),
    price: amountSchema,
    cost: costSchema.nullable().optional(),
    categoryId: idSchema,
    supplierId: idSchema.nullable().optional(),
    saleUnit: unidadDeVentaSchema.default('UNIT'),
    purchaseUnit: unidadDeCompraSchema.default('UNIT'),
    unitsPerPurchaseUnit: unidadesPorCompraSchema.default('1'),
    totalStock: stockInicialSchema.default('0.000'),
    minimumStock: minimoSchema.default('0.000'),
  })
  .strict()

/**
 * Edicion de producto.
 *
 * Cuatro permisos distintos conviven en el mismo endpoint:
 *
 *   products.update        nombre, codigos, descripcion, categoria, unidades
 *   products.price.update  precio
 *   products.cost.update   costo, y ademas con motivo
 *   stock.adjust           cantidad, y ademas con motivo
 *
 * Todos se comprueban en el servicio: el esquema solo dice que forma tiene la
 * entrada, no quien puede mandarla.
 */
export const editarProductoSchema = z
  .object({
    name: shortText(150).optional(),
    barcode: barcodeSchema,
    alternateBarcodes: codigosAlternativosSchema,
    description: optionalText(500),
    price: amountSchema.optional(),
    cost: costSchema.nullable().optional(),
    categoryId: idSchema.optional(),
    supplierId: idSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    saleUnit: unidadDeVentaSchema.optional(),
    purchaseUnit: unidadDeCompraSchema.optional(),
    unitsPerPurchaseUnit: unidadesPorCompraSchema.optional(),
    minimumStock: minimoSchema.optional(),
    totalStock: stockInicialSchema.optional(),
    /**
     * Motivo del ajuste de inventario. Obligatorio si viene `totalStock`.
     *
     * Antes el ajuste se guardaba con el texto fijo "Ajuste desde la ficha
     * del producto", que en la bitacora no explica nada.
     */
    stockReason: shortText(200).optional(),
    /**
     * Motivo del cambio de costo. Obligatorio si viene `cost`.
     *
     * Un costo que sube sin motivo declarado no se puede explicar despues, y
     * explicar por que subio un precio es para lo que sirve el historial.
     */
    costReason: shortText(200).optional(),
  })
  .strict()
  .refine((v) => v.totalStock === undefined || (v.stockReason ?? '').trim().length >= 3, {
    message: 'Un ajuste de stock necesita un motivo',
    path: ['stockReason'],
  })
  .refine((v) => v.cost === undefined || (v.costReason ?? '').trim().length >= 3, {
    message: 'Un cambio de costo necesita un motivo',
    path: ['costReason'],
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
    /** Busqueda por nombre o por cualquiera de sus codigos de barras. */
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

/** Cambio de costo por su propio endpoint. Exige motivo, siempre. */
export const cambiarCostoSchema = z
  .object({
    cost: costSchema.nullable(),
    reason: shortText(200),
    supplierId: idSchema.nullable().optional(),
  })
  .strict()

/**
 * Alta RAPIDA desde la caja. Fase 5A.1.
 *
 * Seis campos y `.strict()`. Lo que NO declara es tan importante como lo que
 * declara:
 *
 *   `branchId`   sale de la sesion. Declararlo permitiria dar de alta un
 *                producto en otra sucursal desde el mostrador.
 *   `isActive`   un producto que nace de baja no tiene ningun uso.
 *   `totalStock` se llama `initialStock` a proposito: `totalStock` es el campo
 *                de la EDICION, donde significa "dejalo en este numero" y
 *                escribe un ajuste. Aca no hay ajuste, hay un saldo de partida.
 *   `lotTracking` / `expirationTracking`  se configuran en la ficha, con el
 *                flujo de inicializacion de la Fase 4D. Desde la caja no.
 *   `supplierId`, `description`, `minimumStock`, `purchaseUnit`,
 *   `unitsPerPurchaseUnit`, `alternateBarcodes`  se completan despues.
 *
 * `barcode` es OPCIONAL porque el mismo formulario sirve para el alta manual de
 * un producto sin codigo --el artesanal, el fraccionado--. El flujo que nace de
 * un escaneo siempre lo lleva: eso lo garantiza la pantalla, que lo prellena y
 * no lo deja borrar.
 *
 * `cost` viaja pero el servicio lo rechaza sin `products.cost.update`. Esta en
 * el esquema y no afuera para que mandarlo sin permiso de un 403 explicito en
 * vez de un "campo no reconocido", que es un mensaje que no ayuda a nadie.
 */
export const crearProductoRapidoSchema = z
  .object({
    barcode: codigoSchema.nullable().optional(),
    name: shortText(150),
    price: amountSchema,
    categoryId: idSchema,
    saleUnit: unidadDeVentaSchema.default('UNIT'),
    /** Lo que hay para vender AHORA. Entra al libro como `INITIAL`. */
    initialStock: stockInicialSchema.default('0.000'),
    cost: costSchema.nullable().optional(),
  })
  .strict()

export type CrearProductoInput = z.infer<typeof crearProductoSchema>
export type CrearProductoRapidoInput = z.infer<typeof crearProductoRapidoSchema>
export type EditarProductoInput = z.infer<typeof editarProductoSchema>
export type ListarProductosQuery = z.infer<typeof listarProductosQuerySchema>
export type CambiarCostoInput = z.infer<typeof cambiarCostoSchema>
