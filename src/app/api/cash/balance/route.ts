// src/app/api/cash/balance/route.ts
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { notFound } from '@/server/http/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Saldo en efectivo de la sucursal.
 *
 * Se devuelve tambien la suma de los movimientos en efectivo del dia, para
 * que la pantalla pueda mostrar si el saldo acumulado y los movimientos
 * coinciden. `currentCash` es un total corrido desde que se instalo el
 * sistema: no hay turno de caja todavia. Eso llega en la fase 2 con
 * CashSession, y es el cambio que vuelve confiable el arqueo.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'cash.view',
    audit: 'GET /api/cash/balance',
  },
  async ({ session }) => {
    const sucursal = await prisma.branch.findUnique({
      where: { id: session.branchId },
      select: { currentCash: true },
    })
    if (!sucursal) throw notFound('Sucursal no encontrada')

    const ahora = new Date()
    const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())

    const hoy = await prisma.cashRegisterMovement.aggregate({
      where: {
        branchId: session.branchId,
        paymentMethod: 'efectivo',
        date: { gte: inicioHoy },
      },
      _sum: { amount: true },
    })

    return {
      balance: sucursal.currentCash,
      efectivoHoy: hoy._sum.amount ?? 0,
    }
  },
)
