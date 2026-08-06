// src/app/api/products/[id]/route.ts
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma' // ← if you export default, use: import prisma from '@/lib/prisma'
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

function getIdFromRequest(req: NextRequest): number | null {
  const { pathname } = new URL(req.url)
  const idStr = pathname.split('/').pop() ?? ''
  const id = Number(idStr)
  return Number.isFinite(id) ? id : null
}

// ========== GET /api/products/:id ==========
export async function GET(req: NextRequest) {
  try {
    const { branchId } = await getAuth()
    const id = getIdFromRequest(req)
    if (id === null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const product = await prisma.product.findFirst({
      where: { id, branchId },
      include: { category: true, stocks: { select: { quantity: true } } },
    })
    if (!product) {
      return NextResponse.json({ error: 'Producto no encontrado o no autorizado' }, { status: 404 })
    }

    const totalStock = product.stocks.reduce((sum: number, s: { quantity: number }) => sum + s.quantity, 0)
    // opcional: no devuelvas "stocks" crudos
    const { stocks, ...rest } = product as any
    return NextResponse.json({ ...rest, totalStock })
  } catch (e: any) {
    const msg = e?.message === 'no_token' ? 'No autenticado' : 'Error al obtener producto'
    const code = e?.message === 'no_token' ? 401 : 500
    console.error('GET /products/:id error:', e)
    return NextResponse.json({ error: msg }, { status: code })
  }
}

// ========== PUT /api/products/:id ==========
export async function PUT(req: NextRequest) {
  try {
    const { userId, branchId } = await getAuth()
    const productId = getIdFromRequest(req)
    if (productId === null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const body = await req.json()
    const {
      name,
      barcode,
      description,
      price,
      categoryId,
      totalStock,
    }: {
      name?: string
      barcode?: string | null
      description?: string | null
      price?: number
      categoryId?: number
      totalStock?: number
    } = body || {}

    // Verificar que el producto exista y sea de la sucursal
    const before = await prisma.product.findUnique({ where: { id: productId } })
    if (!before || before.branchId !== branchId) {
      return NextResponse.json({ error: 'Producto no encontrado o no autorizado' }, { status: 404 })
    }

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const updatedProduct = await tx.product.update({
        where: { id: productId },
        data: {
          ...(name !== undefined ? { name: String(name) } : {}),
          ...(barcode !== undefined ? { barcode: barcode || null } : {}),
          ...(description !== undefined ? { description: description || null } : {}),
          ...(price !== undefined ? { price: Number(price) } : {}),
          ...(categoryId !== undefined ? { categoryId: Number(categoryId) } : {}),
        },
      })

      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'Product',
          recordId: updatedProduct.id,
          actionType: 'update',
          changes: { before, after: updatedProduct },
          origin: 'api-products-id-route',
        },
      })

      let updatedStockRow: { id: number; quantity: number } | null = null
      if (typeof totalStock === 'number' && totalStock >= 0) {
        const beforeStock = await tx.branchStock.findUnique({
          where: { branchId_productId: { branchId, productId } },
          select: { id: true, quantity: true },
        })

        const updatedStock = await tx.branchStock.upsert({
          where: { branchId_productId: { branchId, productId } },
          update: { quantity: totalStock },
          create: { branchId, productId, quantity: totalStock },
          select: { id: true, quantity: true },
        })
        updatedStockRow = updatedStock

        await tx.auditLog.create({
          data: {
            userId,
            tableName: 'BranchStock',
            recordId: updatedStock.id,
            actionType: beforeStock ? 'update' : 'create',
            changes: { before: beforeStock, after: updatedStock },
            origin: 'api-products-id-route',
          },
        })
      }

      return { updatedProduct, updatedStockRow }
    })

    const total = typeof totalStock === 'number' && totalStock >= 0
      ? totalStock
      : (await prisma.branchStock.findUnique({
          where: { branchId_productId: { branchId, productId } },
          select: { quantity: true },
        }))?.quantity ?? 0

    return NextResponse.json({ ...result.updatedProduct, totalStock: total })
  } catch (e: any) {
    if (e?.code === 'P2002') {
      return NextResponse.json({ error: 'Barcode duplicado' }, { status: 409 })
    }
    const msg = e?.message === 'no_token' ? 'No autenticado' : 'Error al actualizar el producto'
    const code = e?.message === 'no_token' ? 401 : 500
    console.error('PUT /products/:id error:', e)
    return NextResponse.json({ error: msg }, { status: code })
  }
}

// ========== DELETE /api/products/:id ==========
export async function DELETE(req: NextRequest) {
  try {
    const { userId, branchId } = await getAuth()
    const id = getIdFromRequest(req)
    if (id === null) return NextResponse.json({ error: 'ID inválido' }, { status: 400 })

    const product = await prisma.product.findUnique({
      where: { id },
      include: { stocks: true },
    })
    if (!product || product.branchId !== branchId) {
      return NextResponse.json({ error: 'Producto no encontrado o no autorizado' }, { status: 404 })
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (product.stocks.length) {
        await tx.branchStock.deleteMany({
          where: { branchId, productId: id },
        })
        await tx.auditLog.create({
          data: {
            userId,
            tableName: 'BranchStock',
            recordId: 0,
            actionType: 'bulk_delete',
            changes: { before: product.stocks, after: null },
            origin: 'api-products-id-route',
          },
        })
      }

      await tx.product.delete({ where: { id } })
      await tx.auditLog.create({
        data: {
          userId,
          tableName: 'Product',
          recordId: id,
          actionType: 'delete',
          changes: { before: product, after: null },
          origin: 'api-products-id-route',
        },
      })
    })

    return NextResponse.json({ message: 'Producto eliminado correctamente' })
  } catch (e: any) {
    const msg = e?.message === 'no_token' ? 'No autenticado' : 'Error al eliminar el producto'
    const code = e?.message === 'no_token' ? 401 : 500
    console.error('DELETE /products/:id error:', e)
    return NextResponse.json({ error: msg }, { status: code })
  }
}
