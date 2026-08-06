// src/app/api/stock/[id]/route.ts
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { audit } from '@/server/audit/audit'
import { conflict, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { ajusteAbsolutoSchema, ajusteRelativoSchema } from '@/modules/stock/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ajustes de inventario de UN producto de la sucursal propia.
 *
 * El id de la URL es el del producto. La sucursal nunca se recibe: sale de la
 * sesion. El endpoint de coleccion `/api/stock`, que aceptaba branchId del
 * cliente sin autenticacion, fue eliminado.
 *
 * Todo ajuste exige motivo y queda auditado con usuario, sucursal, cantidad
 * anterior y posterior. Es el paso previo a `StockMovement`: cuando exista el
 * libro de movimientos, estas mismas llamadas escribiran una fila alli en vez
 * de sobrescribir `quantity`.
 */
async function comprobarProducto(session: Session, productId: number): Promise<void> {
  const producto = await prisma.product.findFirst({
    where: { id: productId, branchId: session.branchId },
    select: { id: true },
  })
  if (!producto) throw notFound('Producto no encontrado')
}

export const GET = handler(
  {
    auth: 'session',
    permission: 'stock.view',
    audit: 'GET /api/stock/:productId',
  },
  async ({ session, params }) => {
    const productId = parseWith(idSchema, params.id)

    const producto = await prisma.product.findFirst({
      where: { id: productId, branchId: session.branchId },
      select: {
        id: true,
        name: true,
        barcode: true,
        price: true,
        category: { select: { id: true, name: true } },
      },
    })
    if (!producto) throw notFound('Producto no encontrado')

    const stock = await prisma.branchStock.findUnique({
      where: { branchId_productId: { branchId: session.branchId, productId } },
      select: { quantity: true },
    })

    return { ...producto, productId: producto.id, quantity: stock?.quantity ?? 0 }
  },
)

/** PUT: fija la cantidad exacta (recuento de inventario). */
export const PUT = handler(
  {
    auth: 'session',
    permission: 'stock.adjust',
    body: ajusteAbsolutoSchema,
    audit: 'PUT /api/stock/:productId',
  },
  async ({ session, body, params }) => {
    const productId = parseWith(idSchema, params.id)
    await comprobarProducto(session, productId)

    return prisma.$transaction(async (tx) => {
      const antes = await tx.branchStock.findUnique({
        where: { branchId_productId: { branchId: session.branchId, productId } },
        select: { quantity: true },
      })

      const despues = await tx.branchStock.upsert({
        where: { branchId_productId: { branchId: session.branchId, productId } },
        update: { quantity: body.quantity },
        create: { branchId: session.branchId, productId, quantity: body.quantity },
        select: { id: true, quantity: true },
      })

      await audit(tx, {
        userId: session.userId,
        table: 'BranchStock',
        recordId: despues.id,
        action: 'update',
        before: { quantity: antes?.quantity ?? 0 },
        after: {
          quantity: despues.quantity,
          diferencia: despues.quantity - (antes?.quantity ?? 0),
          motivo: body.reason,
          branchId: session.branchId,
        },
        origin: 'PUT /api/stock/:productId',
      })

      return { productId, quantity: despues.quantity }
    })
  },
)

/** PATCH: suma o resta unidades (entrada de mercaderia, rotura, faltante). */
export const PATCH = handler(
  {
    auth: 'session',
    permission: 'stock.adjust',
    body: ajusteRelativoSchema,
    audit: 'PATCH /api/stock/:productId',
  },
  async ({ session, body, params }) => {
    const productId = parseWith(idSchema, params.id)
    await comprobarProducto(session, productId)

    return prisma.$transaction(async (tx) => {
      // Ajuste condicional: si el resultado quedaria negativo, no se aplica.
      // La comprobacion va dentro del UPDATE para que sea atomica.
      const filas = await tx.$executeRaw`
        UPDATE "BranchStock"
        SET "quantity" = "quantity" + ${body.delta}
        WHERE "branchId" = ${session.branchId}
          AND "productId" = ${productId}
          AND "quantity" + ${body.delta} >= 0
      `

      if (filas !== 1) {
        // O no hay fila de stock todavia, o el ajuste dejaria negativo.
        const actual = await tx.branchStock.findUnique({
          where: { branchId_productId: { branchId: session.branchId, productId } },
          select: { quantity: true },
        })

        if (!actual && body.delta > 0) {
          const creado = await tx.branchStock.create({
            data: { branchId: session.branchId, productId, quantity: body.delta },
            select: { id: true, quantity: true },
          })
          await audit(tx, {
            userId: session.userId,
            table: 'BranchStock',
            recordId: creado.id,
            action: 'create',
            after: { quantity: creado.quantity, motivo: body.reason, branchId: session.branchId },
            origin: 'PATCH /api/stock/:productId',
          })
          return { productId, quantity: creado.quantity }
        }

        throw conflict(
          `El ajuste dejaria el stock en negativo: hay ${actual?.quantity ?? 0} y se pidio ${body.delta}`,
        )
      }

      const despues = await tx.branchStock.findUniqueOrThrow({
        where: { branchId_productId: { branchId: session.branchId, productId } },
        select: { id: true, quantity: true },
      })

      await audit(tx, {
        userId: session.userId,
        table: 'BranchStock',
        recordId: despues.id,
        action: 'update',
        before: { quantity: despues.quantity - body.delta },
        after: {
          quantity: despues.quantity,
          diferencia: body.delta,
          motivo: body.reason,
          branchId: session.branchId,
        },
        origin: 'PATCH /api/stock/:productId',
      })

      return { productId, quantity: despues.quantity }
    })
  },
)
