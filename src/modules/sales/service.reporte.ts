/**
 * Reporte de ventas por rango de fechas.
 *
 * Vive aparte de `service.ts` porque es lectura y no toca nada: no comparte
 * ni una linea con el registro ni con la anulacion, que son las dos
 * operaciones delicadas del modulo.
 */

import { prisma } from '@/lib/prisma'
import { invalid } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import { MAX_DIAS_REPORTE, type ReporteVentasQuery } from './schemas'

export interface VentaDelReporte {
  id: number
  date: string
  status: string
  canceledAt: Date | null
  cancelReason: string | null
  paymentMethod: string | null
  total: number
  user: { id: number; name: string }
  canceledBy: { id: number; name: string } | null
  items: Array<{
    id: number
    quantity: number
    price: number
    product: { id: number; name: string }
  }>
}

export interface TotalesDelReporte {
  /** Ventas no anuladas del rango completo, no solo de la pagina. */
  ventas: number
  anuladas: number
  recaudado: number
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
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

  const where = { branchId: session.branchId, date: { gte: desde, lte: hasta } }

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
            product: { select: { id: true, name: true } },
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

  const data: VentaDelReporte[] = ventas.map(({ cashMovements, ...venta }) => ({
    ...venta,
    date: venta.date.toISOString(),
    paymentMethod: cashMovements[0]?.paymentMethod ?? null,
    total: redondear(venta.items.reduce((s, i) => s + i.price * i.quantity, 0)),
  }))

  return {
    ...paginado(data, total, query),
    totales: {
      ventas: total - anuladas,
      anuladas,
      recaudado: redondear(recaudado.reduce((s, i) => s + i.price * i.quantity, 0)),
    },
  }
}
