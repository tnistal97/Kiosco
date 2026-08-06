// src/app/api/products/route.ts
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { audit } from '@/server/audit/audit'
import { conflict, invalid } from '@/server/http/errors'
import { crearProductoSchema } from '@/modules/products/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Catalogo de la sucursal.
 *
 * El stock se lee acotado a la sucursal de la sesion. La version anterior
 * sumaba todas las filas de BranchStock del producto, sin filtrar.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'products.view',
    audit: 'GET /api/products',
  },
  async ({ session }) => {
    const products = await prisma.product.findMany({
      where: { branchId: session.branchId },
      select: {
        id: true,
        name: true,
        barcode: true,
        description: true,
        price: true,
        category: { select: { id: true, name: true } },
        stocks: {
          where: { branchId: session.branchId },
          select: { quantity: true },
        },
      },
      orderBy: { name: 'asc' },
    })

    return products.map(({ stocks, ...producto }) => ({
      ...producto,
      totalStock: stocks.reduce((suma, s) => suma + s.quantity, 0),
    }))
  },
)

export const POST = handler(
  {
    auth: 'session',
    permission: 'products.create',
    body: crearProductoSchema,
    audit: 'POST /api/products',
  },
  async ({ session, body }) => {
    const categoria = await prisma.category.findUnique({ where: { id: body.categoryId } })
    if (!categoria) throw invalid('La categoria indicada no existe')

    if (body.barcode) {
      const repetido = await prisma.product.findUnique({ where: { barcode: body.barcode } })
      if (repetido) throw conflict('Ya existe un producto con ese codigo de barras')
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const producto = await tx.product.create({
        data: {
          name: body.name,
          barcode: body.barcode ?? null,
          description: body.description ?? null,
          price: body.price,
          categoryId: body.categoryId,
          // La sucursal la fija el servidor, siempre.
          branchId: session.branchId,
        },
      })

      const stock = await tx.branchStock.create({
        data: {
          branchId: session.branchId,
          productId: producto.id,
          quantity: body.totalStock,
        },
      })

      await audit(tx, {
        userId: session.userId,
        table: 'Product',
        recordId: producto.id,
        action: 'create',
        after: { ...producto, stockInicial: stock.quantity },
        origin: 'POST /api/products',
      })

      return { producto, stock }
    })

    return NextResponse.json(
      { ...resultado.producto, totalStock: resultado.stock.quantity },
      { status: 201 },
    )
  },
)

/**
 * No existe DELETE en esta ruta.
 *
 * Habia un `DELETE /api/products` que borraba TODOS los productos de la
 * sucursal y todas sus filas de stock, sin comprobar rol y sin confirmacion.
 * Ninguna pantalla lo usaba. Para dar de baja un producto puntual esta
 * `DELETE /api/products/:id`, que exige el permiso products.delete y se niega
 * si el producto participa en alguna venta.
 */
