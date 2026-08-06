// src/app/api/cash/route.ts
import { NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'

interface JwtPayload {
  userId: number
  role: string
  branchId: number
  iat?: number
  exp?: number
}

// Helper para leer/verificar el JWT desde la cookie
function getUserFromCookie(req: Request): { userId: number; branchId: number } {
  const cookieHeader = req.headers.get('cookie') || ''
  const match = cookieHeader.match(/token=([^;]+)/)
  if (!match) throw new Error('No token cookie')
  const token = match[1]
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  return { userId: decoded.userId, branchId: decoded.branchId }
}

// GET /api/cash
export async function GET(req: Request) {
  // 1) Verificar JWT → extraer branchId
  let branchId: number
  try {
    ({ branchId } = getUserFromCookie(req))
  } catch {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // 2) Calcular rango “desde ayer 00:00” hasta “hoy 23:59:59”
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000)

  // 3) Consultar movimientos de esta sucursal entre “ayer 00:00” y “hoy 23:59:59”
  const movements = await prisma.cashRegisterMovement.findMany({
    where: {
      branchId,
      date: {
        gte: yesterdayStart,
        lte: todayEnd,
      },
    },
    include: {
      user: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true } },
    },
    orderBy: { date: 'desc' },
  })

  // 4) Enriquecer cada movimiento: si description empieza por “Venta #<saleId>”
    const enriched = await Promise.all(
    movements.map(async (m: {
      id: number
      amount: number
      paymentMethod: string
      description: string | null
      date: Date
      user: { id: number; name: string }
      branch: { id: number; name: string }
    }) => {
      const match = (m.description || '').match(/^Venta\s*#(\d+)/i)
      if (match) {
        const saleId = parseInt(match[1], 10)
        const items = await prisma.saleItem.findMany({
          where: { saleId },
          include: { product: { select: { id: true, name: true } } },
        })
        const saleItems = items.map((i: {
          id: number
          quantity: number
          price: number
          product: { id: number; name: string }
        }) => ({
          id: i.id,
          product: { id: i.product.id, name: i.product.name },
          quantity: i.quantity,
          price: i.price,
        }))
        return { ...m, saleItems }
      } else {
        return { ...m, saleItems: null }
      }
    })
  )


  return NextResponse.json(enriched)
}

// POST /api/cash
export async function POST(req: Request) {
  // 1) Verificar JWT y extraer userId + branchId
  let userId: number, branchId: number
  try {
    const payload = getUserFromCookie(req)
    userId = payload.userId
    branchId = payload.branchId
  } catch {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // 2) Leer body
  const data = await req.json()
  const { amount, paymentMethod, description, movementType } = data as {
    amount: number
    paymentMethod: string
    description?: string
    movementType: 'manual' | 'retiro' | 'deposit'
  }

  if (amount == null || !paymentMethod || !movementType) {
    return NextResponse.json(
      { error: 'Faltan campos obligatorios (amount, paymentMethod, movementType)' },
      { status: 400 }
    )
  }

  // 3) Crear movimiento de caja (incluyendo `type: movementType`)
  const movement = await prisma.cashRegisterMovement.create({
    data: {
      amount,
      paymentMethod,
      description: description ?? '',
      branchId,
      userId,
      type: movementType,
    },
  })

  return NextResponse.json(movement, { status: 201 })
}
