// src/app/api/admin/sales/route.ts
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { invalid } from '@/server/http/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const rangoSchema = z
  .object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato esperado: YYYY-MM-DD'),
  })
  .strict()

/** Tope de rango: evita que una consulta traiga anos enteros de una vez. */
const MAX_DIAS = 366

/**
 * Ventas de un rango de fechas, para la pantalla administrativa.
 *
 * El medio de pago sale del movimiento de caja vinculado por `saleId`. Antes
 * se deducia parseando "Venta #123" del texto de la descripcion y, si no
 * encontraba coincidencia, asumia "efectivo" en silencio: cualquier venta con
 * tarjeta cuya descripcion no coincidiera figuraba como efectivo en el reporte.
 *
 * Las ventas anuladas se incluyen con su estado. No desaparecen del historial.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.view',
    query: rangoSchema,
    audit: 'GET /api/admin/sales',
  },
  async ({ session, query }) => {
    const desde = new Date(`${query.start}T00:00:00.000Z`)
    const hasta = new Date(`${query.end}T23:59:59.999Z`)

    if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) {
      throw invalid('Fechas invalidas')
    }
    if (desde > hasta) throw invalid('La fecha inicial es posterior a la final')

    const dias = (hasta.getTime() - desde.getTime()) / (24 * 60 * 60 * 1000)
    if (dias > MAX_DIAS) throw invalid(`El rango no puede superar ${MAX_DIAS} dias`)

    const ventas = await prisma.sale.findMany({
      where: { branchId: session.branchId, date: { gte: desde, lte: hasta } },
      orderBy: { date: 'desc' },
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
        cashMovements: {
          where: { type: 'sale' },
          select: { paymentMethod: true },
          take: 1,
        },
      },
    })

    return {
      sales: ventas.map(({ cashMovements, ...venta }) => ({
        ...venta,
        date: venta.date.toISOString(),
        paymentMethod: cashMovements[0]?.paymentMethod ?? null,
        total: Math.round(venta.items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100,
      })),
    }
  },
)
