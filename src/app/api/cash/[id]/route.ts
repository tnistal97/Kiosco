// src/app/api/cash/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { notFound } from '@/server/http/errors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'cash.view',
    audit: 'GET /api/cash/:id',
  },
  async ({ session, params }) => {
    const id = parseWith(idSchema, params.id)

    const movimiento = await prisma.cashRegisterMovement.findFirst({
      where: { id, branchId: session.branchId },
      select: {
        id: true,
        branchId: true,
        userId: true,
        amount: true,
        paymentMethod: true,
        description: true,
        date: true,
        type: true,
        saleId: true,
      },
    })

    if (!movimiento) throw notFound('Movimiento no encontrado')
    return movimiento
  },
)

/**
 * No existe DELETE en esta ruta.
 *
 * Habia un `DELETE /api/cash/:id` que, a partir de un movimiento de caja,
 * deducia la venta parseando "Venta #123" de la descripcion y borraba
 * fisicamente la venta, sus items y el movimiento. Tres problemas:
 *
 *   1. Destruia registros financieros, que despues no se pueden auditar.
 *   2. Si alguien editaba la descripcion, borraba la venta equivocada.
 *   3. Cualquier usuario con sesion podia hacerlo, sin permiso especifico.
 *
 * Lo reemplaza `POST /api/sales/:id/cancel`, que anula sin borrar, exige
 * permiso y motivo, y deja el contramovimiento en la caja.
 */
