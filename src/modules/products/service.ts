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
import type { CrearProductoInput, EditarProductoInput, ListarProductosQuery } from './schemas'
import type { Monto } from '@/lib/money'
import { aMonto, dinero, iguales, type Dinero } from '@/server/money'
import {
  applyStockMovement,
  idsBajoMinimo,
  olvidarStockDeProductoSinHistorial,
} from '@/modules/inventory/service'
import { estadoDeStock, type EstadoStock } from '@/modules/inventory/minimum'

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
  minimumStock: number
  /** OK | LOW | OUT. Calculado al leer, nunca guardado. */
  estado: EstadoStock
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
  minimumStock: true,
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
  // Bajo minimo: hay unidades, pero llegaron al minimo configurado del
  // producto. Se resuelve antes, en SQL, porque compara dos columnas de tablas
  // distintas. Solo se paga cuando el filtro esta puesto.
  //
  // Con `minimumStock = 0` --sin minimo, que es lo que tiene todo el catalogo
  // migrado-- no lo cumple nadie, y es intencional: el sistema no inventa
  // cuantas unidades quiere tener este almacen de cada cosa.
  const bajoMinimo = query.lowStock ? await idsBajoMinimo(session.branchId) : null

  // Dos filtros distintos acotan por id --la lista explicita que manda la caja
  // para restaurar un ticket, y el bajo minimo--. Se INTERSECAN. Escribir dos
  // veces `id` en el mismo objeto haria que el segundo pisara al primero en
  // silencio, que es el mismo error que el comentario de `sinStock` describe.
  const porId: number[] | null =
    query.ids === undefined
      ? bajoMinimo
      : bajoMinimo === null
        ? query.ids
        : query.ids.filter((id) => bajoMinimo.includes(id))

  const where: Prisma.ProductWhereInput = {
    branchId: session.branchId,
    ...(query.categoryId === undefined ? {} : { categoryId: query.categoryId }),
    ...(porId === null ? {} : { id: { in: porId } }),
    ...(query.estado === 'todos' ? {} : { isActive: query.estado === 'activos' }),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { barcode: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
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

  const data = productos.map(({ stocks, ...producto }) => {
    const totalStock = stocks[0]?.quantity ?? 0
    return {
      ...conPrecioSerializado(producto),
      totalStock,
      estado: estadoDeStock(totalStock, producto.minimumStock),
    }
  })

  return paginado(data, total, query)
}

export async function obtenerProducto(session: Session, id: number) {
  const producto = await productoDeLaSucursal(session, id)
  const categoria = await prisma.category.findUnique({
    where: { id: producto.categoryId },
    select: { id: true, name: true },
  })
  const totalStock = await cantidadDe(id, session.branchId)
  return {
    ...conPrecioSerializado(producto),
    category: categoria,
    totalStock,
    estado: estadoDeStock(totalStock, producto.minimumStock),
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
        minimumStock: input.minimumStock,
        // La sucursal la fija el servidor, siempre.
        branchId: session.branchId,
      },
    })

    // El stock inicial entra por el libro, como todo lo demas: un producto que
    // nace con 20 unidades tiene un movimiento INITIAL de +20, y la suma de su
    // libro da 20 desde el primer dia.
    //
    // Con cero unidades no se emite nada. La invariante
    // suma(movimientos) == cantidad se cumple sola con la suma vacia, un
    // movimiento de cero no dice nada, y ademas asi un producto cargado por
    // error y sin ninguna operacion se puede seguir borrando.
    if (input.totalStock > 0) {
      await applyStockMovement(tx, {
        branchId: session.branchId,
        productId: producto.id,
        type: 'INITIAL',
        quantity: input.totalStock,
        userId: session.userId,
        reason: 'Stock inicial al dar de alta el producto',
        referenceType: 'Product',
        referenceId: producto.id,
      })
    }

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: producto.id,
      action: 'create',
      after: { ...conPrecioSerializado(producto), stockInicial: input.totalStock },
      origin: 'POST /api/products',
    })

    return producto
  })

  return {
    ...conPrecioSerializado(resultado),
    totalStock: input.totalStock,
    estado: estadoDeStock(input.totalStock, resultado.minimumStock),
  }
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
        ...(input.minimumStock !== undefined ? { minimumStock: input.minimumStock } : {}),
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

    const stockActual = await tx.branchStock.findUnique({
      where: { branchId_productId: { branchId: session.branchId, productId: id } },
      select: { quantity: true },
    })
    let cantidad = stockActual?.quantity ?? 0

    if (input.totalStock !== undefined) {
      // La ficha manda el TOTAL, y el total se convierte en el delta que de
      // verdad ocurrio antes de escribir nada. Nunca se guarda "el stock nuevo
      // es 50" sin registrar como se llego.
      const delta = input.totalStock - cantidad

      // Un delta de cero no se rechaza aca, a diferencia del recuento de
      // `PUT /api/stock/:id`. La diferencia es real: alla el recuento ES la
      // operacion y no hacer nada seria un error del usuario; aca es un campo
      // mas de un formulario de varios, y fallar la edicion entera porque el
      // stock quedo igual seria una molestia sin sentido.
      if (delta !== 0) {
        // El motivo lo declara quien ajusta. El esquema lo exige.
        const motivo = input.stockReason ?? 'Ajuste desde la ficha del producto'

        const resultado = await applyStockMovement(tx, {
          branchId: session.branchId,
          productId: id,
          type: 'MANUAL_ADJUSTMENT',
          quantity: delta,
          userId: session.userId,
          reason: motivo,
          referenceType: 'Product',
          referenceId: id,
          audit: { origin: 'PUT /api/products/:id' },
        })

        cantidad = resultado.resultingQuantity
      }
    }

    return {
      ...conPrecioSerializado(despues),
      totalStock: cantidad,
      estado: estadoDeStock(cantidad, despues.minimumStock),
    }
  })
}

/**
 * Baja de un producto.
 *
 * Se niega en dos casos, y los dos son el mismo: el producto tiene historial.
 *
 *   · Figura en alguna venta. Borrarlo dejaria items de venta apuntando a un
 *     producto inexistente y falsearia los reportes de meses anteriores.
 *   · Tiene movimientos de stock. Borrarlo obligaria a borrar su libro de
 *     inventario, y el libro es inmutable: hay un disparador en la base que lo
 *     impide.
 *
 * Desde la Fase 3A la segunda condicion es la que manda en la practica: un
 * producto que se cargo con unidades, o al que se le ajusto la cantidad alguna
 * vez, YA NO SE BORRA. Se da de baja con `isActive`, que lo saca del catalogo
 * de venta sin tocar nada de lo anterior.
 *
 * Lo que si se puede borrar: un producto cargado por error, con cero unidades
 * y sin ninguna operacion. Que es exactamente el caso para el que servia el
 * boton. Ver docs/INVENTORY_LEDGER.md, seccion 4.
 */
export async function eliminarProducto(session: Session, id: number) {
  const producto = await productoDeLaSucursal(session, id)

  const ventas = await prisma.saleItem.count({ where: { productId: id } })
  if (ventas > 0) {
    throw conflict(
      `No se puede eliminar: el producto figura en ${ventas} venta(s). ` +
        'Borrarlo destruiria el historial de ventas. Dalo de baja en su lugar.',
      { code: 'PRODUCT_HAS_SALES' },
    )
  }

  await prisma.$transaction(async (tx) => {
    await olvidarStockDeProductoSinHistorial(tx, id)
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
