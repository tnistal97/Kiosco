// src/app/api/cash/[id]/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import type { Prisma } from '@prisma/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type JwtPayload = {
  userId: number
  role: string
  branchId: number
  iat?: number
  exp?: number
}

async function getAuth() {
  const store = await cookies()
  const token = store.get('token')?.value
  if (!token) throw new Error('no_token')
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  if (!decoded?.branchId || !decoded?.userId) throw new Error('token_missing_claims')
  return { branchId: decoded.branchId, userId: decoded.userId }
}

function getIdFromRequest(req: NextRequest): number | null {
  const { pathname } = new URL(req.url)
  const idStr = pathname.split('/').pop() ?? ''
  const id = Number(idStr)
  return Number.isFinite(id) ? id : null
}

// GET /api/cash/:id  → one CashRegisterMovement restricted to user’s branch
export async function GET(req: NextRequest) {
  try {
    const { branchId } = await getAuth()
    const numericId = getIdFromRequest(req)
    if (numericId === null) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    const mov = await prisma.cashRegisterMovement.findFirst({
      where: { id: numericId, branchId },
      select: {
        id: true,
        branchId: true,
        userId: true,
        amount: true,
        paymentMethod: true,
        description: true,
        date: true,
        type: true,
      },
    })

    if (!mov) {
      return NextResponse.json(
        { error: 'Movimiento no encontrado o no autorizado' },
        { status: 404 },
      )
    }

    return NextResponse.json(mov)
  } catch (e: any) {
    const msg = e?.message === 'no_token' ? 'No autenticado' : 'Error interno'
    const code = e?.message === 'no_token' ? 401 : 500
    return NextResponse.json({ error: msg }, { status: code })
  }
}

// DELETE /api/cash/:id → cancel sale linked in movement description and remove movement
export async function DELETE(req: NextRequest) {
  try {
    const { branchId, userId } = await getAuth()
    const movementId = getIdFromRequest(req)
    if (movementId === null) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 })
    }

    // Load movement and validate branch
    const movement = await prisma.cashRegisterMovement.findUnique({
      where: { id: movementId },
    })
    if (!movement) {
      return NextResponse.json({ error: 'Movimiento no encontrado' }, { status: 404 })
    }
    if (movement.branchId !== branchId) {
      return NextResponse.json({ error: 'No autorizado para esta acción' }, { status: 403 })
    }

    // Extract saleId from description like: "Venta #123"
    const desc = movement.description || ''
    const m = desc.match(/Venta\s*#(\d+)/i)
    if (!m) {
      return NextResponse.json(
        { error: 'No se pudo determinar el ID de venta desde la descripción' },
        { status: 400 },
      )
    }
    const saleId = Number(m[1])
    if (!Number.isFinite(saleId)) {
      return NextResponse.json({ error: 'Sale ID inválido en descripción' }, { status: 400 })
    }

    // Do everything atomically
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Validate sale and branch
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { items: true },
      })
      if (!sale) {
        throw new Error('SALE_NOT_FOUND') // caught below
      }
      if (sale.branchId !== branchId) {
        throw new Error('SALE_WRONG_BRANCH')
      }

      // Restore stock for each item
      for (const item of sale.items) {
        const stock = await tx.branchStock.findUnique({
          where: { branchId_productId: { branchId, productId: item.productId } },
        })
        if (stock) {
          await tx.branchStock.update({
            where: { id: stock.id },
            data: { quantity: stock.quantity + item.quantity },
          })
        }
      }

      // If cash payment, restore branch currentCash
      if (movement.paymentMethod === 'efectivo') {
        const branch = await tx.branch.findUnique({ where: { id: branchId } })
        if (!branch) throw new Error('BRANCH_NOT_FOUND')
        const beforeCash = branch.currentCash
        const newCash = beforeCash - movement.amount
        await tx.branch.update({ where: { id: branchId }, data: { currentCash: newCash } })
        await tx.auditLog.create({
          data: {
            userId,
            tableName: 'Branch',
            recordId: branchId,
            actionType: 'update',
            changes: { before: { currentCash: beforeCash }, after: { currentCash: newCash } },
            origin: 'api-cash-delete',
          },
        })
      }

      // Audit + delete sale items
      for (const item of sale.items) {
        await tx.auditLog.create({
          data: {
            userId,
            tableName: 'SaleItem',
            recordId: item.id,
            actionType: 'delete',
            changes: { before: item, after: null },
            origin: 'api-cash-delete',
          },
        })
        await tx.saleItem.delete({ where: { id: item.id } })
      }

      // Audit + delete sale
      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'Sale',
          recordId: saleId,
          actionType: 'delete',
          changes: { before: sale, after: null },
          origin: 'api-cash-delete',
        },
      })
      await tx.sale.delete({ where: { id: saleId } })

      // Audit + delete movement
      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'CashRegisterMovement',
          recordId: movementId,
          actionType: 'delete',
          changes: { before: movement, after: null },
          origin: 'api-cash-delete',
        },
      })
      await tx.cashRegisterMovement.delete({ where: { id: movementId } })
    })

    return NextResponse.json({ message: 'Venta cancelada y movimiento eliminado.' })
  } catch (error: any) {
    if (error?.message === 'SALE_NOT_FOUND') {
      return NextResponse.json(
        { error: 'La venta no existe. No se puede cancelar.' },
        { status: 404 },
      )
    }
    if (error?.message === 'SALE_WRONG_BRANCH') {
      return NextResponse.json(
        { error: 'La venta no pertenece a esta sucursal' },
        { status: 403 },
      )
    }
    if (error?.message === 'BRANCH_NOT_FOUND') {
      return NextResponse.json(
        { error: 'No se encontró registro de sucursal para actualizar efectivo.' },
        { status: 500 },
      )
    }
    const msg = error?.message === 'no_token' ? 'No autenticado' : 'Error al eliminar el movimiento de caja.'
    const code = error?.message === 'no_token' ? 401 : 500
    console.error('Error eliminando /api/cash/[id]:', error)
    return NextResponse.json({ error: msg }, { status: code })
  }
}
