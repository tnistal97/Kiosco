/**
 * Reporte de ventas por rango de fechas.
 *
 * Vive aparte de `service.ts` porque es lectura y no toca nada: no comparte
 * ni una linea con el registro ni con la anulacion, que son las dos
 * operaciones delicadas del modulo.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { invalid } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import { MAX_DIAS_REPORTE, type ReporteVentasQuery } from './schemas'
import type { Monto } from '@/lib/money'
import type { TextoCantidad } from '@/lib/cantidad'
import { aMonto, multiplicar, redondearPesos, sumar, type Dinero } from '@/server/money'
import { aTextoCantidad, type Cantidad } from '@/server/cantidad'
import { unidadDeVentaODefecto, type UnidadDeVenta } from '@/modules/products/units'

export interface VentaDelReporte {
  id: number
  date: string
  status: string
  canceledAt: Date | null
  cancelReason: string | null
  paymentMethod: string | null
  total: Monto
  user: { id: number; name: string }
  canceledBy: { id: number; name: string } | null
  items: Array<{
    id: number
    quantity: TextoCantidad
    /** La unidad en la que se vendio. Sin ella `0.425` no se puede leer. */
    saleUnit: UnidadDeVenta
    price: Monto
    product: { id: number; name: string }
  }>
}

export interface TotalesDelReporte {
  /** Ventas no anuladas del rango completo, no solo de la pagina. */
  ventas: number
  anuladas: number
  recaudado: Monto
}

/**
 * Total de una lista de lineas.
 *
 * Cada subtotal se redondea a dos decimales y despues se suman, en ese orden y
 * no al reves: es como se arma el ticket, y el reporte tiene que dar lo mismo
 * que el papel que se llevo el cliente.
 */
function totalDeLineas(lineas: Array<{ price: Dinero; quantity: Cantidad }>): Dinero {
  return sumar(...lineas.map((l) => redondearPesos(multiplicar(l.price, l.quantity))))
}

/**
 * Ventas del rango, paginadas, con los totales del rango entero.
 *
 * Los totales se calculan sobre todo el rango y no sobre la pagina: si se
 * sumaran los de la pagina, cambiar de pagina cambiaria la recaudacion del
 * mes, que es exactamente lo que un reporte no debe hacer.
 */
export async function reporteDeVentas(
  session: Session,
  query: ReporteVentasQuery,
): Promise<Paginated<VentaDelReporte> & { totales: TotalesDelReporte }> {
  const desde = new Date(`${query.start}T00:00:00.000Z`)
  const hasta = new Date(`${query.end}T23:59:59.999Z`)

  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
    throw invalid('Fechas invalidas')
  }
  if (desde > hasta) throw invalid('La fecha inicial es posterior a la final')

  const dias = (hasta.getTime() - desde.getTime()) / (24 * 60 * 60 * 1000)
  if (dias > MAX_DIAS_REPORTE) throw invalid(`El rango no puede superar ${MAX_DIAS_REPORTE} dias`)

  const where: Prisma.SaleWhereInput = {
    branchId: session.branchId,
    date: { gte: desde, lte: hasta },
    ...(query.estado === 'todas' ? {} : { status: query.estado }),
    ...(query.userId === undefined ? {} : { userId: query.userId }),
    ...(query.saleId === undefined ? {} : { id: query.saleId }),
    // El medio de pago no vive en Sale sino en el movimiento de caja que la
    // venta genera. Se filtra por la relacion, no por un campo que no existe.
    ...(query.paymentMethod === undefined
      ? {}
      : { cashMovements: { some: { type: 'sale', paymentMethod: query.paymentMethod } } }),
  }

  const [total, anuladas, ventas] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.count({ where: { ...where, status: 'canceled' } }),
    prisma.sale.findMany({
      where,
      orderBy: { date: 'desc' },
      ...toSkipTake(query),
      select: {
        id: true,
        date: true,
        status: true,
        canceledAt: true,
        cancelReason: true,
        user: { select: { id: true, name: true } },
        canceledBy: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            price: true,
            product: { select: { id: true, name: true, saleUnit: true } },
          },
        },
        // El medio de pago sale del movimiento vinculado por `saleId`. Antes
        // se deducia parseando "Venta #123" del texto de la descripcion y, si
        // no coincidia, asumia "efectivo" en silencio: cualquier venta con
        // tarjeta cuya descripcion no encajara figuraba como efectivo.
        cashMovements: {
          where: { type: 'sale' },
          select: { paymentMethod: true },
          take: 1,
        },
      },
    }),
  ])

  // La recaudacion del rango completo, en una sola consulta agregada sobre
  // los items de las ventas no anuladas. Sumarla trayendo todas las ventas
  // seria volver a lo que la paginacion vino a evitar.
  const recaudado = await prisma.saleItem.findMany({
    where: { sale: { ...where, status: 'completed' } },
    select: { price: true, quantity: true },
  })

  const data: VentaDelReporte[] = ventas.map(({ cashMovements, items, ...venta }) => ({
    ...venta,
    date: venta.date.toISOString(),
    paymentMethod: cashMovements[0]?.paymentMethod ?? null,
    items: items.map(({ product, ...i }) => ({
      ...i,
      quantity: aTextoCantidad(i.quantity),
      saleUnit: unidadDeVentaODefecto(product.saleUnit),
      price: aMonto(i.price),
      product: { id: product.id, name: product.name },
    })),
    total: aMonto(totalDeLineas(items)),
  }))

  return {
    ...paginado(data, total, query),
    totales: {
      ventas: total - anuladas,
      anuladas,
      recaudado: aMonto(totalDeLineas(recaudado)),
    },
  }
}
