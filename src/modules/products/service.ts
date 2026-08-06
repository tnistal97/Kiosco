/**
 * Reglas de negocio del catalogo.
 *
 * Dos invariantes que atraviesan el modulo:
 *
 *   1. `branchId` sale siempre de la sesion. Nunca del cuerpo ni de la query.
 *   2. Un producto que figura en alguna venta no se borra fisicamente.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, invalid, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { CrearProductoInput, EditarProductoInput, ListarProductosQuery } from './schemas'

/** Umbral por debajo del cual un producto se considera con stock critico. */
export const STOCK_CRITICO = 10

export interface ProductoListado {
  id: number
  name: string
  barcode: string | null
  description: string | null
  price: number
  category: { id: number; name: string }
  totalStock: number
}

const CAMPOS_PRODUCTO = {
  id: true,
  name: true,
  barcode: true,
  description: true,
  price: true,
  category: { select: { id: true, name: true } },
} as const

/**
 * Carga un producto comprobando que pertenezca a la sucursal de la sesion.
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

async function cantidadDe(productId: number, branchId: number): Promise<number> {
  const stock = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId, productId } },
    select: { quantity: true },
  })
  return stock?.quantity ?? 0
}

/**
 * Catalogo de la sucursal, paginado y filtrable.
 *
 * El stock se lee acotado a la sucursal de la sesion con un `select` anidado,
 * en una sola consulta. La version anterior sumaba todas las filas de
 * BranchStock del producto, sin filtrar por sucursal.
 */
export async function listarProductos(
  session: Session,
  query: ListarProductosQuery,
): Promise<Paginated<ProductoListado>> {
  const where: Prisma.ProductWhereInput = {
    branchId: session.branchId,
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { barcode: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
    ...(query.lowStock
      ? { stocks: { some: { branchId: session.branchId, quantity: { lt: STOCK_CRITICO } } } }
      : {}),
  }

  const [total, productos] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      select: {
        ...CAMPOS_PRODUCTO,
        stocks: { where: { branchId: session.branchId }, select: { quantity: true } },
      },
      orderBy: { [query.sortBy]: query.sortDir },
      ...toSkipTake(query),
    }),
  ])

  const data = productos.map(({ stocks, ...producto }) => ({
    ...producto,
    totalStock: stocks[0]?.quantity ?? 0,
  }))

  return paginado(data, total, query)
}

export async function obtenerProducto(session: Session, id: number) {
  const producto = await productoDeLaSucursal(session, id)
  const categoria = await prisma.category.findUnique({
    where: { id: producto.categoryId },
    select: { id: true, name: true },
  })
  return { ...producto, category: categoria, totalStock: await cantidadDe(id, session.branchId) }
}

export async function crearProducto(session: Session, input: CrearProductoInput) {
  const categoria = await prisma.category.findUnique({ where: { id: input.categoryId } })
  if (!categoria) throw invalid('La categoria indicada no existe')

  if (input.barcode) {
    const repetido = await prisma.product.findUnique({ where: { barcode: input.barcode } })
    if (repetido) {
      throw conflict('Ya existe un producto con ese codigo de barras', {
        code: 'DUPLICATE_BARCODE',
      })
    }
  }

  const resultado = await prisma.$transaction(async (tx) => {
    const producto = await tx.product.create({
      data: {
        name: input.name,
        barcode: input.barcode ?? null,
        description: input.description ?? null,
        price: input.price,
        categoryId: input.categoryId,
        // La sucursal la fija el servidor, siempre.
        branchId: session.branchId,
      },
    })

    const stock = await tx.branchStock.create({
      data: {
        branchId: session.branchId,
        productId: producto.id,
        quantity: input.totalStock,
      },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: producto.id,
      action: 'create',
      after: { ...producto, stockInicial: stock.quantity },
      origin: 'POST /api/products',
    })

    return { producto, stock }
  })

  return { ...resultado.producto, totalStock: resultado.stock.quantity }
}

/**
 * Edicion del producto.
 *
 * `totalStock` sigue aceptandose porque la pantalla de productos lo usa, pero
 * exige el permiso stock.adjust ademas de products.update, y queda auditado
 * como un ajuste de inventario aparte.
 */
export async function editarProducto(session: Session, id: number, input: EditarProductoInput) {
  const antes = await productoDeLaSucursal(session, id)

  if (input.totalStock !== undefined && !session.permissions.has('stock.adjust')) {
    throw conflict('No tiene permiso para ajustar el stock desde la ficha del producto')
  }

  if (input.barcode) {
    const repetido = await prisma.product.findFirst({
      where: { barcode: input.barcode, id: { not: id } },
    })
    if (repetido) {
      throw conflict('Ya existe un producto con ese codigo de barras', {
        code: 'DUPLICATE_BARCODE',
      })
    }
  }

  if (input.categoryId !== undefined) {
    const categoria = await prisma.category.findUnique({ where: { id: input.categoryId } })
    if (!categoria) throw notFound('La categoria indicada no existe')
  }

  return prisma.$transaction(async (tx) => {
    const despues = await tx.product.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: id,
      action: 'update',
      before: antes,
      after: despues,
      origin: 'PUT /api/products/:id',
    })

    let cantidad: number
    if (input.totalStock !== undefined) {
      const stockAntes = await tx.branchStock.findUnique({
        where: { branchId_productId: { branchId: session.branchId, productId: id } },
        select: { quantity: true },
      })

      const stockDespues = await tx.branchStock.upsert({
        where: { branchId_productId: { branchId: session.branchId, productId: id } },
        update: { quantity: input.totalStock },
        create: { branchId: session.branchId, productId: id, quantity: input.totalStock },
        select: { id: true, quantity: true },
      })

      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'BranchStock',
        recordId: stockDespues.id,
        action: 'update',
        reason: 'Ajuste desde la ficha del producto',
        before: { quantity: stockAntes?.quantity ?? 0 },
        after: {
          quantity: stockDespues.quantity,
          diferencia: stockDespues.quantity - (stockAntes?.quantity ?? 0),
          motivo: 'Ajuste desde la ficha del producto',
          branchId: session.branchId,
          productId: id,
        },
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
}

/**
 * Baja de un producto.
 *
 * Se niega si el producto figura en alguna venta: borrarlo dejaria items de
 * venta apuntando a un producto inexistente y falsearia los reportes
 * historicos. En la fase siguiente esto se resuelve con `Product.isActive`,
 * que permite sacarlo del catalogo sin tocar el historial.
 */
export async function eliminarProducto(session: Session, id: number) {
  const producto = await productoDeLaSucursal(session, id)

  const ventas = await prisma.saleItem.count({ where: { productId: id } })
  if (ventas > 0) {
    throw conflict(
      `No se puede eliminar: el producto figura en ${ventas} venta(s). ` +
        'Borrarlo destruiria el historial de ventas.',
      { code: 'PRODUCT_HAS_SALES' },
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.branchStock.deleteMany({ where: { productId: id } })
    await tx.product.delete({ where: { id } })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: id,
      action: 'delete',
      before: producto,
      origin: 'DELETE /api/products/:id',
    })
  })

  return { ok: true, message: 'Producto eliminado' }
}
