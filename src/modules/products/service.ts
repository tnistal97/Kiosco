/**
 * Reglas de negocio del catalogo.
 *
 * Cuatro invariantes que atraviesan el modulo:
 *
 *   1. `branchId` sale siempre de la sesion. Nunca del cuerpo ni de la query.
 *   2. Un producto que figura en alguna venta no se borra fisicamente.
 *   3. El costo NO SALE del modulo para quien no tiene `products.cost.view`.
 *      No se esconde en la pantalla: no se pone en la respuesta.
 *   4. La unidad de venta no se cambia una vez que el producto tiene
 *      historial. Cambiarla reescribiria el significado de todo su pasado.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, forbidden, invalid, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type {
  CambiarCostoInput,
  CrearProductoInput,
  EditarProductoInput,
  ListarProductosQuery,
} from './schemas'
import type { Monto } from '@/lib/money'
import type { TextoCantidad } from '@/lib/cantidad'
import { aMonto, aMontoCosto, dinero, iguales, type Dinero } from '@/server/money'
import {
  aTextoCantidad,
  cantidad as aCantidad,
  esCeroCantidad,
  restarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import {
  applyStockMovement,
  idsBajoMinimo,
  olvidarStockDeProductoSinHistorial,
  type TxClient,
} from '@/modules/inventory/service'
import { estadoDeStock, type EstadoStock } from '@/modules/inventory/minimum'
import { etiquetaDeTipo } from '@/modules/inventory/movement-types'
import { calcularRentabilidad, type Rentabilidad } from './margen'
import {
  motivoDeCantidadInvalida,
  unidadDeCompraODefecto,
  unidadDeVentaODefecto,
  type UnidadDeCompra,
  type UnidadDeVenta,
} from './units'

const CERO: TextoCantidad = '0.000'

export interface ProductoListado {
  id: number
  name: string
  /** El codigo PRINCIPAL. Los alternativos solo viajan en el detalle. */
  barcode: string | null
  description: string | null
  price: Monto
  isActive: boolean
  category: { id: number; name: string }
  supplier: { id: number; name: string } | null
  saleUnit: UnidadDeVenta
  purchaseUnit: UnidadDeCompra
  unitsPerPurchaseUnit: TextoCantidad
  totalStock: TextoCantidad
  minimumStock: TextoCantidad
  /** OK | LOW | OUT. Calculado al leer, nunca guardado. */
  estado: EstadoStock
  /**
   * Solo para quien tiene `products.cost.view`. Cuando no lo tiene, la clave
   * NO ESTA en el objeto: no viaja un null que despues alguien pueda
   * confundir con "no hay costo cargado".
   */
  cost?: Monto | null
  rentabilidad?: Rentabilidad
}

/** Si esta sesion puede ver cuanto cuesta comprar la mercaderia. */
export function puedeVerCosto(session: Session): boolean {
  return session.permissions.has('products.cost.view')
}

/**
 * La fila cruda del producto, lista para la bitacora.
 *
 * Los `Decimal` salen como cadena --un JSON con `4850` adentro perderia la
 * escala, y con `4850.000000001` seria prueba documental de algo que nunca
 * paso-- y el costo solo si quien mira puede verlo: la bitacora tambien es una
 * respuesta de la API.
 */
function paraBitacora(
  fila: { price: Dinero; cost: Dinero | null; minimumStock: Cantidad },
  session: Session,
): Record<string, unknown> {
  const { price, cost, minimumStock, ...resto } = fila
  return {
    ...resto,
    price: aMonto(price),
    minimumStock: aTextoCantidad(minimumStock),
    ...(puedeVerCosto(session) ? { cost: cost === null ? null : aMontoCosto(cost) } : {}),
  }
}

/**
 * Campos que se leen SIEMPRE.
 *
 * `cost` esta aca porque la consulta lo necesita para decidir si lo devuelve;
 * lo que no sale nunca del modulo es el valor, no la columna. La alternativa
 * --dos `select` distintos segun el permiso-- duplicaria la consulta entera
 * para ahorrar una columna que ya esta en la fila.
 */
const CAMPOS_PRODUCTO = {
  id: true,
  name: true,
  description: true,
  price: true,
  cost: true,
  isActive: true,
  saleUnit: true,
  purchaseUnit: true,
  unitsPerPurchaseUnit: true,
  minimumStock: true,
  category: { select: { id: true, name: true } },
  supplier: { select: { id: true, name: true } },
} as const

/** Fila cruda tal como sale de Prisma con `CAMPOS_PRODUCTO`. */
type FilaProducto = {
  id: number
  name: string
  description: string | null
  price: Dinero
  cost: Dinero | null
  isActive: boolean
  saleUnit: string
  purchaseUnit: string
  unitsPerPurchaseUnit: Cantidad
  minimumStock: Cantidad
  category: { id: number; name: string }
  supplier: { id: number; name: string } | null
}

/**
 * Arma la respuesta de un producto.
 *
 * Es el UNICO lugar donde se decide si el costo sale o no. Concentrarlo aca es
 * lo que permite que la regla se cumpla en el listado, en el detalle y en la
 * busqueda de la caja sin repetirla tres veces --y sin que la cuarta se
 * olvide--.
 */
function aProductoListado(
  fila: FilaProducto,
  totalStock: Cantidad | null,
  session: Session,
): ProductoListado & { barcode: string | null } {
  const stock = totalStock === null ? CERO : aTextoCantidad(totalStock)
  const minimo = aTextoCantidad(fila.minimumStock)
  const price = aMonto(fila.price)

  const base = {
    id: fila.id,
    name: fila.name,
    barcode: null as string | null,
    description: fila.description,
    price,
    isActive: fila.isActive,
    category: fila.category,
    supplier: fila.supplier,
    saleUnit: unidadDeVentaODefecto(fila.saleUnit),
    purchaseUnit: unidadDeCompraODefecto(fila.purchaseUnit),
    unitsPerPurchaseUnit: aTextoCantidad(fila.unitsPerPurchaseUnit),
    totalStock: stock,
    minimumStock: minimo,
    estado: estadoDeStock(stock, minimo),
  }

  if (!puedeVerCosto(session)) return base

  const cost = fila.cost === null ? null : aMontoCosto(fila.cost)
  return { ...base, cost, rentabilidad: calcularRentabilidad(price, cost) }
}

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

// ---------------------------------------------------------------------------
// Codigos de barras
// ---------------------------------------------------------------------------

/**
 * Comprueba que ninguno de estos codigos sea de otro producto.
 *
 * El indice unico de la base es la garantia; esto es el mensaje legible, y
 * ademas dice DE QUE PRODUCTO es el codigo repetido, que es lo unico que le
 * sirve a quien lo esta cargando.
 */
async function exigirCodigosLibres(
  tx: TxClient,
  codigos: string[],
  exceptoProductId: number | null,
): Promise<void> {
  if (codigos.length === 0) return

  const ocupados = await tx.productBarcode.findMany({
    where: {
      code: { in: codigos },
      ...(exceptoProductId === null ? {} : { productId: { not: exceptoProductId } }),
    },
    select: { code: true, product: { select: { name: true } } },
    take: 5,
  })

  if (ocupados.length > 0) {
    const detalle = ocupados.map((o) => `${o.code} (${o.product.name})`).join(', ')
    throw conflict(`Ya hay productos con esos codigos de barras: ${detalle}`, {
      code: 'DUPLICATE_BARCODE',
    })
  }
}

/**
 * Deja los codigos del producto exactamente como dice la entrada.
 *
 * Si `alternativos` no viene, los alternativos NO se tocan: un PUT que solo
 * cambia el nombre no tiene por que borrar codigos. Si viene, reemplaza la
 * lista entera, que es como se comporta un campo de formulario.
 *
 * Cuando no hay principal pero si alternativos, el PRIMERO se promueve. La
 * alternativa seria un producto con codigos que en el listado no muestra
 * ninguno, y eso confunde mas de lo que ayuda.
 */
async function sincronizarCodigos(
  tx: TxClient,
  productId: number,
  principal: string | null | undefined,
  alternativos: string[] | undefined,
): Promise<void> {
  const actuales = await tx.productBarcode.findMany({
    where: { productId },
    select: { id: true, code: true, isPrimary: true },
  })

  const principalActual = actuales.find((c) => c.isPrimary)?.code ?? null
  const nuevoPrincipal = principal === undefined ? principalActual : principal

  const nuevosAlternativos =
    alternativos === undefined
      ? actuales.filter((c) => !c.isPrimary).map((c) => c.code)
      : alternativos

  // Promocion del primero cuando no quedo principal.
  const [promovido, ...resto] =
    nuevoPrincipal === null ? nuevosAlternativos : [nuevoPrincipal, ...nuevosAlternativos]

  const deseados = new Map<string, boolean>()
  if (promovido !== undefined) deseados.set(promovido, true)
  for (const c of resto) if (!deseados.has(c)) deseados.set(c, false)

  await exigirCodigosLibres(tx, [...deseados.keys()], productId)

  // Se borra y se vuelve a crear en vez de actualizar en el sitio: el indice
  // unico parcial de "un solo principal" haria fallar cualquier orden de
  // actualizaciones en el que dos filas sean principales a la vez, aunque sea
  // por un instante dentro de la transaccion.
  await tx.productBarcode.deleteMany({ where: { productId } })

  if (deseados.size > 0) {
    await tx.productBarcode.createMany({
      data: [...deseados.entries()].map(([code, isPrimary]) => ({ productId, code, isPrimary })),
    })
  }
}

/** Los codigos de varios productos, en una consulta. */
async function codigosPrincipalesDe(ids: number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map()
  const filas = await prisma.productBarcode.findMany({
    where: { productId: { in: ids }, isPrimary: true },
    select: { productId: true, code: true },
  })
  return new Map(filas.map((f) => [f.productId, f.code]))
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/**
 * Catalogo de la sucursal, paginado y filtrable.
 *
 * El stock se lee acotado a la sucursal de la sesion con un `select` anidado,
 * en una sola consulta. Los codigos principales, en una segunda: traerlos con
 * un `include` por producto daria una consulta por fila.
 *
 * SOLO el codigo principal. Los alternativos no viajan en el listado a
 * proposito: la caja pide hasta cien productos por peticion y no los necesita
 * --para el lector hay un endpoint de busqueda exacta--.
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
            // Cualquiera de sus codigos, no solo el principal.
            { barcodes: { some: { code: { contains: query.q, mode: 'insensitive' as const } } } },
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

  const codigos = await codigosPrincipalesDe(productos.map((p) => p.id))

  const data = productos.map(({ stocks, ...producto }) => ({
    ...aProductoListado(producto, stocks[0]?.quantity ?? null, session),
    barcode: codigos.get(producto.id) ?? null,
  }))

  return paginado(data, total, query)
}

export interface ProductoDetallado extends ProductoListado {
  /** Todos los codigos menos el principal. */
  alternateBarcodes: string[]
}

export async function obtenerProducto(
  session: Session,
  id: number,
): Promise<ProductoDetallado & { category: { id: number; name: string } }> {
  const producto = await prisma.product.findFirst({
    where: { id, branchId: session.branchId },
    select: {
      ...CAMPOS_PRODUCTO,
      barcodes: { select: { code: true, isPrimary: true }, orderBy: { id: 'asc' } },
      stocks: { where: { branchId: session.branchId }, select: { quantity: true } },
    },
  })
  if (!producto) throw notFound('Producto no encontrado')

  const { barcodes, stocks, ...fila } = producto

  return {
    ...aProductoListado(fila, stocks[0]?.quantity ?? null, session),
    barcode: barcodes.find((b) => b.isPrimary)?.code ?? null,
    alternateBarcodes: barcodes.filter((b) => !b.isPrimary).map((b) => b.code),
  }
}

/**
 * Busqueda EXACTA por codigo de barras. La que usa el lector.
 *
 * Existe aparte de la busqueda por texto por rendimiento: esto es un acierto
 * directo sobre el indice unico de `ProductBarcode.code`, una fila leida,
 * mientras que `q=` hace un recorrido con `ILIKE '%...%'` sobre todos los
 * codigos y despues descarta en el navegador. Con diez mil productos y varios
 * codigos cada uno la diferencia deja de ser teorica.
 *
 * Encuentra por el codigo principal Y por cualquier alternativo, con
 * comportamiento identico: para quien pasa el lector no hay ninguna diferencia
 * entre los dos, y no deberia haberla.
 */
export async function buscarPorCodigoExacto(
  session: Session,
  codigo: string,
  opciones: { soloActivos?: boolean } = {},
): Promise<(ProductoListado & { barcode: string | null }) | null> {
  const code = codigo.trim()
  if (code === '') return null

  const fila = await prisma.productBarcode.findUnique({
    where: { code },
    select: {
      code: true,
      product: {
        select: {
          ...CAMPOS_PRODUCTO,
          branchId: true,
          stocks: { where: { branchId: session.branchId }, select: { quantity: true } },
          barcodes: { where: { isPrimary: true }, select: { code: true }, take: 1 },
        },
      },
    },
  })

  if (!fila) return null

  const { branchId, stocks, barcodes, ...producto } = fila.product

  // Un codigo de otra sucursal se comporta como un codigo que no existe.
  if (branchId !== session.branchId) return null
  if (opciones.soloActivos !== false && !producto.isActive) return null

  return {
    ...aProductoListado(producto, stocks[0]?.quantity ?? null, session),
    barcode: barcodes[0]?.code ?? null,
  }
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

/**
 * Comprueba que la cantidad tenga sentido para la unidad del producto.
 *
 * `1.235` unidades no existe. La comprobacion no puede vivir en el esquema
 * --que no conoce el producto-- ni en una restriccion de la base --que no
 * puede mirar otra tabla--, asi que vive aca y tiene su prueba.
 */
function exigirCantidadValida(unidad: UnidadDeVenta, valor: TextoCantidad, campo: string): void {
  if (valor === CERO) return
  const motivo = motivoDeCantidadInvalida(unidad, valor)
  if (motivo !== null) throw invalid(`${campo}: ${motivo}`)
}

export async function crearProducto(session: Session, input: CrearProductoInput) {
  const categoria = await prisma.category.findUnique({ where: { id: input.categoryId } })
  if (!categoria) throw invalid('La categoria indicada no existe')

  if (
    input.cost !== undefined &&
    input.cost !== null &&
    !session.permissions.has('products.cost.update')
  ) {
    // prettier-ignore
    throw forbidden('No tiene permiso para cargar el costo de un producto')
  }

  exigirCantidadValida(input.saleUnit, input.totalStock, 'Stock inicial')
  exigirCantidadValida(input.saleUnit, input.minimumStock, 'Stock minimo')

  const resultado = await prisma.$transaction(async (tx) => {
    const producto = await tx.product.create({
      data: {
        name: input.name,
        description: input.description ?? null,
        price: input.price,
        cost: input.cost ?? null,
        categoryId: input.categoryId,
        supplierId: input.supplierId ?? null,
        saleUnit: input.saleUnit,
        purchaseUnit: input.purchaseUnit,
        unitsPerPurchaseUnit: input.unitsPerPurchaseUnit,
        minimumStock: input.minimumStock,
        // La sucursal la fija el servidor, siempre.
        branchId: session.branchId,
      },
      select: { ...CAMPOS_PRODUCTO, branchId: true },
    })

    await sincronizarCodigos(tx, producto.id, input.barcode, input.alternateBarcodes)

    // El stock inicial entra por el libro, como todo lo demas: un producto que
    // nace con 20 unidades tiene un movimiento INITIAL de +20, y la suma de su
    // libro da 20 desde el primer dia.
    //
    // Con cero unidades no se emite nada. La invariante
    // suma(movimientos) == cantidad se cumple sola con la suma vacia, un
    // movimiento de cero no dice nada, y ademas asi un producto cargado por
    // error y sin ninguna operacion se puede seguir borrando.
    const inicial = aCantidad(input.totalStock)
    if (!esCeroCantidad(inicial)) {
      await applyStockMovement(tx, {
        branchId: session.branchId,
        productId: producto.id,
        type: 'INITIAL',
        quantity: inicial,
        saleUnit: input.saleUnit,
        userId: session.userId,
        reason: 'Stock inicial al dar de alta el producto',
        referenceType: 'Product',
        referenceId: producto.id,
      })
    }

    // El alta NO escribe historial de costos: un historial registra CAMBIOS, y
    // el costo con el que nace un producto queda en esta misma bitacora.
    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: producto.id,
      action: 'create',
      after: {
        ...paraBitacora(producto, session),
        barcode: input.barcode ?? null,
        stockInicial: input.totalStock,
      },
      origin: 'POST /api/products',
    })

    // Los codigos se releen de la base en vez de devolver los de la entrada:
    // es donde se resolvio la promocion del primer alternativo cuando no vino
    // principal, y la respuesta tiene que decir lo que quedo guardado.
    const codigos = await tx.productBarcode.findMany({
      where: { productId: producto.id },
      select: { code: true, isPrimary: true },
      orderBy: { id: 'asc' },
    })

    return { producto, inicial, codigos }
  })

  return {
    ...aProductoListado(resultado.producto, resultado.inicial, session),
    barcode: resultado.codigos.find((c) => c.isPrimary)?.code ?? null,
    alternateBarcodes: resultado.codigos.filter((c) => !c.isPrimary).map((c) => c.code),
  }
}

/**
 * Edicion del producto.
 *
 * Cuatro permisos distintos conviven en el mismo endpoint, y cada campo exige
 * el suyo:
 *
 *   products.update        nombre, codigos, descripcion, categoria, unidades
 *   products.price.update  precio
 *   products.cost.update   costo, y ademas con motivo
 *   stock.adjust           cantidad, y ademas con motivo
 *
 * Los cuatro se comprueban aca, en el servidor, y no solo escondiendo el campo
 * en la pantalla: esconder un input no impide mandar el PUT a mano.
 *
 * Un cambio que no cambia nada --mandar el mismo numero-- no se rechaza: no es
 * un intento de saltear el permiso, y fallar ahi obligaria a la pantalla a
 * saber que campos vienen "sucios".
 */
export async function editarProducto(session: Session, id: number, input: EditarProductoInput) {
  const antes = await productoDeLaSucursal(session, id)

  // `iguales` y no `!==`: son dos `Decimal`, y comparar objetos por identidad
  // daria "cambio" siempre.
  if (
    input.price !== undefined &&
    !iguales(dinero(input.price), antes.price) &&
    !session.permissions.has('products.price.update')
  ) {
    throw forbidden('No tiene permiso para cambiar el precio de un producto')
  }

  const cambiaCosto = input.cost !== undefined && !mismoCosto(input.cost, antes.cost)
  if (cambiaCosto && !session.permissions.has('products.cost.update')) {
    throw forbidden('No tiene permiso para cambiar el costo de un producto')
  }

  if (input.totalStock !== undefined && !session.permissions.has('stock.adjust')) {
    throw forbidden('No tiene permiso para ajustar el stock')
  }

  const unidad = unidadDeVentaODefecto(input.saleUnit ?? antes.saleUnit)

  // La unidad de venta no se cambia si el producto tiene historial. Hay un
  // disparador en la base que tambien lo impide; esto es el mensaje legible y
  // el que dice cuanto historial hay.
  if (input.saleUnit !== undefined && input.saleUnit !== antes.saleUnit) {
    const [movimientos, ventas] = await Promise.all([
      prisma.stockMovement.count({ where: { productId: id } }),
      prisma.saleItem.count({ where: { productId: id } }),
    ])
    if (movimientos > 0 || ventas > 0) {
      throw conflict(
        `No se puede cambiar la unidad de venta: el producto tiene ${movimientos} ` +
          `movimiento(s) de stock y ${ventas} linea(s) de venta, y sus cantidades ` +
          'estan guardadas en la unidad anterior. Dalo de baja y cargalo de nuevo.',
        { code: 'PRODUCT_UNIT_LOCKED' },
      )
    }
  }

  if (input.minimumStock !== undefined) {
    exigirCantidadValida(unidad, input.minimumStock, 'Stock minimo')
  }
  if (input.totalStock !== undefined) {
    exigirCantidadValida(unidad, input.totalStock, 'Stock')
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
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.price !== undefined ? { price: input.price } : {}),
        ...(input.cost !== undefined ? { cost: input.cost } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.supplierId !== undefined ? { supplierId: input.supplierId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.saleUnit !== undefined ? { saleUnit: input.saleUnit } : {}),
        ...(input.purchaseUnit !== undefined ? { purchaseUnit: input.purchaseUnit } : {}),
        ...(input.unitsPerPurchaseUnit !== undefined
          ? { unitsPerPurchaseUnit: input.unitsPerPurchaseUnit }
          : {}),
        ...(input.minimumStock !== undefined ? { minimumStock: input.minimumStock } : {}),
      },
      select: { ...CAMPOS_PRODUCTO, branchId: true },
    })

    if (input.barcode !== undefined || input.alternateBarcodes !== undefined) {
      await sincronizarCodigos(tx, id, input.barcode, input.alternateBarcodes)
    }

    // El cambio de costo deja fila en el historial, que es inmutable. El
    // motivo lo exige el esquema.
    if (cambiaCosto) {
      await tx.productCostHistory.create({
        data: {
          productId: id,
          previousCost: antes.cost,
          newCost: input.cost ?? 0,
          userId: session.userId,
          reason: input.costReason ?? 'Cambio de costo desde la ficha del producto',
        },
      })
    }

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: id,
      action: 'update',
      before: paraBitacora(antes, session),
      after: paraBitacora(despues, session),
      origin: 'PUT /api/products/:id',
    })

    const stockActual = await tx.branchStock.findUnique({
      where: { branchId_productId: { branchId: session.branchId, productId: id } },
      select: { quantity: true },
    })
    let saldo: Cantidad = stockActual?.quantity ?? aCantidad(0)

    if (input.totalStock !== undefined) {
      // La ficha manda el TOTAL, y el total se convierte en el delta que de
      // verdad ocurrio antes de escribir nada. Nunca se guarda "el stock nuevo
      // es 50" sin registrar como se llego.
      const delta = restarCantidades(aCantidad(input.totalStock), saldo)

      // Un delta de cero no se rechaza aca, a diferencia del recuento de
      // `PUT /api/stock/:id`. La diferencia es real: alla el recuento ES la
      // operacion y no hacer nada seria un error del usuario; aca es un campo
      // mas de un formulario de varios, y fallar la edicion entera porque el
      // stock quedo igual seria una molestia sin sentido.
      if (!esCeroCantidad(delta)) {
        const motivo = input.stockReason ?? 'Ajuste desde la ficha del producto'

        const resultado = await applyStockMovement(tx, {
          branchId: session.branchId,
          productId: id,
          type: 'MANUAL_ADJUSTMENT',
          quantity: delta,
          saleUnit: unidad,
          userId: session.userId,
          reason: motivo,
          referenceType: 'Product',
          referenceId: id,
          audit: { origin: 'PUT /api/products/:id' },
        })

        saldo = resultado.resultingQuantity
      }
    }

    const codigos = await tx.productBarcode.findMany({
      where: { productId: id },
      select: { code: true, isPrimary: true },
      orderBy: { id: 'asc' },
    })

    return {
      ...aProductoListado(despues, saldo, session),
      barcode: codigos.find((c) => c.isPrimary)?.code ?? null,
      alternateBarcodes: codigos.filter((c) => !c.isPrimary).map((c) => c.code),
    }
  })
}

/** Dos costos que pueden ser nulos. Null y cero NO son lo mismo. */
function mismoCosto(nuevo: string | null, actual: Dinero | null): boolean {
  if (nuevo === null || actual === null) return nuevo === null && actual === null
  return iguales(dinero(nuevo), actual)
}

/**
 * Cambio de costo por su propio camino.
 *
 * Separado de la edicion general a proposito: el pedido era que cambiar el
 * precio y cambiar el costo NO compartieran una sola autorizacion. Son dos
 * decisiones distintas --una la ve el cliente, la otra la negocia el
 * comprador-- y quien puede una no tiene por que poder la otra.
 */
export async function cambiarCosto(session: Session, id: number, input: CambiarCostoInput) {
  const antes = await productoDeLaSucursal(session, id)

  if (mismoCosto(input.cost, antes.cost)) {
    throw invalid(
      antes.cost === null
        ? 'El producto ya no tiene costo cargado: no hay nada que registrar'
        : `El costo ya es ${aMontoCosto(antes.cost)}: no hay nada que registrar`,
    )
  }

  return prisma.$transaction(async (tx) => {
    const despues = await tx.product.update({
      where: { id },
      data: { cost: input.cost },
      select: { ...CAMPOS_PRODUCTO, branchId: true },
    })

    const historial = await tx.productCostHistory.create({
      data: {
        productId: id,
        previousCost: antes.cost,
        newCost: input.cost ?? 0,
        supplierId: input.supplierId ?? null,
        userId: session.userId,
        reason: input.reason,
      },
      select: { id: true, createdAt: true },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: id,
      action: 'update',
      reason: input.reason,
      before: { cost: antes.cost === null ? null : aMontoCosto(antes.cost) },
      after: { cost: despues.cost === null ? null : aMontoCosto(despues.cost) },
      origin: 'PUT /api/products/:id/cost',
    })

    return {
      productId: id,
      previousCost: antes.cost === null ? null : aMontoCosto(antes.cost),
      cost: despues.cost === null ? null : aMontoCosto(despues.cost),
      historyId: historial.id,
      changedAt: historial.createdAt,
    }
  })
}

/**
 * Baja de un producto.
 *
 * Se niega en tres casos, y los tres son el mismo: el producto tiene
 * historial.
 *
 *   · Figura en alguna venta. Borrarlo dejaria items de venta apuntando a un
 *     producto inexistente y falsearia los reportes de meses anteriores.
 *   · Tiene movimientos de stock. Borrarlo obligaria a borrar su libro de
 *     inventario, y el libro es inmutable: hay un disparador en la base que lo
 *     impide.
 *   · Tiene cambios de costo registrados. Mismo argumento, misma tabla
 *     inmutable.
 *
 * Desde la Fase 3A la segunda condicion es la que manda en la practica: un
 * producto que se cargo con unidades, o al que se le ajusto la cantidad alguna
 * vez, YA NO SE BORRA. Se da de baja con `isActive`, que lo saca del catalogo
 * de venta sin tocar nada de lo anterior.
 *
 * Lo que si se puede borrar: un producto cargado por error, con cero unidades
 * y sin ninguna operacion. Que es exactamente el caso para el que servia el
 * boton. Sus codigos de barras se van con el --son atributos, no historia-- y
 * de eso se ocupa el ON DELETE CASCADE.
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

  const cambiosDeCosto = await prisma.productCostHistory.count({ where: { productId: id } })
  if (cambiosDeCosto > 0) {
    throw conflict(
      `No se puede eliminar: el producto tiene ${cambiosDeCosto} cambio(s) de costo ` +
        'registrados, y el historial de costos es inmutable. Dalo de baja en su lugar.',
      { code: 'PRODUCT_HAS_COST_HISTORY' },
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
      before: { id, name: producto.name, price: aMonto(producto.price) },
      origin: 'DELETE /api/products/:id',
    })
  })

  return { ok: true, message: 'Producto eliminado' }
}

// ---------------------------------------------------------------------------
// Actividad reciente
// ---------------------------------------------------------------------------

export interface EventoDeProducto {
  tipo: 'precio' | 'costo' | 'stock'
  fecha: Date
  texto: string
  usuario: string
  motivo: string | null
}

/** Cuantos eventos de cada clase. Es un resumen, no una auditoria completa. */
const EVENTOS_POR_CLASE = 5

/**
 * Ultimos movimientos de la ficha del producto.
 *
 * Tres fuentes distintas --precio, costo y stock-- unificadas en una lista
 * corta. NO duplica la auditoria: la bitacora completa sigue estando en
 * `/auditoria` con sus filtros. Esto responde una pregunta mas chica y mas
 * frecuente: "¿que le paso a este producto ultimamente?".
 *
 * Los cambios de PRECIO salen de `AuditLog` porque no tienen tabla propia; los
 * de COSTO, de su historial; los de STOCK, del libro. Que las tres cosas
 * vengan de tres lados no se nota en la pantalla, que es lo que importa.
 */
export async function actividadReciente(
  session: Session,
  productId: number,
): Promise<EventoDeProducto[]> {
  await productoDeLaSucursal(session, productId)

  const [movimientos, costos, ediciones] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { productId, branchId: session.branchId },
      select: {
        createdAt: true,
        type: true,
        quantity: true,
        resultingQuantity: true,
        reason: true,
        user: { select: { name: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: EVENTOS_POR_CLASE,
    }),
    puedeVerCosto(session)
      ? prisma.productCostHistory.findMany({
          where: { productId },
          select: {
            createdAt: true,
            previousCost: true,
            newCost: true,
            reason: true,
            user: { select: { name: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: EVENTOS_POR_CLASE,
        })
      : Promise.resolve([]),
    prisma.auditLog.findMany({
      where: { tableName: 'Product', recordId: productId, actionType: 'update' },
      select: { timestamp: true, changes: true, user: { select: { name: true } } },
      orderBy: { timestamp: 'desc' },
      take: EVENTOS_POR_CLASE * 3,
    }),
  ])

  const eventos: EventoDeProducto[] = [
    ...movimientos.map((m) => ({
      tipo: 'stock' as const,
      fecha: m.createdAt,
      texto: `${etiquetaDeTipo(m.type)}: ${aTextoCantidad(m.quantity)} → queda ${aTextoCantidad(m.resultingQuantity)}`, // prettier-ignore
      usuario: m.user.name,
      motivo: m.reason,
    })),
    ...costos.map((c) => ({
      tipo: 'costo' as const,
      fecha: c.createdAt,
      texto: `Costo: ${c.previousCost === null ? 'sin cargar' : aMontoCosto(c.previousCost)} → ${aMontoCosto(c.newCost)}`, // prettier-ignore
      usuario: c.user.name,
      motivo: c.reason,
    })),
    ...cambiosDePrecio(ediciones),
  ]

  return eventos
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime())
    .slice(0, EVENTOS_POR_CLASE * 3)
}

/** Filas de auditoria que de verdad cambiaron el precio. */
function cambiosDePrecio(
  filas: Array<{ timestamp: Date; changes: Prisma.JsonValue; user: { name: string } }>,
): EventoDeProducto[] {
  const salida: EventoDeProducto[] = []

  for (const fila of filas) {
    if (salida.length >= EVENTOS_POR_CLASE) break

    // `changes` es JSON libre: se comprueba campo por campo antes de leerlo.
    const cambios = fila.changes
    if (typeof cambios !== 'object' || cambios === null || Array.isArray(cambios)) continue

    const antes = cambios.before
    const despues = cambios.after
    if (typeof antes !== 'object' || antes === null || Array.isArray(antes)) continue
    if (typeof despues !== 'object' || despues === null || Array.isArray(despues)) continue

    const anterior = antes.price
    const nuevo = despues.price
    if (typeof anterior !== 'string' || typeof nuevo !== 'string') continue
    if (anterior === nuevo) continue

    salida.push({
      tipo: 'precio',
      fecha: fila.timestamp,
      texto: `Precio: ${anterior} → ${nuevo}`,
      usuario: fila.user.name,
      motivo: null,
    })
  }

  return salida
}
