// src/app/api/cash/[id]/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import jwt from 'jsonwebtoken'

interface JwtPayload {
  userId: number
  role: string
  branchId: number
  iat?: number
  exp?: number
}

// Helper para extraer/verificar JWT desde la cookie
function getUserFromCookie(req: Request): { userId: number; branchId: number } {
  const cookieHeader = req.headers.get('cookie') || ''
  const match = cookieHeader.match(/token=([^;]+)/)
  if (!match) throw new Error('No token cookie')
  const token = match[1]
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  return { userId: decoded.userId, branchId: decoded.branchId }
}

/*export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    // ─── 1) Autenticación + autorización ─────────────────────────────────────
    let userId: number, branchId: number
    try {
      const payload = getUserFromCookie(req)
      userId = payload.userId
      branchId = payload.branchId
    } catch {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // 2) ID del CashRegisterMovement a eliminar
    const movementId = Number(params.id)
    if (isNaN(movementId)) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // 3) Obtener el CashRegisterMovement
    const movement = await prisma.cashRegisterMovement.findUnique({
      where: { id: movementId },
    })
    if (!movement) {
      return NextResponse.json({ error: 'Movimiento no encontrado' }, { status: 404 })
    }
    // Solo permitimos borrar movimientos de la misma sucursal
    if (movement.branchId !== branchId) {
      return NextResponse.json({ error: 'No autorizado para esta acción' }, { status: 403 })
    }

    // 4) Extraer saleId desde la descripción ("Venta #<saleId>")
    const description = movement.description || ''
    const match = description.match(/Venta\s*#(\d+)/i)
    if (!match) {
      return NextResponse.json(
        { error: 'No se pudo determinar el ID de venta desde la descripción' },
        { status: 400 }
      )
    }
    const saleId = Number(match[1])
    if (isNaN(saleId)) {
      return NextResponse.json({ error: 'Sale ID inválido en descripción' }, { status: 400 })
    }

    // 5) Buscar la venta junto con sus items
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    })
    if (!sale) {
      return NextResponse.json(
        { error: `La venta #${saleId} no existe. No se puede cancelar.` },
        { status: 404 }
      )
    }
    // Asegurarnos de que la venta pertenezca a la misma sucursal
    if (sale.branchId !== branchId) {
      return NextResponse.json(
        { error: 'La venta no pertenece a esta sucursal' },
        { status: 403 }
      )
    }

    // 6) RESTAURAR STOCK para cada SaleItem
    for (const item of sale.items) {
      const stockRecord = await prisma.branchStock.findUnique({
        where: {
          branchId_productId: {
            branchId,
            productId: item.productId,
          },
        },
      })

      if (stockRecord) {
        await prisma.branchStock.update({
          where: { id: stockRecord.id },
          data: { quantity: stockRecord.quantity + item.quantity },
        })
      }
    }

    // 7) RESTAURAR EFECTIVO en Branch.currentCash SOLO SI FUE pago en efectivo
    if (movement.paymentMethod === 'efectivo') {
      const refundAmount = movement.amount

      const branchRecord = await prisma.branch.findUnique({ where: { id: branchId } })
      if (!branchRecord) {
        return NextResponse.json(
          { error: 'No se encontró registro de sucursal para actualizar efectivo.' },
          { status: 500 }
        )
      }
      const beforeCash = branchRecord.currentCash
      const newCash = beforeCash - refundAmount

      await prisma.branch.update({
        where: { id: branchId },
        data: { currentCash: newCash },
      })

      await prisma.auditLog.create({
        data: {
          userId,
          tableName: 'Branch',
          recordId: branchId,
          actionType: 'update',
          changes: {
            before: { currentCash: beforeCash },
            after: { currentCash: newCash },
          },
          origin: 'api-cash-delete',
        },
      })
    }

    // 8) BORRAR cada SaleItem con auditoría
    for (const item of sale.items) {
      await prisma.auditLog.create({
        data: {
          userId,
          tableName: 'SaleItem',
          recordId: item.id,
          actionType: 'delete',
          changes: { before: item, after: null },
          origin: 'api-cash-delete',
        },
      })
      await prisma.saleItem.delete({ where: { id: item.id } })
    }

    // 9) BORRAR la venta con auditoría
    await prisma.auditLog.create({
      data: {
        userId,
        tableName: 'Sale',
        recordId: saleId,
        actionType: 'delete',
        changes: { before: sale, after: null },
        origin: 'api-cash-delete',
      },
    })
    await prisma.sale.delete({ where: { id: saleId } })

    // 10) BORRAR el movimiento de caja con auditoría
    await prisma.auditLog.create({
      data: {
        userId,
        tableName: 'CashRegisterMovement',
        recordId: movementId,
        actionType: 'delete',
        changes: { before: movement, after: null },
        origin: 'api-cash-delete',
      },
    })
    await prisma.cashRegisterMovement.delete({ where: { id: movementId } })

    return NextResponse.json({ message: 'Venta cancelada y movimiento eliminado.' })
  } catch (error: any) {
    console.error('Error eliminando /api/cash/[id]:', error)
    return NextResponse.json(
      { error: 'Error al eliminar el movimiento de caja.' },
      { status: 500 }
    )
  }
}*/
