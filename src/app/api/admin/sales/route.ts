// src/app/api/admin/sales/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import jwt from 'jsonwebtoken'
import { cookies } from 'next/headers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PaymentMethod = 'efectivo' | 'tarjeta' | 'mercado_pago'

interface JwtPayload {
  userId: number
  role: string
  branchId: number
  iat?: number
  exp?: number
}

interface SaleItem {
  id: number
  product: { id: number; name: string }
  quantity: number
  price: number
}

interface Sale {
  id: number
  date: Date
  user: { id: number; name: string }
  items: SaleItem[]
}

interface SaleResult {
  id: number
  date: string
  user: { id: number; name: string }
  paymentMethod: PaymentMethod
  items: SaleItem[]
}

function normalizePaymentMethod(s: string | null | undefined): PaymentMethod {
  switch (s) {
    case 'tarjeta':
    case 'mercado_pago':
    case 'efectivo':
      return s
    default:
      return 'efectivo'
  }
}

async function getBranchIdFromCookie(): Promise<number> {
  const store = await cookies()
  const token = store.get('token')?.value
  if (!token) throw new Error('No token cookie')
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  return decoded.branchId
}

export async function GET(req: NextRequest) {
  try {
    // 1) Autenticación
    let branchId: number
    try {
      branchId = await getBranchIdFromCookie()
    } catch {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    // 2) Rango de fechas
    const { searchParams } = new URL(req.url)
    const startParam = searchParams.get('start')
    const endParam = searchParams.get('end')

    if (!startParam || !endParam) {
      return NextResponse.json(
        { error: 'Debe proporcionar start y end en formato YYYY-MM-DD' },
        { status: 400 }
      )
    }

    const startDate = new Date(`${startParam}T00:00:00.000Z`)
    const endDate = new Date(`${endParam}T23:59:59.999Z`)

    // 3) Movimientos de caja del rango (solo lo necesario para mapear)
    const movements = await prisma.cashRegisterMovement.findMany({
      where: {
        branchId,
        date: { gte: startDate, lte: endDate },
        type: 'sale',
      },
      select: { description: true, paymentMethod: true },
    })

    // 4) Mapear saleId -> paymentMethod (normalizado al union)
    const paymentMap: Record<number, PaymentMethod> = {}
    movements.forEach((m) => {
      const match = m.description?.match(/Venta\s*#(\d+)/i)
      if (match) {
        const saleId = parseInt(match[1], 10)
        paymentMap[saleId] = normalizePaymentMethod(m.paymentMethod)
      }
    })

    // 5) Ventas del rango (con items y usuario)
    const sales = await prisma.sale.findMany({
      where: {
        branchId,
        date: { gte: startDate, lte: endDate },
      },
      orderBy: { date: 'desc' },
      include: {
        user: { select: { id: true, name: true } },
        items: {
          include: { product: { select: { id: true, name: true } } },
        },
      },
    })

    // 6) Respuesta
    const result: SaleResult[] = sales.map((s: Sale) => ({
      id: s.id,
      date: s.date.toISOString(),
      user: { id: s.user.id, name: s.user.name },
      paymentMethod: paymentMap[s.id] ?? 'efectivo',
      items: s.items.map((it: SaleItem) => ({
        id: it.id,
        product: { id: it.product.id, name: it.product.name },
        quantity: it.quantity,
        price: it.price,
      })),
    }))

    return NextResponse.json({ sales: result })
  } catch (err: any) {
    console.error('Error en GET /api/admin/sales:', err)
    return NextResponse.json(
      { error: 'Error interno al cargar ventas' },
      { status: 500 }
    )
  }
}
