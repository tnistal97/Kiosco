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
import { conflict, forbidden, invalid, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import {
  STOCK_CRITICO,
  type CrearProductoInput,
  type EditarProductoInput,
  type ListarProductosQuery,
} from './schemas'
import type { Monto } from '@/lib/money'
import { aMonto, dinero, iguales, type Dinero } from '@/server/money'

export interface ProductoListado {
  id: number
  name: string
  barcode: string | null
  description: string | null
  price: Monto
  isActive: boolean
  category: { id: number; name: string }
  supplier: { id: number; name: string } | null
  totalStock: number
}

/**
 * Deja el precio como cadena antes de que el producto salga del modulo.
 *
 * Prisma devuelve `Decimal`, que serializado a JSON da `"4850"` --sin la
 * escala--. La API tiene que entregar siempre `"4850.00"`: el cliente no
 * deberia tener que adivinar cuantos decimales habia.
 */
function conPrecioSerializado<T extends { price: Dinero }>(
  producto: T,
): Omit<T, 'price'> & { price: Monto } {
  return { ...producto, price: aMonto(producto.price) }
}

const CAMPOS_PRODUCTO = {
  id: true,
  name: true,
  barcode: true,
  description: true,
  price: true,
  isActive: true,
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
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
    ...(query.ids === undefined ? {} : { id: { in: query.ids } }),
    ...(query.estado === 'todos' ? {} : { isActive: query.estado === 'activos' }),
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
    // Va en `AND` y no en `OR` para no pisar el `OR` de la busqueda por
    // texto: dos claves `OR` en el mismo objeto y la segunda gana en
    // silencio, con lo que buscar y filtrar por agotados a la vez daria
    // resultados que no cumplen las dos condiciones.
    ...(query.sinStock
      ? {
          AND: [
            {
              OR: [
                { stocks: { none: { branchId: session.branchId } } },
                { stocks: { some: { branchId: session.branchId, quantity: { lte: 0 } } } },
              ],
            },
          ],
        }
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
    ...conPrecioSerializado(producto),
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
  return {
    ...conPrecioSerializado(producto),
    category: categoria,
    totalStock: await cantidadDe(id, session.branchId),
  }
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
        supplierId: input.supplierId ?? null,
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
      after: { ...conPrecioSerializado(producto), stockInicial: stock.quantity },
      origin: 'POST /api/products',
    })

    return { producto, stock }
  })

  return { ...conPrecioSerializado(resultado.producto), totalStock: resultado.stock.quantity }
}

/**
 * Edicion del producto.
 *
 * Tres permisos distintos conviven en el mismo endpoint, y cada campo exige
 * el suyo:
 *
 *   products.update        nombre, codigo, descripcion, categoria, proveedor
 *   products.price.update  precio
 *   stock.adjust           cantidad, y ademas con motivo
 *
 * El precio se comprueba aca, en el servidor, y no solo escondiendo el campo
 * en la pantalla: esconder un input no impide mandar el PUT a mano.
 *
 * Un cambio de precio que no cambia nada --mandar el mismo numero-- no se
 * rechaza: no es un intento de saltear el permiso, y fallar ahi obligaria a
 * la pantalla a saber que campos vienen "sucios".
 */
export async function editarProducto(session: Session, id: number, input: EditarProductoInput) {
  const antes = await productoDeLaSucursal(session, id)

  // `iguales` y no `!==`: son dos `Decimal`, y comparar objetos por identidad
  // daria "cambio" siempre. Mandar el mismo precio no es un intento de
  // saltear el permiso.
  if (
    input.price !== undefined &&
    !iguales(dinero(input.price), antes.price) &&
    !session.permissions.has('products.price.update')
  ) {
    throw forbidden('No tiene permiso para cambiar el precio de un producto')
  }

  if (input.totalStock !== undefined && !session.permissions.has('stock.adjust')) {
    throw forbidden('No tiene permiso para ajustar el stock')
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
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: id,
      action: 'update',
      before: conPrecioSerializado(antes),
      after: conPrecioSerializado(despues),
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

      // El motivo lo declara quien ajusta. El esquema lo exige; aca queda
      // guardado tal cual en la bitacora.
      const motivo = input.stockReason ?? 'Ajuste desde la ficha del producto'

      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'BranchStock',
        recordId: stockDespues.id,
        action: 'update',
        reason: motivo,
        before: { quantity: stockAntes?.quantity ?? 0 },
        after: {
          quantity: stockDespues.quantity,
          diferencia: stockDespues.quantity - (stockAntes?.quantity ?? 0),
          motivo,
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

    return { ...conPrecioSerializado(despues), totalStock: cantidad }
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
