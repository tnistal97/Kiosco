/**
 * Reglas de negocio del stock.
 *
 * Regla que gobierna todo el modulo: el stock nunca puede quedar negativo, y
 * la comprobacion tiene que ocurrir DENTRO de la sentencia que escribe. Leer
 * la cantidad, decidir en JavaScript y despues escribir deja una ventana en
 * la que otra operacion se lleva las unidades.
 *
 * Cada ajuste exige motivo y queda auditado con cantidad anterior, posterior,
 * diferencia, usuario y sucursal. Esa informacion es exactamente la que va a
 * necesitar `StockMovement` cuando exista: hoy vive en `AuditLog`.
 */

import { prisma } from '@/lib/prisma'
import { audit } from '@/server/audit/audit'
import { conflict, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import type { AjusteAbsolutoInput, AjusteRelativoInput } from './schemas'

export interface StockDeProducto {
  id: number
  productId: number
  name: string
  barcode: string | null
  price: number
  category: { id: number; name: string }
  quantity: number
}

export interface StockAjustado {
  productId: number
  quantity: number
}

/**
 * Comprueba que el producto exista Y pertenezca a la sucursal de la sesion.
 *
 * Devuelve 404, no 403, cuando es de otra sucursal: un 403 confirmaria que
 * el producto existe en algun lado, que ya es informacion.
 */
async function exigirProductoDeLaSucursal(session: Session, productId: number): Promise<void> {
  const producto = await prisma.product.findFirst({
    where: { id: productId, branchId: session.branchId },
    select: { id: true },
  })
  if (!producto) throw notFound('Producto no encontrado')
}

export async function stockDe(session: Session, productId: number): Promise<StockDeProducto> {
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
}

/** Fija la cantidad exacta. Es el recuento de inventario. */
export async function fijarStock(
  session: Session,
  productId: number,
  input: AjusteAbsolutoInput,
): Promise<StockAjustado> {
  await exigirProductoDeLaSucursal(session, productId)

  return prisma.$transaction(async (tx) => {
    const antes = await tx.branchStock.findUnique({
      where: { branchId_productId: { branchId: session.branchId, productId } },
      select: { quantity: true },
    })

    const despues = await tx.branchStock.upsert({
      where: { branchId_productId: { branchId: session.branchId, productId } },
      update: { quantity: input.quantity },
      create: { branchId: session.branchId, productId, quantity: input.quantity },
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
        motivo: input.reason,
        branchId: session.branchId,
        productId,
      },
      origin: 'PUT /api/stock/:productId',
    })

    return { productId, quantity: despues.quantity }
  })
}

/** Suma o resta unidades. Entrada de mercaderia, rotura, faltante. */
export async function ajustarStock(
  session: Session,
  productId: number,
  input: AjusteRelativoInput,
): Promise<StockAjustado> {
  await exigirProductoDeLaSucursal(session, productId)

  return prisma.$transaction(async (tx) => {
    // La condicion `quantity + delta >= 0` va dentro del UPDATE para que sea
    // atomica: si el resultado quedaria negativo, no se aplica.
    const filas = await tx.$executeRaw`
      UPDATE "BranchStock"
      SET "quantity" = "quantity" + ${input.delta}
      WHERE "branchId" = ${session.branchId}
        AND "productId" = ${productId}
        AND "quantity" + ${input.delta} >= 0
    `

    if (filas !== 1) {
      // O no hay fila de stock todavia, o el ajuste dejaria negativo.
      const actual = await tx.branchStock.findUnique({
        where: { branchId_productId: { branchId: session.branchId, productId } },
        select: { quantity: true },
      })

      if (!actual && input.delta > 0) {
        const creado = await tx.branchStock.create({
          data: { branchId: session.branchId, productId, quantity: input.delta },
          select: { id: true, quantity: true },
        })
        await audit(tx, {
          userId: session.userId,
          table: 'BranchStock',
          recordId: creado.id,
          action: 'create',
          after: {
            quantity: creado.quantity,
            diferencia: input.delta,
            motivo: input.reason,
            branchId: session.branchId,
            productId,
          },
          origin: 'PATCH /api/stock/:productId',
        })
        return { productId, quantity: creado.quantity }
      }

      throw conflict(
        `El ajuste dejaria el stock en negativo: hay ${actual?.quantity ?? 0} y se pidio ${input.delta}`,
        { code: 'INSUFFICIENT_STOCK' },
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
      before: { quantity: despues.quantity - input.delta },
      after: {
        quantity: despues.quantity,
        diferencia: input.delta,
        motivo: input.reason,
        branchId: session.branchId,
        productId,
      },
      origin: 'PATCH /api/stock/:productId',
    })

    return { productId, quantity: despues.quantity }
  })
}
