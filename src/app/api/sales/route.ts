// src/app/api/sales/route.ts
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

// Helper para leer/verificar JWT desde la cookie
function getUserFromCookie(req: Request): { userId: number; branchId: number } {
  const cookieHeader = req.headers.get('cookie') || ''
  const match = cookieHeader.match(/token=([^;]+)/)
  if (!match) throw new Error('No token cookie')
  const token = match[1]
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  return { userId: decoded.userId, branchId: decoded.branchId }
}

export async function POST(req: Request) {
  try {
    // 1️⃣ Verificar token y obtener userId/branchId
    let userId: number, branchId: number
    try {
      const payload = getUserFromCookie(req)
      userId = payload.userId
      branchId = payload.branchId
    } catch {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // 2️⃣ Leer body: items + paymentMethod
    const { items, paymentMethod } = (await req.json()) as {
      items: { productId: number; quantity: number; price: number }[]
      paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago'
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'No se enviaron items' }, { status: 400 })
    }

    // 3️⃣ Validar que cada productId exista en Product
    const productIds = items.map((i) => i.productId)
    const productosExistentes = (await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    })) as Array<{ id: number }> // <— indicamos explícitamente que es { id: number }[]

    const existentesSet = new Set(productosExistentes.map((p) => p.id))
    for (const pid of productIds) {
      if (!existentesSet.has(pid)) {
        return NextResponse.json(
          { error: `El producto con ID ${pid} no existe en la base.` },
          { status: 400 }
        )
      }
    }

    // 4️⃣ Crear la venta (Sale + SaleItem)
    const sale = await prisma.sale.create({
      data: {
        userId,
        branchId,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            price: item.price,
          })),
        },
      },
      include: { items: true },
    })

    // 5️⃣ Calcular el monto total de la venta
    const totalAmount = items.reduce((sum, item) => sum + item.price * item.quantity, 0)

    // 6️⃣ Registrar el movimiento de caja siempre (tipo = 'sale')
    const movement = await prisma.cashRegisterMovement.create({
      data: {
        amount: totalAmount,
        paymentMethod,
        description: `Venta #${sale.id}`,
        branchId,
        userId,
        type: 'sale',
      },
    })

    // 7️⃣ Si el pago fue en efectivo, sumarlo a Branch.currentCash
    if (paymentMethod === 'efectivo') {
      const branchRecord = await prisma.branch.findUnique({ where: { id: branchId } })
      if (!branchRecord) {
        return NextResponse.json(
          { error: 'No se encontró registro de sucursal para actualizar efectivo.' },
          { status: 500 }
        )
      }
      const beforeCash = branchRecord.currentCash
      const newCash = beforeCash + totalAmount

      await prisma.branch.update({
        where: { id: branchId },
        data: { currentCash: newCash },
      })

      // Auditoría: registrar cambio en Branch.currentCash
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
          origin: 'venta',
        },
      })
    }

    // 8️⃣ Auditoría: registro de la venta
    await prisma.auditLog.create({
      data: {
        userId,
        tableName: 'Sale',
        recordId: sale.id,
        actionType: 'create',
        changes: { before: null, after: sale },
        origin: 'venta',
      },
    })

    // 9️⃣ Decrementar stock y auditar cada item
    for (const item of items) {
      const beforeStock = await prisma.branchStock.findUnique({
        where: {
          branchId_productId: { branchId, productId: item.productId },
        },
      })
      const updatedStock = await prisma.branchStock.update({
        where: {
          branchId_productId: { branchId, productId: item.productId },
        },
        data: {
          quantity: { decrement: item.quantity },
        },
      })

      await prisma.auditLog.create({
        data: {
          userId,
          tableName: 'BranchStock',
          recordId: updatedStock.id,
          actionType: 'update',
          changes: { before: beforeStock, after: updatedStock },
          origin: 'venta',
        },
      })
    }

    return NextResponse.json({ sale, movement }, { status: 201 })
  } catch (error: any) {
    console.error('Error al procesar la venta:', error)
    return NextResponse.json({ error: error.message || 'Error interno' }, { status: 500 })
  }
}
