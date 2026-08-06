// src/app/api/products/route.ts
import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'
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

async function getUserFromCookie(): Promise<{ userId: number; branchId: number }> {
  const store = await cookies()
  const token = store.get('token')?.value
  if (!token) throw new Error('no_token')

  let decoded: JwtPayload
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  } catch (e: any) {
    if (e?.name === 'TokenExpiredError') throw new Error('token_expired')
    if (e?.name === 'JsonWebTokenError') throw new Error('token_invalid')
    throw new Error('token_verify_failed')
  }

  if (!decoded?.userId || !decoded?.branchId) throw new Error('token_missing_claims')
  return { userId: decoded.userId, branchId: decoded.branchId }
}

// GET: productos por sucursal
export async function GET() {
  try {
    let branchId: number
    try {
      ({ branchId } = await getUserFromCookie())
    } catch (e: any) {
      return NextResponse.json({ error: 'No autenticado', reason: e?.message }, { status: 401 })
    }

    const products = await prisma.product.findMany({
      where: { branchId },
      include: { category: true, stocks: { select: { quantity: true } } },
      orderBy: { name: 'asc' },
    })

    const withStock = products.map((p: {
      id: number
      name: string
      barcode: string | null
      description: string | null
      price: number
      category: any
      stocks: { quantity: number }[]
    }) => {
      const totalStock = p.stocks.reduce((sum: number, s: { quantity: number }) => sum + s.quantity, 0)
      return {
        id: p.id,
        name: p.name,
        barcode: p.barcode,
        description: p.description,
        price: p.price,
        category: p.category,
        totalStock,
      }
    })

    return NextResponse.json(withStock)
  } catch (error) {
    console.error('Error fetching products:', error)
    return NextResponse.json({ error: 'Error fetching products' }, { status: 500 })
  }
}

// POST: crear producto + stock + auditoría
export async function POST(req: Request) {
  try {
    let userId: number, branchId: number
    try {
      ({ userId, branchId } = await getUserFromCookie())
    } catch (e: any) {
      return NextResponse.json({ error: 'No autenticado', reason: e?.message }, { status: 401 })
    }

    const body = await req.json()
    const { name, barcode, description, price, categoryId, totalStock } = body || {}

    if (!name || price == null || !categoryId) {
      return NextResponse.json(
        { error: 'Faltan campos requeridos: name, price, categoryId' },
        { status: 400 }
      )
    }

    const initialQty = Number.isFinite(Number(totalStock)) ? Number(totalStock) : 0

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const product = await tx.product.create({
        data: {
          name: String(name),
          barcode: barcode ? String(barcode) : null,
          description: description ? String(description) : null,
          price: Number(price),
          categoryId: Number(categoryId),
          branchId,
        },
      })

      const branchStock = await tx.branchStock.create({
        data: { branchId, productId: product.id, quantity: initialQty },
      })

      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'Product',
          recordId: product.id,
          actionType: 'create',
          changes: { before: null, after: product },
          origin: 'api-products-route',
        },
      })

      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'BranchStock',
          recordId: branchStock.id,
          actionType: 'create',
          changes: { before: null, after: branchStock },
          origin: 'api-products-route',
        },
      })

      return { product, branchStock }
    })

    return NextResponse.json(
      { ...result.product, totalStock: result.branchStock.quantity },
      { status: 201 }
    )
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return NextResponse.json({ error: 'Barcode duplicado', meta: error.meta }, { status: 409 })
    }
    console.error('Error creating product:', error)
    return NextResponse.json({ error: 'Error creating product' }, { status: 500 })
  }
}

// DELETE: eliminar todos los productos de la sucursal (con auditoría)
export async function DELETE() {
  try {
    let userId: number, branchId: number
    try {
      ({ userId, branchId } = await getUserFromCookie())
    } catch (e: any) {
      return NextResponse.json({ error: 'No autenticado', reason: e?.message }, { status: 401 })
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const products = await tx.product.findMany({
        where: { branchId },
        select: { id: true },
      })
      const ids: number[] = products.map((p) => p.id)
      if (!ids.length) return

      await tx.branchStock.deleteMany({ where: { branchId, productId: { in: ids } } })
      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'BranchStock',
          recordId: 0,
          actionType: 'bulk_delete',
          changes: { before: { branchId, productIds: ids }, after: null },
          origin: 'api-products-route',
        },
      })

      await tx.product.deleteMany({ where: { id: { in: ids } } })
      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'Product',
          recordId: 0,
          actionType: 'bulk_delete',
          changes: { before: { ids }, after: null },
          origin: 'api-products-route',
        },
      })
    })

    return NextResponse.json({ message: 'Productos de la sucursal eliminados' })
  } catch (error) {
    console.error('Error deleting products:', error)
    return NextResponse.json({ error: 'Error deleting products' }, { status: 500 })
  }
}
