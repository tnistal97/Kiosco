// src/app/api/products/[id]/route.ts
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import {
  amountSchema,
  idSchema,
  optionalText,
  parseWith,
  shortText,
} from '@/server/http/validate'
import { audit } from '@/server/audit/audit'
import { conflict, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Carga el producto comprobando que pertenezca a la sucursal de la sesion.
 *
 * Devuelve 404 tanto si no existe como si es de otra sucursal: no hay que
 * confirmarle a nadie que el producto existe en otro lado.
 */
async function productoDeLaSucursal(session: Session, id: number) {
  const producto = await prisma.product.findFirst({
    where: { id, branchId: session.branchId },
  })
  if (!producto) throw notFound('Producto no encontrado')
  return producto
}

export const GET = handler(
  {
    auth: 'session',
    permission: 'products.view',
    audit: 'GET /api/products/:id',
  },
  async ({ session, params }) => {
    const id = parseWith(idSchema, params.id)
    const producto = await productoDeLaSucursal(session, id)

    const stock = await prisma.branchStock.findUnique({
      where: { branchId_productId: { branchId: session.branchId, productId: id } },
      select: { quantity: true },
    })

    const categoria = await prisma.category.findUnique({
      where: { id: producto.categoryId },
      select: { id: true, name: true },
    })

    return { ...producto, category: categoria, totalStock: stock?.quantity ?? 0 }
  },
)

/**
 * Edicion del producto.
 *
 * `totalStock` sigue aceptandose porque la pantalla de productos lo usa, pero
 * ahora exige el permiso stock.adjust ademas de products.update, y queda
 * auditado como un ajuste de inventario aparte. En la fase siguiente el stock
 * deja de editarse desde aca y pasa a StockMovement.
 */
const editarProductoSchema = z
  .object({
    name: shortText(150).optional(),
    barcode: z
      .string()
      .trim()
      .max(64)
      .regex(/^[0-9A-Za-z-]*$/, 'Codigo de barras invalido')
      .transform((v) => (v === '' ? null : v))
      .nullable()
      .optional(),
    description: optionalText(500),
    price: amountSchema.optional(),
    categoryId: idSchema.optional(),
    totalStock: z.number().int().min(0).max(1_000_000).optional(),
  })
  .strict()

export const PUT = handler(
  {
    auth: 'session',
    permission: 'products.update',
    body: editarProductoSchema,
    audit: 'PUT /api/products/:id',
  },
  async ({ session, body, params }) => {
    const id = parseWith(idSchema, params.id)
    const antes = await productoDeLaSucursal(session, id)

    if (body.totalStock !== undefined && !session.permissions.has('stock.adjust')) {
      throw conflict('No tiene permiso para ajustar el stock desde la ficha del producto')
    }

    if (body.barcode) {
      const repetido = await prisma.product.findFirst({
        where: { barcode: body.barcode, id: { not: id } },
      })
      if (repetido) throw conflict('Ya existe un producto con ese codigo de barras')
    }

    if (body.categoryId !== undefined) {
      const categoria = await prisma.category.findUnique({ where: { id: body.categoryId } })
      if (!categoria) throw notFound('La categoria indicada no existe')
    }

    return prisma.$transaction(async (tx) => {
      const despues = await tx.product.update({
        where: { id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.barcode !== undefined ? { barcode: body.barcode } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.price !== undefined ? { price: body.price } : {}),
          ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        },
      })

      await audit(tx, {
        userId: session.userId,
        table: 'Product',
        recordId: id,
        action: 'update',
        before: antes,
        after: despues,
        origin: 'PUT /api/products/:id',
      })

      let cantidad: number
      if (body.totalStock !== undefined) {
        const stockAntes = await tx.branchStock.findUnique({
          where: { branchId_productId: { branchId: session.branchId, productId: id } },
          select: { quantity: true },
        })

        const stockDespues = await tx.branchStock.upsert({
          where: { branchId_productId: { branchId: session.branchId, productId: id } },
          update: { quantity: body.totalStock },
          create: { branchId: session.branchId, productId: id, quantity: body.totalStock },
          select: { id: true, quantity: true },
        })

        await audit(tx, {
          userId: session.userId,
          table: 'BranchStock',
          recordId: stockDespues.id,
          action: 'update',
          before: { quantity: stockAntes?.quantity ?? 0 },
          after: { quantity: stockDespues.quantity, motivo: 'Ajuste desde la ficha del producto' },
          origin: 'PUT /api/products/:id',
        })

        cantidad = stockDespues.quantity
      } else {
        const actual = await tx.branchStock.findUnique({
          where: { branchId_productId: { branchId: session.branchId, productId: id } },
          select: { quantity: true },
        })
        cantidad = actual?.quantity ?? 0
      }

      return { ...despues, totalStock: cantidad }
    })
  },
)

/**
 * Baja de un producto.
 *
 * Se niega si el producto figura en alguna venta: borrarlo dejaria items de
 * venta apuntando a un producto inexistente y falsearia los reportes
 * historicos. En la fase siguiente esto se resuelve con `Product.isActive`,
 * que permite sacarlo del catalogo sin tocar el historial.
 */
export const DELETE = handler(
  {
    auth: 'session',
    permission: 'products.delete',
    audit: 'DELETE /api/products/:id',
  },
  async ({ session, params }) => {
    const id = parseWith(idSchema, params.id)
    const producto = await productoDeLaSucursal(session, id)

    const ventas = await prisma.saleItem.count({ where: { productId: id } })
    if (ventas > 0) {
      throw conflict(
        `No se puede eliminar: el producto figura en ${ventas} venta(s). ` +
          'Borrarlo destruiria el historial de ventas.',
      )
    }

    await prisma.$transaction(async (tx) => {
      await tx.branchStock.deleteMany({ where: { productId: id } })
      await tx.product.delete({ where: { id } })

      await audit(tx, {
        userId: session.userId,
        table: 'Product',
        recordId: id,
        action: 'delete',
        before: producto,
        origin: 'DELETE /api/products/:id',
      })
    })

    return { ok: true, message: 'Producto eliminado' }
  },
)
