// src/app/api/stock/[productId]/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'
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

async function getAuth(): Promise<{ userId: number; branchId: number }> {
  const store = await cookies()
  const token = store.get('token')?.value
  if (!token) throw new Error('no_token')
  const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  if (!decoded?.userId || !decoded?.branchId) throw new Error('token_missing_claims')
  return { userId: decoded.userId, branchId: decoded.branchId }
}

function getProductId(req: NextRequest): number | null {
  const { pathname } = new URL(req.url)
  const idStr = pathname.split('/').pop() ?? ''
  const id = Number(idStr)
  return Number.isFinite(id) ? id : null
}

// GET one product stock
export async function GET(req: NextRequest) {
  try {
    const { branchId } = await getAuth()
    const productId = getProductId(req)
    if (productId === null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    // ensure product belongs to branch
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true, name: true, barcode: true, price: true, branchId: true,
        category: { select: { id: true, name: true } },
      },
    })
    if (!product || product.branchId !== branchId) {
      return NextResponse.json({ error: 'Producto no encontrado o no autorizado' }, { status: 404 })
    }

    const stock = await prisma.branchStock.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { id: true, quantity: true },
    })

    return NextResponse.json({
      productId: product.id,
      name: product.name,
      barcode: product.barcode,
      price: product.price,
      category: product.category,
      quantity: stock?.quantity ?? 0,
    })
  } catch (e: any) {
    const msg = e?.message === 'no_token' ? 'No autenticado' : 'Error al obtener stock'
    const code = e?.message === 'no_token' ? 401 : 500
    console.error('GET /api/stock/:productId error:', e)
    return NextResponse.json({ error: msg }, { status: code })
  }
}

// PUT set absolute quantity
export async function PUT(req: NextRequest) {
  try {
    const { userId, branchId } = await getAuth()
    const productId = getProductId(req)
    if (productId === null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await req.json()
    const quantity = Number(body?.quantity)
    if (!Number.isFinite(quantity) || quantity < 0) {
      return NextResponse.json({ error: 'quantity debe ser >= 0' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const prod = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, branchId: true },
      })
      if (!prod || prod.branchId !== branchId) throw new Error('PRODUCT_FORBIDDEN')

      const before = await tx.branchStock.findUnique({
        where: { branchId_productId: { branchId, productId } },
      })
      const updated = await tx.branchStock.upsert({
        where: { branchId_productId: { branchId, productId } },
        update: { quantity },
        create: { branchId, productId, quantity },
      })

      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'BranchStock',
          recordId: updated.id,
          actionType: before ? 'update' : 'create',
          changes: { before, after: updated },
          origin: 'api-stock-id-route',
        },
      })

      return updated
    })

    return NextResponse.json({ productId, quantity: result.quantity })
  } catch (e: any) {
    if (e?.message === 'PRODUCT_FORBIDDEN') {
      return NextResponse.json({ error: 'Producto no autorizado para esta sucursal' }, { status: 403 })
    }
    const msg = e?.message === 'no_token' ? 'No autenticado' : 'Error al actualizar stock'
    const code = e?.message === 'no_token' ? 401 : 500
    console.error('PUT /api/stock/:productId error:', e)
    return NextResponse.json({ error: msg }, { status: code })
  }
}

// PATCH adjust by delta
export async function PATCH(req: NextRequest) {
  try {
    const { userId, branchId } = await getAuth()
    const productId = getProductId(req)
    if (productId === null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await req.json()
    const delta = Number(body?.delta)
    if (!Number.isFinite(delta)) {
      return NextResponse.json({ error: 'delta debe ser numérico' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const prod = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, branchId: true },
      })
      if (!prod || prod.branchId !== branchId) throw new Error('PRODUCT_FORBIDDEN')

      const before = await tx.branchStock.findUnique({
        where: { branchId_productId: { branchId, productId } },
      })
      const current = before?.quantity ?? 0
      const next = current + delta
      if (next < 0) throw new Error('NEGATIVE_RESULT')

      const updated = await tx.branchStock.upsert({
        where: { branchId_productId: { branchId, productId } },
        update: { quantity: next },
        create: { branchId, productId, quantity: next },
      })

      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'BranchStock',
          recordId: updated.id,
          actionType: before ? 'update' : 'create',
          changes: { before, after: updated },
          origin: 'api-stock-id-route',
        },
      })

      return updated
    })

    return NextResponse.json({ productId, quantity: result.quantity })
  } catch (e: any) {
    if (e?.message === 'PRODUCT_FORBIDDEN') {
      return NextResponse.json({ error: 'Producto no autorizado para esta sucursal' }, { status: 403 })
    }
    if (e?.message === 'NEGATIVE_RESULT') {
      return NextResponse.json({ error: 'El ajuste dejaría el stock en negativo' }, { status: 400 })
    }
    const msg = e?.message === 'no_token' ? 'No autenticado' : 'Error al ajustar stock'
    const code = e?.message === 'no_token' ? 401 : 500
    console.error('PATCH /api/stock/:productId error:', e)
    return NextResponse.json({ error: msg }, { status: code })
  }
}
