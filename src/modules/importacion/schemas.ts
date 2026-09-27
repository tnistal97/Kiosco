/**
 * Lo que el navegador le manda al servidor para importar productos.
 *
 * Nunca el archivo: las celdas de las columnas elegidas, fila por fila, con su
 * numero de fila de Excel. Todo con topes --filas, largo de cada celda, forma
 * de cada numero-- porque del otro lado puede no haber un navegador.
 *
 * Este modulo NO importa Prisma: la pantalla usa las constantes.
 */

import { z } from 'zod'
import { CAMPOS } from './columnas'
import { PRODUCTOS_MAXIMOS } from './planilla'

/**
 * Que hacer con los productos del archivo segun si ya estan en el catalogo.
 *
 *   solo-nuevos          agrega los que no estan; los que ya estan no se tocan
 *   nuevos-y-existentes  agrega los que no estan y actualiza los que si
 *   solo-existentes      actualiza los que ya estan; no agrega nada. Es el caso
 *                        de la lista de precios de un proveedor: trae cien
 *                        productos que el almacen no vende y no hay que darlos
 *                        de alta.
 */
export const MODOS = ['solo-nuevos', 'nuevos-y-existentes', 'solo-existentes'] as const
export type Modo = (typeof MODOS)[number]

/**
 * Que hacer con la columna de stock.
 *
 *   no-tocar  el stock no cambia. Los productos nuevos arrancan en cero.
 *   ajustar   el stock QUEDA en el numero del archivo: se registra la
 *             diferencia contra lo que hay, como un recuento.
 *   sumar     el numero del archivo ENTRA: se suma a lo que hay.
 *
 * Los dos ultimos pasan por el libro de movimientos. El stock nunca se pisa.
 */
export const MODOS_DE_STOCK = ['no-tocar', 'ajustar', 'sumar'] as const
export type ModoDeStock = (typeof MODOS_DE_STOCK)[number]

/** Hasta mil caracteres por celda: un nombre largo tiene ciento cincuenta. */
const valorCrudoSchema = z.union([
  z.string().max(1000),
  z
    .object({
      n: z
        .string()
        .max(40)
        .regex(/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/, 'Número de Excel inválido'),
    })
    .strict(),
])

const filaSchema = z
  .object({
    f: z.number().int().positive().max(1_048_576),
    v: z.array(valorCrudoSchema).max(CAMPOS.length),
  })
  .strict()

const base = z
  .object({
    /** Solo para la bitacora y los motivos: "Importacion de lista.xlsx". */
    archivo: z.string().trim().min(1).max(200),
    campos: z.array(z.enum(CAMPOS)).min(1).max(CAMPOS.length),
    filas: z
      .array(filaSchema)
      .min(1, 'La planilla no tiene productos')
      .max(PRODUCTOS_MAXIMOS, `Como máximo ${PRODUCTOS_MAXIMOS} productos por archivo`),
    modo: z.enum(MODOS),
    stock: z.enum(MODOS_DE_STOCK),
  })
  .strict()

type Base = z.infer<typeof base>

function coherente(v: Base, ctx: z.RefinementCtx): void {
  if (new Set(v.campos).size !== v.campos.length) {
    ctx.addIssue({ code: 'custom', message: 'Hay un campo repetido', path: ['campos'] })
  }
  if (v.stock !== 'no-tocar' && !v.campos.includes('stock')) {
    ctx.addIssue({
      code: 'custom',
      message: 'Para cambiar el stock hay que elegir la columna del stock',
      path: ['stock'],
    })
  }
  const vistas = new Set<number>()
  for (const [i, fila] of v.filas.entries()) {
    if (fila.v.length !== v.campos.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'La fila no trae un valor por campo',
        path: ['filas', i],
      })
      return
    }
    if (vistas.has(fila.f)) {
      ctx.addIssue({ code: 'custom', message: 'Número de fila repetido', path: ['filas', i] })
      return
    }
    vistas.add(fila.f)
  }
}

/** Pedido de vista previa. No escribe nada. */
export const vistaPreviaSchema = base.superRefine(coherente)

/**
 * Pedido de importacion: lo mismo que la vista previa mas lo que la ata a ella.
 *
 *   importacion  identificador que dio la vista previa. Una importacion ya
 *                aplicada con ese identificador no se aplica de nuevo: es lo
 *                que vuelve inofensivo el doble clic.
 *   huella       resumen de lo que la vista previa dijo que iba a pasar. Si al
 *                aplicar el plan da otro --alguien cargo un producto del
 *                archivo en el medio--, no se aplica y se pide revisar.
 */
export const importarSchema = base
  .extend({
    importacion: z.uuid(),
    huella: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .superRefine(coherente)

export type PedidoDeVistaPrevia = z.infer<typeof vistaPreviaSchema>
export type PedidoDeImportacion = z.infer<typeof importarSchema>
