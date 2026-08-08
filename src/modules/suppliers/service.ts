/**
 * Reglas de negocio de proveedores.
 *
 * Tres invariantes:
 *
 *   1. Lo unico obligatorio es el nombre. Un almacen conoce "Distribuidora
 *      Pepe" y un telefono, y eso es un proveedor valido.
 *   2. Un proveedor CON ACTIVIDAD no se borra: se desactiva. Hay ordenes y
 *      cambios de costo que lo referencian.
 *   3. Un proveedor DESACTIVADO no se puede elegir para una compra nueva,
 *      pero sigue nombrado en las viejas.
 *
 * Los proveedores NO son de una sucursal: son del negocio. Por eso ninguna de
 * estas funciones filtra por `branchId`, a diferencia de casi todo el resto
 * del sistema. Lo que si es por sucursal es lo que se les compra, y eso vive
 * en `PurchaseOrder`.
 *
 * Ver docs/SUPPLIER_MODEL.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import { aMontoCostoOpcional } from '@/server/money'
import type { CrearProveedorInput, EditarProveedorInput, ListarProveedoresQuery } from './schemas'

export interface ProveedorListado {
  id: number
  name: string
  legalName: string | null
  taxId: string | null
  phone: string | null
  email: string | null
  address: string | null
  contactName: string | null
  notes: string | null
  isActive: boolean
  /** Cuantos productos del catalogo se le compran. */
  productos: number
  /** Cuantas ordenes tiene, en cualquier estado. Lo que impide borrarlo. */
  ordenes: number
  /** Cuando se le compro por ultima vez. Null si nunca. */
  ultimaCompra: Date | null
}

const CAMPOS_PROVEEDOR = {
  id: true,
  name: true,
  legalName: true,
  taxId: true,
  phone: true,
  email: true,
  address: true,
  contactName: true,
  notes: true,
  isActive: true,
} as const

/**
 * Un proveedor por id, o 404.
 *
 * Sin filtro de sucursal, a proposito: los proveedores son del negocio. Un
 * encargado de la sucursal B tiene que poder ver los datos del mismo
 * distribuidor que usa la A.
 */
async function proveedorPorId(id: number) {
  // `select` explicito y no la fila entera: asi la columna congelada `contact`
  // no puede salir hacia la API por descuido. Un `findUnique` pelado la
  // incluiria, y borrarla despues del objeto es la clase de limpieza que
  // alguien se olvida de hacer en el segundo camino.
  const proveedor = await prisma.supplier.findUnique({
    where: { id },
    select: { ...CAMPOS_PROVEEDOR, createdAt: true, updatedAt: true },
  })
  if (!proveedor) throw notFound('Proveedor no encontrado')
  return proveedor
}

/**
 * Rechaza un nombre que ya exista.
 *
 * Se comprueba antes para poder dar un mensaje que nombre el problema: el
 * indice unico tambien lo impide, pero su error menciona la restriccion y la
 * tabla. La comprobacion previa no reemplaza al indice --entre el SELECT y el
 * INSERT cabe otra transaccion-- y por eso el indice sigue estando.
 */
async function exigirNombreLibre(name: string, exceptoId?: number): Promise<void> {
  const existente = await prisma.supplier.findFirst({
    where: { name, ...(exceptoId === undefined ? {} : { id: { not: exceptoId } }) },
    select: { id: true, name: true },
  })
  if (existente) {
    throw conflict(`Ya existe un proveedor llamado "${existente.name}"`, {
      code: 'DUPLICATE_SUPPLIER',
    })
  }
}

/**
 * Comprueba que el proveedor exista y este ACTIVO. Para comprarle.
 *
 * Se usa al crear una orden y al recibirla: entre las dos cosas pueden pasar
 * dias, y en el medio alguien puede haber dado de baja al proveedor.
 */
export async function exigirProveedorActivo(
  tx: Prisma.TransactionClient,
  supplierId: number,
): Promise<{ id: number; name: string }> {
  const proveedor = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, name: true, isActive: true },
  })
  if (!proveedor) throw notFound('Proveedor no encontrado')
  if (!proveedor.isActive) {
    throw conflict(
      `"${proveedor.name}" está dado de baja: no se le pueden hacer compras nuevas. ` +
        'Reactivalo si volvés a comprarle.',
      { code: 'SUPPLIER_INACTIVE' },
    )
  }
  return { id: proveedor.id, name: proveedor.name }
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export async function listarProveedores(
  query: ListarProveedoresQuery,
): Promise<Paginated<ProveedorListado>> {
  const where: Prisma.SupplierWhereInput = {
    ...(query.activos === undefined ? {} : { isActive: query.activos }),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { legalName: { contains: query.q, mode: 'insensitive' as const } },
            { taxId: { contains: query.q, mode: 'insensitive' as const } },
            { contactName: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  }

  const [total, proveedores] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      select: {
        ...CAMPOS_PROVEEDOR,
        _count: { select: { catalogo: true, orders: true } },
        // La ultima compra, en la misma consulta. Resolverla despues seria una
        // consulta por fila, que es exactamente el N+1 que la paginacion no
        // arregla.
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        },
      },
      // Activos primero: un listado que arranca con los dados de baja hace
      // pensar que no hay proveedores con los que trabajar.
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = proveedores.map(({ _count, orders, ...p }) => ({
    ...p,
    productos: _count.catalogo,
    ordenes: _count.orders,
    ultimaCompra: orders[0]?.createdAt ?? null,
  }))

  return paginado(data, total, query)
}

export interface ProductoDeProveedor {
  productId: number
  name: string
  supplierCode: string | null
  /** Solo para quien tenga `products.cost.view`. Ausente si no. */
  lastCost?: string | null
  isPreferred: boolean
}

/**
 * La ficha completa de un proveedor.
 *
 * Los productos que se le compran salen con `lastCost` SOLO si quien mira
 * puede ver costos. Es la misma regla que rige el catalogo desde la Fase 3B, y
 * se aplica aca por el mismo motivo: una respuesta de la API se lee con las
 * herramientas del navegador sin saber programar.
 */
export async function obtenerProveedor(session: Session, id: number) {
  const proveedor = await proveedorPorId(id)
  const puedeVerCosto = session.permissions.has('products.cost.view')

  const [productos, ordenes, cuantasOrdenes] = await Promise.all([
    prisma.productSupplier.findMany({
      where: { supplierId: id, product: { branchId: session.branchId } },
      select: {
        productId: true,
        supplierCode: true,
        lastCost: true,
        isPreferred: true,
        product: { select: { name: true } },
      },
      orderBy: [{ isPreferred: 'desc' }, { product: { name: 'asc' } }],
      take: 100,
    }),
    // Las ultimas compras. Cinco: es un resumen, no un listado.
    prisma.purchaseOrder.findMany({
      where: { supplierId: id, branchId: session.branchId },
      select: { id: true, number: true, status: true, createdAt: true, expectedTotal: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.purchaseOrder.count({ where: { supplierId: id } }),
  ])

  return {
    ...proveedor,
    ordenes: cuantasOrdenes,
    productos: productos.map((p) => ({
      productId: p.productId,
      name: p.product.name,
      supplierCode: p.supplierCode,
      isPreferred: p.isPreferred,
      ...(puedeVerCosto ? { lastCost: aMontoCostoOpcional(p.lastCost) } : {}),
    })),
    compras: ordenes.map((o) => ({
      id: o.id,
      number: o.number,
      status: o.status,
      createdAt: o.createdAt,
      // El importe solo para quien pueda ver costos: un total de compras es
      // informacion financiera tanto como un costo unitario.
      ...(puedeVerCosto ? { expectedTotal: o.expectedTotal.toFixed(2) } : {}),
    })),
  }
}

// ---------------------------------------------------------------------------
// Escritura
// ---------------------------------------------------------------------------

export async function crearProveedor(session: Session, input: CrearProveedorInput) {
  await exigirNombreLibre(input.name)

  return prisma.$transaction(async (tx) => {
    const creado = await tx.supplier.create({
      data: {
        name: input.name,
        legalName: input.legalName ?? null,
        taxId: input.taxId ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        address: input.address ?? null,
        contactName: input.contactName ?? null,
        notes: input.notes ?? null,
      },
      select: CAMPOS_PROVEEDOR,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Supplier',
      recordId: creado.id,
      action: 'create',
      after: creado,
      origin: 'POST /api/suppliers',
    })

    return creado
  })
}

export async function editarProveedor(session: Session, id: number, input: EditarProveedorInput) {
  const antes = await proveedorPorId(id)
  if (input.name !== undefined && input.name !== antes.name) {
    await exigirNombreLibre(input.name, id)
  }

  return prisma.$transaction(async (tx) => {
    const despues = await tx.supplier.update({
      where: { id },
      // Cada campo entra solo si vino. `undefined` en Prisma significa "no
      // tocar"; `null` significa "borrar", y las dos cosas son pedidos
      // distintos que el esquema distingue.
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.legalName === undefined ? {} : { legalName: input.legalName }),
        ...(input.taxId === undefined ? {} : { taxId: input.taxId }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.email === undefined ? {} : { email: input.email }),
        ...(input.address === undefined ? {} : { address: input.address }),
        ...(input.contactName === undefined ? {} : { contactName: input.contactName }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
      },
      select: CAMPOS_PROVEEDOR,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Supplier',
      recordId: id,
      action: 'update',
      before: {
        name: antes.name,
        legalName: antes.legalName,
        taxId: antes.taxId,
        phone: antes.phone,
        email: antes.email,
        address: antes.address,
        contactName: antes.contactName,
        notes: antes.notes,
      },
      after: despues,
      origin: 'PUT /api/suppliers/:id',
    })

    return despues
  })
}

/**
 * Activar o desactivar.
 *
 * Su propia operacion y no un campo mas de la edicion: dar de baja a un
 * proveedor tiene una consecuencia --deja de poder elegirse para comprar-- y
 * esconderla dentro de "guardar cambios" haria que ocurra sin querer.
 */
export async function cambiarEstadoDeProveedor(session: Session, id: number, isActive: boolean) {
  const antes = await proveedorPorId(id)
  if (antes.isActive === isActive) {
    return { id, isActive, message: isActive ? 'Ya estaba activo' : 'Ya estaba dado de baja' }
  }

  return prisma.$transaction(async (tx) => {
    const despues = await tx.supplier.update({
      where: { id },
      data: { isActive },
      select: CAMPOS_PROVEEDOR,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Supplier',
      recordId: id,
      // `update`, y no un `activate`/`deactivate` propios: la baja de un
      // usuario y la de un producto ya viajan asi, y una tercera forma de
      // decir lo mismo obligaria a buscar en dos lados. El antes y el despues
      // dicen exactamente que paso.
      action: 'update',
      before: { isActive: antes.isActive },
      after: { isActive },
      origin: 'PATCH /api/suppliers/:id',
    })

    return {
      ...despues,
      message: isActive ? 'Proveedor activado' : 'Proveedor dado de baja',
    }
  })
}

/**
 * Borrado fisico. Solo un proveedor cargado por error.
 *
 * Se niega si tiene ordenes, productos asociados o cambios de costo. Los tres
 * son la misma condicion: tiene historial, y borrarlo lo destruiria.
 *
 * El caso para el que sirve es el unico que queda: alguien tipeo "Distribuidra
 * Pepe", se dio cuenta, y quiere que desaparezca en vez de convivir con un
 * proveedor mal escrito y dado de baja para siempre.
 */
export async function eliminarProveedor(session: Session, id: number) {
  const proveedor = await proveedorPorId(id)

  const [ordenes, productos, costos] = await Promise.all([
    prisma.purchaseOrder.count({ where: { supplierId: id } }),
    prisma.productSupplier.count({ where: { supplierId: id } }),
    prisma.productCostHistory.count({ where: { supplierId: id } }),
  ])

  if (ordenes > 0 || productos > 0 || costos > 0) {
    // El mensaje nombra QUE lo retiene. Un "no se puede" sin motivo obliga a
    // adivinar por que, y a probar de a una las tres cosas.
    const motivos = [
      ordenes > 0 ? `${ordenes} orden(es) de compra` : null,
      productos > 0 ? `${productos} producto(s) asociado(s)` : null,
      costos > 0 ? `${costos} cambio(s) de costo` : null,
    ].filter(Boolean)

    throw conflict(
      `No se puede eliminar "${proveedor.name}": tiene ${motivos.join(', ')}. ` +
        'Borrarlo destruiría ese historial. Dalo de baja en su lugar.',
      { code: 'SUPPLIER_HAS_HISTORY' },
    )
  }

  await prisma.$transaction(async (tx) => {
    await tx.supplier.delete({ where: { id } })
    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Supplier',
      recordId: id,
      action: 'delete',
      before: { id, name: proveedor.name },
      origin: 'DELETE /api/suppliers/:id',
    })
  })

  return { ok: true, message: 'Proveedor eliminado' }
}
