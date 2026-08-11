/**
 * Reglas de negocio de compras.
 *
 * Cinco invariantes que atraviesan el modulo:
 *
 *   1. `branchId` sale siempre de la sesion. Nunca del cuerpo ni de la query.
 *   2. Los totales los calcula el SERVIDOR. El navegador no es fuente de nada.
 *   3. El estado lo decide el SERVIDOR, recalculandolo despues de cada
 *      recepcion. Nunca llega por la red.
 *   4. Recibir es UNA transaccion. Si falla el septimo producto de diez, no
 *      queda recibido ninguno.
 *   5. Una recepcion confirmada es INMUTABLE. Los errores se corrigen con un
 *      movimiento nuevo, no editando historia.
 *
 * El stock NO se toca desde aca: se llama a `applyStockMovement`, que es la
 * unica puerta que escribe sobre `BranchStock`. Hay una regla de ESLint que lo
 * impide.
 *
 * Ver docs/PURCHASE_FLOW.md y docs/PURCHASE_RECEIVING.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, forbidden, invalid, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { Monto } from '@/lib/money'
import type { TextoCantidad } from '@/lib/cantidad'
import {
  CERO_D,
  aMonto,
  aMontoCosto,
  aMontoCostoOpcional,
  dinero,
  iguales,
  multiplicar,
  redondearPesos,
  sumar,
  type Dinero,
} from '@/server/money'
import { CERO_C, aTextoCantidad, cantidad as aCantidad, type Cantidad } from '@/server/cantidad'
import { applyStockMovement, type TxClient } from '@/modules/inventory/service'
import { exigirProveedorActivo } from '@/modules/suppliers/service'
import { registrarCambioDeCosto } from '@/modules/products/costo'
import {
  esFechaLocal,
  finDelDia,
  hoyEnSucursal,
  inicioDelDia,
  sumarDias,
  zonaDeSucursal,
  type FechaLocal,
} from '@/server/tiempo'
// Fase 4B: la recepcion genera la deuda con el proveedor y, si se paga en el
// momento, tambien el pago. Las dos cosas por sus unicas puertas.
import { applySupplierAccountMovement, autorizanteDelSobrepago } from '@/modules/suppliers/cuenta'
import { inicioDeHoyEnSucursal } from '@/modules/suppliers/service.cuenta'
import {
  aplicarCreditoDisponible,
  aplicarPago,
  siguienteNumeroDePagoAProveedor,
} from '@/modules/suppliers/service.pagos'
import {
  unidadDeCompraODefecto,
  unidadDeVentaODefecto,
  type UnidadDeCompra,
  type UnidadDeVenta,
} from '@/modules/products/units'
import {
  calcularLinea,
  diferenciaDeCosto,
  pendienteComoTexto,
  totalDeOrden,
  type DiferenciaDeCosto,
} from './calculo'
import {
  etiquetaDeEstado,
  sePuedeBorrar,
  sePuedeCancelar,
  sePuedeConfirmar,
  sePuedeEditar,
  sePuedeRecibir,
  type EstadoDeCompra,
} from './status'
import type {
  BorradorDesdeReposicionInput,
  CancelarOrdenInput,
  CrearOrdenInput,
  EditarOrdenInput,
  LineaDeCompraInput,
  ListarOrdenesQuery,
  RecibirInput,
} from './schemas'

// ---------------------------------------------------------------------------
// Numeracion
// ---------------------------------------------------------------------------

/**
 * El siguiente numero de orden. `OC-00000042`.
 *
 * Sale de una SECUENCIA de PostgreSQL, no de `count() + 1`. Dos usuarios
 * creando una orden en el mismo segundo leerian el mismo count(), pedirian el
 * mismo numero, y el indice unico rechazaria a uno de los dos: esa persona
 * veria un error que no provoco.
 *
 * `nextval()` es atomico y ademas no bloquea. Deja huecos --una orden que se
 * empieza y se descarta se lleva su numero-- y esta bien: es una etiqueta para
 * decir "la 42" por telefono, no un contador de cuantas compras se hicieron.
 *
 * Se pide FUERA de la transaccion a proposito. `nextval` no se deshace con un
 * ROLLBACK, asi que pedirlo adentro no evitaria el hueco y solo alargaria la
 * transaccion.
 */
async function siguienteNumero(): Promise<string> {
  const filas = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT nextval('"PurchaseOrder_numero_seq"') AS n
  `
  const n = filas[0]?.n
  if (n === undefined) throw new Error('No se pudo obtener el numero de orden')
  return `OC-${String(n).padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Si esta sesion puede ver importes de compra. */
function puedeVerCosto(session: Session): boolean {
  return session.permissions.has('products.cost.view')
}

export interface OrdenListada {
  id: number
  number: string
  status: EstadoDeCompra
  statusLabel: string
  supplier: { id: number; name: string }
  createdBy: { id: number; name: string }
  createdAt: Date
  orderedAt: Date | null
  /** Cuantas lineas tiene y cuantas estan completas. */
  lineas: number
  lineasCompletas: number
  recepciones: number
  /** Solo con `products.cost.view`. Ausente si no. */
  expectedTotal?: Monto
}

const CAMPOS_ORDEN = {
  id: true,
  number: true,
  status: true,
  createdAt: true,
  orderedAt: true,
  expectedTotal: true,
  supplier: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const

/**
 * Arma la respuesta de una orden.
 *
 * Es el UNICO lugar donde se decide si el importe sale. Un total de compras es
 * informacion financiera tanto como un costo unitario: quien no puede ver
 * cuanto cuesta un producto tampoco puede ver cuanto se gasto comprandolo.
 * Concentrarlo aca es lo que permite que la regla se cumpla en el listado, en
 * el detalle y en el panel de inicio sin repetirla tres veces.
 */
function aOrdenListada(
  fila: {
    id: number
    number: string
    status: string
    createdAt: Date
    orderedAt: Date | null
    expectedTotal: Dinero
    supplier: { id: number; name: string }
    createdBy: { id: number; name: string }
  },
  conteos: { lineas: number; lineasCompletas: number; recepciones: number },
  session: Session,
): OrdenListada {
  const base = {
    id: fila.id,
    number: fila.number,
    status: fila.status as EstadoDeCompra,
    statusLabel: etiquetaDeEstado(fila.status),
    supplier: fila.supplier,
    createdBy: fila.createdBy,
    createdAt: fila.createdAt,
    orderedAt: fila.orderedAt,
    ...conteos,
  }
  if (!puedeVerCosto(session)) return base
  return { ...base, expectedTotal: aMonto(fila.expectedTotal) }
}

export async function listarOrdenes(
  session: Session,
  query: ListarOrdenesQuery,
): Promise<Paginated<OrdenListada>> {
  const zona = await zonaDeSucursal(prisma, session.branchId)

  const where: Prisma.PurchaseOrderWhereInput = {
    branchId: session.branchId,
    ...(query.supplierId === undefined ? {} : { supplierId: query.supplierId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.q ? { number: { contains: query.q, mode: 'insensitive' as const } } : {}),
    // El filtro por fecha se resuelve con la zona de la SUCURSAL: `desde` es
    // el primer instante de ese dia en el local y `hasta` el ultimo.
    // Ver docs/TIMEZONE_POLICY.md.
    ...(query.desde || query.hasta
      ? {
          createdAt: {
            ...(query.desde ? { gte: inicioDelDia(query.desde, zona) } : {}),
            ...(query.hasta ? { lte: finDelDia(query.hasta, zona) } : {}),
          },
        }
      : {}),
  }

  const [total, ordenes] = await Promise.all([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      select: {
        ...CAMPOS_ORDEN,
        _count: { select: { receipts: true } },
        // Las dos cantidades de cada linea, para poder contar cuantas estan
        // completas sin una consulta por orden. Con el tope de 200 lineas por
        // orden y 100 ordenes por pagina el peor caso sigue siendo una sola
        // consulta, que es el punto.
        items: { select: { orderedQuantity: true, receivedQuantity: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = ordenes.map(({ _count, items, ...orden }) =>
    aOrdenListada(
      orden,
      {
        lineas: items.length,
        lineasCompletas: items.filter((i) => i.receivedQuantity.equals(i.orderedQuantity)).length,
        recepciones: _count.receipts,
      },
      session,
    ),
  )

  return paginado(data, total, query)
}

export interface LineaDeOrden {
  id: number
  product: { id: number; name: string; saleUnit: UnidadDeVenta }
  purchaseUnit: UnidadDeCompra
  unitsPerPurchaseUnit: TextoCantidad
  orderedQuantity: TextoCantidad
  receivedQuantity: TextoCantidad
  pendingQuantity: TextoCantidad
  /** Lo que suma al stock si llega todo lo pendiente. */
  pendingStockQuantity: TextoCantidad
  unitCost?: string
  subtotal?: Monto
}

/** Lo devuelto de cada renglon de un conjunto de entregas. Una sola consulta. */
async function devueltoDeRecepciones(
  receiptIds: readonly number[],
): Promise<Map<number, Cantidad>> {
  if (receiptIds.length === 0) return new Map()

  const filas = await prisma.$queryRaw<Array<{ id: number; devuelto: Cantidad }>>`
    SELECT di."purchaseReceiptItemId" AS "id",
           sum(di."quantity")         AS "devuelto"
      FROM "PurchaseReturnItem" di
      JOIN "PurchaseReturn" d ON d."id" = di."purchaseReturnId"
     WHERE d."purchaseReceiptId" = ANY(${[...receiptIds]}::int[])
       AND d."status" = 'CONFIRMED'
     GROUP BY di."purchaseReceiptItemId"
  `
  return new Map(filas.map((f) => [f.id, f.devuelto]))
}

interface FinancieroDeEntrega {
  /** Lo que costo. NUNCA cambia. */
  total: Monto
  /** Lo devuelto al proveedor, al costo historico. */
  devuelto: Monto
  /** `total - devuelto`. Lo que realmente se debe por esta entrega. */
  neto: Monto
  /** Lo aplicado por pagos. Puede superar al neto si se devolvio despues de pagar. */
  imputado: Monto
  pendiente: Monto
  exceso: Monto
}

/** El estado financiero de cada entrega. Los cinco numeros del objetivo 22. */
async function estadoFinancieroDeRecepciones(
  receiptIds: readonly number[],
): Promise<Map<number, FinancieroDeEntrega>> {
  if (receiptIds.length === 0) return new Map()

  const filas = await prisma.$queryRaw<
    Array<{
      id: number
      total: string
      devuelto: string
      neto: string
      imputado: string
      pendiente: string
      exceso: string
    }>
  >`
    WITH entregas AS (
      SELECT r."id",
             r."total",
             COALESCE((
               SELECT sum(d."total") FROM "PurchaseReturn" d
                WHERE d."purchaseReceiptId" = r."id" AND d."status" = 'CONFIRMED'
             ), 0) AS devuelto,
             COALESCE((
               SELECT sum(a."amount") FROM "SupplierPaymentAllocation" a
                WHERE a."receiptId" = r."id"
             ), 0) AS imputado
        FROM "PurchaseReceipt" r
       WHERE r."id" = ANY(${[...receiptIds]}::int[])
    )
    SELECT "id",
           "total"::numeric(14,2)::text                                     AS "total",
           devuelto::numeric(14,2)::text                                    AS "devuelto",
           ("total" - devuelto)::numeric(14,2)::text                        AS "neto",
           imputado::numeric(14,2)::text                                    AS "imputado",
           GREATEST("total" - devuelto - imputado, 0)::numeric(14,2)::text  AS "pendiente",
           GREATEST(imputado - ("total" - devuelto), 0)::numeric(14,2)::text AS "exceso"
      FROM entregas
  `

  return new Map(
    filas.map((f) => [
      f.id,
      {
        total: f.total,
        devuelto: f.devuelto,
        neto: f.neto,
        imputado: f.imputado,
        pendiente: f.pendiente,
        exceso: f.exceso,
      },
    ]),
  )
}

/**
 * El detalle de una orden, con sus lineas y sus recepciones.
 *
 * Toda la trazabilidad en una pantalla: que se pidio, que llego, cuando, quien
 * lo recibio, a que costo, que volvio y cuanto queda por pagar. Es la consulta
 * mas cara del modulo y esta acotada por el tope de lineas de una orden.
 */
export async function obtenerOrden(session: Session, id: number) {
  const orden = await prisma.purchaseOrder.findFirst({
    where: { id, branchId: session.branchId },
    select: {
      ...CAMPOS_ORDEN,
      notes: true,
      cancelledAt: true,
      cancelReason: true,
      cancelledBy: { select: { id: true, name: true } },
      items: {
        select: {
          id: true,
          orderedQuantity: true,
          receivedQuantity: true,
          purchaseUnit: true,
          unitsPerPurchaseUnit: true,
          unitCost: true,
          subtotal: true,
          product: { select: { id: true, name: true, saleUnit: true } },
        },
        orderBy: { id: 'asc' },
      },
      receipts: {
        select: {
          id: true,
          receivedAt: true,
          notes: true,
          receivedBy: { select: { id: true, name: true } },
          items: {
            select: {
              id: true,
              purchaseOrderItemId: true,
              receivedQuantity: true,
              purchaseUnit: true,
              unitCost: true,
              expectedUnitCost: true,
              stockQuantity: true,
              stockUnitCost: true,
              product: { select: { id: true, name: true, saleUnit: true } },
            },
            orderBy: { id: 'asc' },
          },
        },
        orderBy: { receivedAt: 'asc' },
      },
    },
  })
  if (!orden) throw notFound('Orden de compra no encontrada')

  const verCosto = puedeVerCosto(session)
  const { items, receipts, _count: _sinUsar, ...cabecera } = { ...orden, _count: undefined }

  // Lo devuelto y lo imputado de cada entrega. Fase 4C, objetivo 22.
  //
  // DOS consultas agrupadas, no una por entrega ni una por renglon: una orden
  // con tres entregas de diez lineas seria treinta consultas para armar dos
  // columnas.
  const idsDeEntregas = receipts.map((r) => r.id)
  const [devueltoPorRenglon, financieroPorEntrega] = await Promise.all([
    devueltoDeRecepciones(idsDeEntregas),
    estadoFinancieroDeRecepciones(idsDeEntregas),
  ])

  return {
    ...aOrdenListada(
      cabecera,
      {
        lineas: items.length,
        lineasCompletas: items.filter((i) => i.receivedQuantity.equals(i.orderedQuantity)).length,
        recepciones: receipts.length,
      },
      session,
    ),
    notes: orden.notes,
    cancelledAt: orden.cancelledAt,
    cancelReason: orden.cancelReason,
    cancelledBy: orden.cancelledBy,
    puedeEditar: sePuedeEditar(orden.status),
    puedeConfirmar: sePuedeConfirmar(orden.status),
    puedeRecibir: sePuedeRecibir(orden.status),
    puedeCancelar: sePuedeCancelar(orden.status),

    items: items.map((i): LineaDeOrden => {
      const pendiente = pendienteComoTexto(i.orderedQuantity, i.receivedQuantity)
      return {
        id: i.id,
        product: {
          id: i.product.id,
          name: i.product.name,
          saleUnit: unidadDeVentaODefecto(i.product.saleUnit),
        },
        purchaseUnit: unidadDeCompraODefecto(i.purchaseUnit),
        unitsPerPurchaseUnit: aTextoCantidad(i.unitsPerPurchaseUnit),
        orderedQuantity: aTextoCantidad(i.orderedQuantity),
        receivedQuantity: aTextoCantidad(i.receivedQuantity),
        pendingQuantity: pendiente,
        pendingStockQuantity: aTextoCantidad(aCantidad(pendiente).times(i.unitsPerPurchaseUnit)),
        ...(verCosto ? { unitCost: aMontoCosto(i.unitCost), subtotal: aMonto(i.subtotal) } : {}),
      }
    }),

    receipts: receipts.map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt,
      notes: r.notes,
      receivedBy: r.receivedBy,
      // El desglose financiero de la entrega. El importe ORIGINAL nunca se
      // pisa: lo devuelto y la obligacion neta van al lado, no en su lugar. Es
      // lo que pide el objetivo 22, y el motivo es que las tres cifras
      // contestan preguntas distintas --cuanto costo, cuanto volvio, cuanto se
      // debe-- y una sola las confunde.
      ...(verCosto
        ? {
            financiero: financieroPorEntrega.get(r.id) ?? {
              total: aMonto(CERO_D),
              devuelto: aMonto(CERO_D),
              neto: aMonto(CERO_D),
              imputado: aMonto(CERO_D),
              pendiente: aMonto(CERO_D),
              exceso: aMonto(CERO_D),
            },
          }
        : {}),
      items: r.items.map((ri) => {
        const diferencia = diferenciaDeCosto(ri.expectedUnitCost, ri.unitCost)
        const devuelto = devueltoPorRenglon.get(ri.id) ?? CERO_C
        return {
          id: ri.id,
          orderItemId: ri.purchaseOrderItemId,
          product: {
            id: ri.product.id,
            name: ri.product.name,
            saleUnit: unidadDeVentaODefecto(ri.product.saleUnit),
          },
          purchaseUnit: unidadDeCompraODefecto(ri.purchaseUnit),
          receivedQuantity: aTextoCantidad(ri.receivedQuantity),
          returnedQuantity: aTextoCantidad(devuelto),
          netQuantity: aTextoCantidad(ri.receivedQuantity.minus(devuelto)),
          stockQuantity: aTextoCantidad(ri.stockQuantity),
          // La diferencia de costo es informacion financiera entera: sin el
          // permiso no viaja ni el importe ni el aviso de que hubo diferencia.
          ...(verCosto
            ? {
                unitCost: aMontoCosto(ri.unitCost),
                expectedUnitCost: aMontoCosto(ri.expectedUnitCost),
                stockUnitCost: aMontoCosto(ri.stockUnitCost),
                diferencia,
              }
            : {}),
        }
      }),
    })),
  }
}

// ---------------------------------------------------------------------------
// Escritura: la orden
// ---------------------------------------------------------------------------

interface LineaResuelta {
  productId: number
  purchaseUnit: UnidadDeCompra
  unitsPerPurchaseUnit: TextoCantidad
  orderedQuantity: TextoCantidad
  unitCost: string
  subtotal: Dinero
}

/**
 * Convierte las lineas de la peticion en lineas listas para guardar.
 *
 * Hace las cuatro cosas que no puede hacer el esquema, porque las cuatro
 * necesitan conocer el producto:
 *
 *   · que exista y sea de esta sucursal;
 *   · que no venga dos veces;
 *   · de donde salen `purchaseUnit` y `unitsPerPurchaseUnit` si no vinieron;
 *   · que la conversion a unidad de stock de una cantidad posible.
 *
 * La cuarta es la que evita el problema serio: 3 packs de 2,5 en un producto
 * que se vende por unidad son 7,5 unidades, y media unidad no existe. Se
 * rechaza AL CONFIRMAR y no al recibir, porque descubrirlo con el camion en la
 * puerta no le sirve a nadie.
 */
async function resolverLineas(
  tx: TxClient,
  branchId: number,
  items: LineaDeCompraInput[],
): Promise<LineaResuelta[]> {
  if (items.length === 0) return []

  const ids = items.map((i) => i.productId)
  const repetido = ids.find((id, i) => ids.indexOf(id) !== i)
  if (repetido !== undefined) {
    throw invalid(
      'Un producto no puede estar dos veces en la misma orden: serían dos pendientes ' +
        'del mismo artículo y al recibir no habría contra cuál imputar lo que llega.',
    )
  }

  const productos = await tx.product.findMany({
    where: { id: { in: ids }, branchId },
    select: {
      id: true,
      name: true,
      saleUnit: true,
      purchaseUnit: true,
      unitsPerPurchaseUnit: true,
      isActive: true,
    },
  })
  const porId = new Map(productos.map((p) => [p.id, p]))

  return items.map((item) => {
    const producto = porId.get(item.productId)
    // Mismo trato que en el resto del sistema: no se confirma que el producto
    // exista en otra sucursal.
    if (!producto) throw notFound(`Producto #${String(item.productId)} no encontrado`)
    if (!producto.isActive) {
      throw conflict(`"${producto.name}" está dado de baja: no se puede comprar.`)
    }

    const purchaseUnit = unidadDeCompraODefecto(item.purchaseUnit ?? producto.purchaseUnit)
    const unitsPerPurchaseUnit =
      item.unitsPerPurchaseUnit ?? aTextoCantidad(producto.unitsPerPurchaseUnit)

    const calculada = calcularLinea({
      saleUnit: unidadDeVentaODefecto(producto.saleUnit),
      purchaseUnit,
      cantidadDeCompra: item.quantity,
      unitsPerPurchaseUnit,
      unitCost: item.unitCost,
    })

    return {
      productId: item.productId,
      purchaseUnit,
      unitsPerPurchaseUnit,
      orderedQuantity: item.quantity,
      unitCost: item.unitCost,
      subtotal: calculada.subtotal,
    }
  })
}

export async function crearOrden(session: Session, input: CrearOrdenInput) {
  // El numero se pide antes de abrir la transaccion: `nextval` no se deshace
  // con un ROLLBACK, asi que pedirlo adentro no evitaria el hueco.
  const number = await siguienteNumero()

  const id = await prisma.$transaction(async (tx) => {
    await exigirProveedorActivo(tx, input.supplierId)
    const lineas = await resolverLineas(tx, session.branchId, input.items)

    const orden = await tx.purchaseOrder.create({
      data: {
        number,
        branchId: session.branchId,
        supplierId: input.supplierId,
        status: 'DRAFT',
        createdById: session.userId,
        notes: input.notes ?? null,
        expectedTotal: totalDeOrden(lineas.map((l) => l.subtotal)),
        items: { create: lineas },
      },
      select: { id: true, number: true, expectedTotal: true },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseOrder',
      recordId: orden.id,
      action: 'create',
      after: {
        number: orden.number,
        supplierId: input.supplierId,
        lineas: lineas.length,
        expectedTotal: aMonto(orden.expectedTotal),
      },
      origin: 'POST /api/purchases',
    })

    return orden.id
  })

  return obtenerOrden(session, id)
}

/**
 * Carga una orden para escribirla, comprobando estado y sucursal.
 *
 * Devuelve 404 tanto si no existe como si es de otra sucursal: las compras de
 * una sucursal no se confirman desde otra, y no hay que revelar que existen.
 */
async function ordenParaEscribir(
  tx: TxClient,
  session: Session,
  id: number,
  permitido: (estado: string) => boolean,
  code: 'ORDER_NOT_EDITABLE' | 'ORDER_NOT_RECEIVABLE' | 'ORDER_NOT_CANCELLABLE',
  queSeIntenta: string,
) {
  const orden = await tx.purchaseOrder.findFirst({
    where: { id, branchId: session.branchId },
    select: {
      id: true,
      number: true,
      status: true,
      supplierId: true,
      expectedTotal: true,
      notes: true,
    },
  })
  if (!orden) throw notFound('Orden de compra no encontrada')

  if (!permitido(orden.status)) {
    throw conflict(
      `La orden ${orden.number} está ${etiquetaDeEstado(orden.status).toLowerCase()} ` +
        `y no se puede ${queSeIntenta}.`,
      { code },
    )
  }
  return orden
}

export async function editarOrden(session: Session, id: number, input: EditarOrdenInput) {
  await prisma.$transaction(async (tx) => {
    const antes = await ordenParaEscribir(
      tx,
      session,
      id,
      sePuedeEditar,
      'ORDER_NOT_EDITABLE',
      'editar',
    )

    if (input.supplierId !== undefined && input.supplierId !== antes.supplierId) {
      await exigirProveedorActivo(tx, input.supplierId)
    }

    let total = antes.expectedTotal
    if (input.items !== undefined) {
      const lineas = await resolverLineas(tx, session.branchId, input.items)
      total = totalDeOrden(lineas.map((l) => l.subtotal))

      // Las lineas se reemplazan enteras, que es como se comporta el
      // formulario. Se puede borrar sin miedo: un borrador no tiene
      // recepciones colgando --las claves foraneas de `PurchaseReceiptItem`
      // son RESTRICT-- porque para tener una habria que haberlo confirmado.
      await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } })
      if (lineas.length > 0) {
        await tx.purchaseOrderItem.createMany({
          data: lineas.map((l) => ({ ...l, purchaseOrderId: id })),
        })
      }
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        ...(input.supplierId === undefined ? {} : { supplierId: input.supplierId }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        expectedTotal: total,
      },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseOrder',
      recordId: id,
      action: 'update',
      before: { supplierId: antes.supplierId, expectedTotal: aMonto(antes.expectedTotal) },
      after: {
        supplierId: input.supplierId ?? antes.supplierId,
        expectedTotal: aMonto(total),
        ...(input.items === undefined ? {} : { lineas: input.items.length }),
      },
      origin: 'PUT /api/purchases/:id',
    })
  })

  return obtenerOrden(session, id)
}

/**
 * Confirmar: el borrador pasa a ser un pedido.
 *
 * Es un camino de ida, y por eso exige al menos una linea: una orden sin
 * lineas confirmada no se puede recibir, no se puede editar y solo se puede
 * cancelar. Sería un callejon sin salida creado por un clic distraido.
 */
export async function confirmarOrden(session: Session, id: number) {
  await prisma.$transaction(async (tx) => {
    const orden = await ordenParaEscribir(
      tx,
      session,
      id,
      sePuedeConfirmar,
      'ORDER_NOT_EDITABLE',
      'confirmar',
    )
    await exigirProveedorActivo(tx, orden.supplierId)

    const lineas = await tx.purchaseOrderItem.count({ where: { purchaseOrderId: id } })
    if (lineas === 0) {
      throw invalid('No se puede confirmar una orden sin productos')
    }

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: 'ORDERED', orderedAt: new Date() },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseOrder',
      recordId: id,
      action: 'update',
      before: { status: 'DRAFT' },
      after: { status: 'ORDERED', number: orden.number, lineas },
      origin: 'POST /api/purchases/:id/confirm',
    })
  })

  return obtenerOrden(session, id)
}

/**
 * Cancelar.
 *
 * Una orden parcialmente recibida SI se puede cancelar: significa "el resto no
 * va a llegar", no "esto nunca paso". Lo ya recibido NO se revierte --la
 * mercaderia esta en el deposito-- y las recepciones, el stock, los costos y
 * el historial quedan intactos.
 */
export async function cancelarOrden(session: Session, id: number, input: CancelarOrdenInput) {
  await prisma.$transaction(async (tx) => {
    const orden = await ordenParaEscribir(
      tx,
      session,
      id,
      sePuedeCancelar,
      'ORDER_NOT_CANCELLABLE',
      'cancelar',
    )

    await tx.purchaseOrder.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: session.userId,
        cancelReason: input.reason,
        // Una orden que nunca se confirmo no tiene fecha de pedido, y la
        // restriccion de coherencia de la base exige que el CANCELLED tenga
        // cuando se cancelo y no exige el resto.
      },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseOrder',
      recordId: id,
      action: 'cancel',
      reason: input.reason,
      before: { status: orden.status },
      after: { status: 'CANCELLED', number: orden.number },
      origin: 'POST /api/purchases/:id/cancel',
    })
  })

  return obtenerOrden(session, id)
}

/**
 * Borrado fisico. SOLO un borrador.
 *
 * Una orden confirmada se cancela: alguien la mando, y que no haya llegado
 * nada no significa que no haya existido. Un borrador, en cambio, nunca salio
 * del sistema, y conservar cada intento de armar una compra convertiria el
 * listado en un cementerio.
 */
export async function eliminarOrden(session: Session, id: number) {
  await prisma.$transaction(async (tx) => {
    const orden = await ordenParaEscribir(
      tx,
      session,
      id,
      sePuedeBorrar,
      'ORDER_NOT_EDITABLE',
      'eliminar',
    )

    // Las lineas se van con el CASCADE de la clave foranea.
    await tx.purchaseOrder.delete({ where: { id } })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseOrder',
      recordId: id,
      action: 'delete',
      before: { number: orden.number, status: orden.status },
      origin: 'DELETE /api/purchases/:id',
    })
  })

  return { ok: true, message: 'Borrador eliminado' }
}

// ---------------------------------------------------------------------------
// Escritura: la recepcion
// ---------------------------------------------------------------------------

/**
 * Suma a `receivedQuantity` SIN pasarse de lo pedido, en UNA sentencia.
 *
 * Es la misma tecnica que cierra la venta de la ultima unidad desde la Fase 0,
 * y hace falta por la misma razon: leer, comparar en JavaScript y escribir
 * deja un hueco entre la lectura y la escritura. Con 5 pendientes y dos
 * procesos pidiendo 4 cada uno, los dos leen "quedan 5", los dos deciden que
 * alcanza, y la orden termina con 8 recibidos de 5.
 *
 * PostgreSQL toma el bloqueo de la fila y REEVALUA la condicion despues de
 * esperarlo, asi que el segundo ve el acumulado del primero y no actualiza
 * nada. Sin fila devuelta, la transaccion entera se deshace.
 *
 * El CHECK de la base dice lo mismo y es la garantia de ultima instancia; esto
 * es lo que ademas permite dar un mensaje legible.
 */
async function sumarRecibido(
  tx: TxClient,
  orderItemId: number,
  orderId: number,
  delta: TextoCantidad,
): Promise<Cantidad | null> {
  const filas = await tx.$queryRaw<Array<{ recibido: Cantidad }>>`
    UPDATE "PurchaseOrderItem"
       SET "receivedQuantity" = "receivedQuantity" + ${delta}::numeric
     WHERE "id" = ${orderItemId}
       AND "purchaseOrderId" = ${orderId}
       AND "receivedQuantity" + ${delta}::numeric <= "orderedQuantity"
    RETURNING "receivedQuantity"::numeric(14,3) AS recibido
  `
  return filas[0]?.recibido ?? null
}

export interface ResultadoDeRecepcion {
  receiptId: number
  orderId: number
  number: string
  status: EstadoDeCompra
  lineas: Array<{
    productId: number
    productName: string
    /** En unidad de compra. */
    received: TextoCantidad
    /** En unidad de venta: lo que entro al stock. */
    stockQuantity: TextoCantidad
    previousStock: TextoCantidad
    resultingStock: TextoCantidad
    costoActualizado: boolean
    diferencia?: DiferenciaDeCosto
  }>
  /** Lo que esta entrega costo, al costo REAL. Es el importe de la deuda. */
  total: Monto
  /** Cuando vence la obligacion. `null` si no se registro ninguno. */
  dueDate: Date | null
  /** El saldo del proveedor DESPUES de esta entrega. */
  saldoProveedor: Monto
  /** El pago inmediato, si se registro uno. */
  pago: { id: number; number: string; amount: Monto } | null
  /** Los anticipos que se consumieron, si se pidio aplicarlos. Fase 4C. */
  anticipos: Array<{ paymentId: number; number: string; amount: Monto }>
}

/**
 * Recibir mercaderia. LA operacion del modulo.
 *
 * UNA transaccion, quince pasos, y todo o nada: si falla el septimo producto de
 * diez, no queda recibido ninguno. Ver la tabla completa en
 * docs/PURCHASE_RECEIVING.md.
 *
 * El stock no se toca directamente: se llama a `applyStockMovement`, que es la
 * unica puerta que escribe sobre `BranchStock` y la que garantiza que el libro
 * y el saldo no se separen.
 */
export async function recibirMercaderia(
  session: Session,
  orderId: number,
  input: RecibirInput,
): Promise<ResultadoDeRecepcion> {
  const puedeCambiarCosto = session.permissions.has('products.cost.update')

  // Lo del pago inmediato se resuelve ANTES de abrir la transaccion, y las tres
  // cosas por su propio motivo:
  //
  //   · el PERMISO de sobrepago, para rechazar antes de haber escrito nada;
  //   · el NUMERO, porque `nextval` no se deshace con un ROLLBACK y pedirlo
  //     adentro solo alargaria la transaccion sin evitar el hueco;
  //   · el INICIO DE HOY, que necesita una consulta a `Branch` que no tiene por
  //     que ocurrir con la transaccion abierta.
  //
  // El sobrepago NO se puede saber aca --el saldo todavia no incluye esta
  // entrega, asi que la lectura previa no dice nada util--: por eso el tercer
  // argumento va en `false`. Lo frena igual la condicion `balance + delta >= 0`
  // del libro, que corre con el saldo ya cargado.
  const autorizanteDelPago = autorizanteDelSobrepago(
    session,
    input.pago?.acceptCredit ?? false,
    false,
  )
  const numeroDePago = input.pago === undefined ? null : await siguienteNumeroDePagoAProveedor()
  const inicioDeHoy =
    input.pago === undefined ? null : await inicioDeHoyEnSucursal(prisma, session.branchId)

  return prisma.$transaction(async (tx) => {
    // 1-2. La orden y su estado.
    const orden = await ordenParaEscribir(
      tx,
      session,
      orderId,
      sePuedeRecibir,
      'ORDER_NOT_RECEIVABLE',
      'recibir',
    )

    // 3. El proveedor. Entre confirmar y recibir pueden pasar dias, y en el
    //    medio alguien puede haberlo dado de baja.
    const proveedor = await exigirProveedorActivo(tx, orden.supplierId)

    // 4. Las lineas, y que sean de ESTA orden.
    const lineas = await tx.purchaseOrderItem.findMany({
      where: { id: { in: input.items.map((i) => i.orderItemId) }, purchaseOrderId: orderId },
      select: {
        id: true,
        productId: true,
        orderedQuantity: true,
        receivedQuantity: true,
        purchaseUnit: true,
        unitsPerPurchaseUnit: true,
        unitCost: true,
        product: { select: { id: true, name: true, saleUnit: true, cost: true } },
      },
    })
    const porId = new Map(lineas.map((l) => [l.id, l]))

    const repetidos = input.items.map((i) => i.orderItemId)
    if (new Set(repetidos).size !== repetidos.length) {
      throw invalid('Una línea no puede recibirse dos veces en la misma recepción')
    }

    // 5b. LOS COSTOS Y EL TOTAL, ANTES de crear la cabecera. Fase 4B.
    //
    //     Esto era parte del bucle de abajo y subio aca por una razon concreta:
    //     `PurchaseReceipt` es INMUTABLE, y su importe --que es el de la
    //     obligacion con el proveedor-- tiene que quedar escrito en el INSERT.
    //     Rellenarlo despues con un UPDATE es exactamente lo que el disparador
    //     de la Fase 3C rechaza, y con razon.
    //
    //     El costo se resuelve una sola vez y se reusa en el bucle: es el mismo
    //     calculo, y hacerlo dos veces abriria la puerta a que las dos copias
    //     dejen de coincidir.
    const costos = new Map<number, { esperado: Dinero; recibido: Dinero }>()
    let totalDeLaRecepcion = CERO_D

    for (const pedido of input.items) {
      const linea = porId.get(pedido.orderItemId)
      if (!linea) {
        throw invalid(`La línea #${String(pedido.orderItemId)} no pertenece a esta orden`)
      }

      // El costo: el de la orden, salvo que se declare otro.
      const esperado = linea.unitCost
      const recibido = pedido.unitCost === undefined ? esperado : dinero(pedido.unitCost)

      if (!iguales(esperado, recibido) && !puedeCambiarCosto) {
        throw forbidden(
          `No tenés permiso para recibir "${linea.product.name}" a un costo distinto del ` +
            'pedido. Podés recibirlo al costo de la orden, o pedirle a quien maneja ' +
            'costos que lo reciba.',
        )
      }

      costos.set(pedido.orderItemId, { esperado, recibido })

      // El importe de LA OBLIGACION, al costo REAL de la factura y no al
      // esperado de la orden (objetivo 6). Se redondea LINEA POR LINEA y
      // despues se suma, en ese orden y no al reves: es como se arma una
      // factura, y sumar exacto para redondear al final daria un total que no
      // coincide con el papel que trajo el proveedor.
      totalDeLaRecepcion = sumar(
        totalDeLaRecepcion,
        redondearPesos(multiplicar(recibido, pedido.quantity)),
      )
    }

    // 5c. El vencimiento, CONGELADO. Fase 4B, objetivos 18 y 19.
    //
    //     Se calcula ahora y no se vuelve a mirar: si mañana se le baja el plazo
    //     al proveedor a quince dias, esta deuda sigue venciendo cuando vence.
    //     `undefined` significa "decidilo vos" y `null`, "que no tenga": son
    //     distintos y por eso se comprueban distinto.
    const dueDate =
      input.dueDate === undefined
        ? await vencimientoSugerido(tx, session.branchId, proveedor.id)
        : input.dueDate === null
          ? null
          : inicioDelDia(
              exigirFechaLocal(input.dueDate),
              await zonaDeSucursal(tx, session.branchId),
            )

    // 6. La cabecera. Se crea antes que las lineas para tener su id, que es la
    //    referencia de los movimientos de stock y del historial de costos.
    const recepcion = await tx.purchaseReceipt.create({
      data: {
        purchaseOrderId: orderId,
        branchId: session.branchId,
        receivedById: session.userId,
        notes: input.notes ?? null,
        total: totalDeLaRecepcion,
        dueDate,
        // Entra al libro del proveedor en esta misma transaccion, unas lineas
        // mas abajo. Se escribe aca porque la fila es inmutable despues.
        debtRecorded: true,
      },
      select: { id: true, receivedAt: true },
    })

    const resultado: ResultadoDeRecepcion['lineas'] = []

    for (const pedido of input.items) {
      const linea = porId.get(pedido.orderItemId)
      if (!linea) {
        throw invalid(`La línea #${String(pedido.orderItemId)} no pertenece a esta orden`)
      }

      const saleUnit = unidadDeVentaODefecto(linea.product.saleUnit)
      const purchaseUnit = unidadDeCompraODefecto(linea.purchaseUnit)
      const factor = aTextoCantidad(linea.unitsPerPurchaseUnit)

      // Resueltos en la pasada de arriba. `??` por el tipo: la clave existe
      // siempre, porque el bucle recorre exactamente los mismos elementos.
      const { esperado: costoEsperado, recibido: costoRecibido } = costos.get(
        pedido.orderItemId,
      ) ?? { esperado: linea.unitCost, recibido: linea.unitCost }

      // 5. La conversion y los numeros de la linea, de una sola vez.
      const calculada = calcularLinea({
        saleUnit,
        purchaseUnit,
        cantidadDeCompra: pedido.quantity,
        unitsPerPurchaseUnit: factor,
        unitCost: aMontoCosto(costoRecibido),
      })

      // 8. La suma atomica. Aca es donde se rechaza la sobre-recepcion.
      const acumulado = await sumarRecibido(tx, linea.id, orderId, pedido.quantity)
      if (acumulado === null) {
        const pendiente = pendienteComoTexto(linea.orderedQuantity, linea.receivedQuantity)
        throw conflict(
          `No se puede recibir ${pedido.quantity} de "${linea.product.name}": ` +
            `quedaban ${pendiente} pendiente(s) de ${aTextoCantidad(linea.orderedQuantity)} ` +
            'pedido(s).',
          { code: 'OVER_RECEIPT' },
        )
      }

      // 7. La linea de la recepcion.
      await tx.purchaseReceiptItem.create({
        data: {
          purchaseReceiptId: recepcion.id,
          purchaseOrderItemId: linea.id,
          productId: linea.productId,
          receivedQuantity: pedido.quantity,
          purchaseUnit,
          unitsPerPurchaseUnit: factor,
          unitCost: costoRecibido,
          expectedUnitCost: costoEsperado,
          stockQuantity: calculada.cantidadDeStock,
          stockUnitCost: calculada.costoDeStock,
        },
      })

      // 9-10. El stock, por la unica puerta.
      const movimiento = await applyStockMovement(tx, {
        branchId: session.branchId,
        productId: linea.productId,
        type: 'PURCHASE_RECEIPT',
        quantity: calculada.cantidadDeStock,
        saleUnit,
        userId: session.userId,
        reason: `Recepción de ${orden.number}`,
        // A la RECEPCION, no a la orden: una orden puede tener varias entregas
        // y con la orden como referencia no se sabria cual movio estas
        // unidades.
        referenceType: 'PurchaseReceipt',
        referenceId: recepcion.id,
      })

      // 11-12. El costo. Politica LAST RECEIVED COST: manda la ultima
      //        recepcion confirmada. Ver docs/PURCHASE_RECEIVING.md.
      //
      //        Por el registrador unico, que toma el bloqueo de la fila del
      //        producto y decide si hay cambio. Antes esto leia el costo del
      //        `select` de la linea y comparaba aca: dos recepciones
      //        simultaneas del mismo producto leian el mismo costo anterior y
      //        dejaban dos filas de historial encadenadas al mismo punto.
      const cambio = await registrarCambioDeCosto(tx, {
        productId: linea.productId,
        nuevo: calculada.costoDeStock,
        supplierId: orden.supplierId,
        receiptId: recepcion.id,
        userId: session.userId,
        reason: `Recepción de ${orden.number} — ${proveedor.name}`,
      })

      // 13. El ultimo costo pactado con ESTE proveedor, para armar la proxima
      //     orden. No es historial: es un dato de referencia que se pisa.
      await tx.productSupplier.upsert({
        where: {
          productId_supplierId: { productId: linea.productId, supplierId: orden.supplierId },
        },
        update: { lastCost: costoRecibido },
        create: {
          productId: linea.productId,
          supplierId: orden.supplierId,
          lastCost: costoRecibido,
          // No se marca principal: comprarle una vez a alguien no lo convierte
          // en el proveedor habitual, y pisar el principal en cada recepcion
          // haria que el ultimo que entrego gane siempre.
          isPreferred: false,
        },
      })

      const diferencia = diferenciaDeCosto(costoEsperado, costoRecibido)
      resultado.push({
        productId: linea.productId,
        productName: linea.product.name,
        received: pedido.quantity,
        stockQuantity: aTextoCantidad(calculada.cantidadDeStock),
        previousStock: aTextoCantidad(movimiento.previousQuantity),
        resultingStock: aTextoCantidad(movimiento.resultingQuantity),
        costoActualizado: cambio.cambio,
        ...(puedeVerCosto(session) ? { diferencia } : {}),
      })

      // Una diferencia de costo se audita APARTE, con su propia entrada, para
      // poder preguntar despues "¿en que recepciones nos cobraron de mas?".
      if (diferencia.hayDiferencia) {
        await audit(tx, {
          userId: session.userId,
          branchId: session.branchId,
          table: 'PurchaseReceiptItem',
          recordId: recepcion.id,
          action: 'update',
          reason: `Costo recibido distinto del pedido en ${orden.number}`,
          before: { unitCost: diferencia.esperado },
          after: {
            unitCost: diferencia.recibido,
            diferencia: diferencia.diferencia,
            porcentaje: diferencia.porcentaje,
            productId: linea.productId,
            supplierId: orden.supplierId,
          },
          origin: 'POST /api/purchases/:id/receive',
        })
      }
    }

    // 14. El estado, recalculado sobre TODAS las lineas de la orden.
    const estado = await recalcularEstado(tx, orderId)

    // 15. LA DEUDA. Fase 4B, objetivos 4, 5 y 6.
    //
    //     Nace ACA y no al crear la orden: una orden es un pedido --se cancela,
    //     llega la mitad, no llega nada-- y nada de eso se debe. Lo que se debe
    //     es lo que LLEGO.
    //
    //     Va por la unica puerta que escribe `Supplier.balance`. Y no puede
    //     duplicarse: hay un indice unico parcial sobre `receiptId` para
    //     `PURCHASE_CHARGE`, asi que un reintento que llegara a repetir la
    //     recepcion chocaria contra la base, no contra una comprobacion.
    const cargo = await applySupplierAccountMovement(tx, {
      branchId: session.branchId,
      supplierId: orden.supplierId,
      type: 'PURCHASE_CHARGE',
      amount: totalDeLaRecepcion,
      userId: session.userId,
      receiptId: recepcion.id,
    })

    // 15b. LOS ANTICIPOS. Fase 4C, objetivo 4.
    //
    //      Despues del cargo --antes no hay obligacion contra la cual
    //      imputarlos-- y antes del pago inmediato, para que el pago cubra lo
    //      que el credito no alcanzo a cubrir y no al reves.
    //
    //      NO SE APLICAN SOLOS: hace falta que la peticion lo pida. Aplicarlos en
    //      silencio haria que el saldo baje sin que quien recibe entienda por
    //      que, y que un anticipo reservado para otra compra desaparezca sin
    //      aviso. La pantalla muestra el credito disponible y pregunta.
    //
    //      El tope es el importe de esta entrega, que acaba de nacer y todavia no
    //      tiene ninguna imputacion. `aplicarCreditoDisponible` no se fia de eso:
    //      vuelve a mirar el pendiente real con la fila tomada.
    const anticipos = input.aplicarAnticipos
      ? await aplicarCreditoDisponible(tx, {
          supplierId: orden.supplierId,
          receiptId: recepcion.id,
          userId: session.userId,
          tope: totalDeLaRecepcion,
        })
      : []

    // 16. El pago inmediato, si lo hubo. Objetivo 17.
    //
    //     DESPUES del cargo, siempre. "Pagado al contado" no evita la deuda: la
    //     crea y la salda, y las dos cosas quedan en el libro. En la MISMA
    //     transaccion, asi que si el pago falla no queda ni la entrega.
    const pago =
      input.pago === undefined
        ? null
        : await aplicarPago(tx, session, {
            supplierId: orden.supplierId,
            supplierName: proveedor.name,
            input: { ...input.pago, imputacion: 'automatica' as const },
            number: numeroDePago ?? '',
            inicioDeHoy: inicioDeHoy ?? '',
            autorizante: autorizanteDelPago,
          })

    // 17. La bitacora de la recepcion.
    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseReceipt',
      recordId: recepcion.id,
      action: 'create',
      after: {
        orderId,
        number: orden.number,
        supplierId: orden.supplierId,
        lineas: resultado.length,
        status: estado,
        // Lo financiero, en la misma entrada: quien lee la bitacora de una
        // recepcion quiere ver de una vez cuanto se le debe al proveedor por
        // ella y cuando vence.
        importe: aMonto(totalDeLaRecepcion),
        vencimiento: dueDate?.toISOString() ?? null,
        saldoProveedorAnterior: aMonto(cargo.previousBalance),
        saldoProveedorNuevo: aMonto(cargo.resultingBalance),
        movimientoId: cargo.movementId,
        ...(pago === null ? {} : { pagoInmediato: pago.number }),
        ...(anticipos.length === 0
          ? {}
          : {
              anticiposAplicados: anticipos.map((a) => ({
                pago: a.number,
                importe: aMonto(a.amount),
              })),
            }),
      },
      origin: 'POST /api/purchases/:id/receive',
    })

    // El saldo que se informa es el POSTERIOR al cargo, y no cambia por aplicar
    // anticipos: una imputacion no mueve el saldo. Es la regla del objetivo 3, y
    // aca se ve para que sirve: la plata del anticipo ya habia bajado el saldo
    // cuando se entrego.
    return {
      receiptId: recepcion.id,
      orderId,
      number: orden.number,
      status: estado,
      lineas: resultado,
      total: aMonto(totalDeLaRecepcion),
      dueDate,
      saldoProveedor: aMonto(cargo.resultingBalance),
      pago: pago === null ? null : { id: pago.id, number: pago.number, amount: pago.amount },
      anticipos: anticipos.map((a) => ({
        paymentId: a.paymentId,
        number: a.number,
        amount: aMonto(a.amount),
      })),
    }
  })
}

/**
 * El vencimiento que le corresponde a una entrega de hoy.
 *
 * `Supplier.defaultPaymentTermDays` SUGIERE; esto lo convierte en fecha. NULL y
 * 0 siguen siendo afirmaciones distintas:
 *
 *   NULL  nadie declaro el plazo    -> sin vencimiento
 *   0     se paga contra entrega    -> vence hoy
 *
 * El dia de partida es el DIA COMERCIAL de la sucursal, no el del servidor. Ver
 * docs/TIMEZONE_POLICY.md.
 */
/**
 * Estrecha una fecha que ya paso por el esquema.
 *
 * El esquema comprueba la FORMA (`AAAA-MM-DD`) y esto comprueba que sea una
 * fecha que existe: `2026-02-30` cumple el patron y no es un dia. Existe ademas
 * para que TypeScript sepa que a partir de aca el texto es una `FechaLocal`.
 */
function exigirFechaLocal(texto: string): FechaLocal {
  if (!esFechaLocal(texto)) throw invalid('La fecha de vencimiento no es válida')
  return texto
}

async function vencimientoSugerido(
  tx: TxClient,
  branchId: number,
  supplierId: number,
): Promise<Date | null> {
  const proveedor = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { defaultPaymentTermDays: true },
  })
  const plazo = proveedor?.defaultPaymentTermDays
  if (plazo == null) return null

  const zona = await zonaDeSucursal(tx, branchId)
  const hoy = await hoyEnSucursal(tx, branchId)
  return inicioDelDia(sumarDias(hoy, plazo), zona)
}

/**
 * El estado que le corresponde a la orden segun lo que lleva recibido.
 *
 * Lo decide el SERVIDOR y nunca llega por la red. Se recalcula entero en vez de
 * ir sumando: con dos recepciones concurrentes, "estaba parcial y ahora
 * recibi el resto" puede ser falso desde el punto de vista de la otra.
 *
 * Una orden CANCELLED no vuelve a cambiar de estado, aunque se pudiera recibir
 * algo: cancelar es una decision de una persona y recalcularla la borraria.
 */
async function recalcularEstado(tx: TxClient, orderId: number): Promise<EstadoDeCompra> {
  const lineas = await tx.purchaseOrderItem.findMany({
    where: { purchaseOrderId: orderId },
    select: { orderedQuantity: true, receivedQuantity: true },
  })

  const algoRecibido = lineas.some((l) => !l.receivedQuantity.isZero())
  const todoRecibido =
    lineas.length > 0 && lineas.every((l) => l.receivedQuantity.equals(l.orderedQuantity))

  const estado: EstadoDeCompra = todoRecibido
    ? 'RECEIVED'
    : algoRecibido
      ? 'PARTIALLY_RECEIVED'
      : 'ORDERED'

  await tx.purchaseOrder.update({ where: { id: orderId }, data: { status: estado } })
  return estado
}

// ---------------------------------------------------------------------------
// Reposicion
// ---------------------------------------------------------------------------

/**
 * Arma borradores de compra a partir de productos bajo minimo.
 *
 * Agrupa POR PROVEEDOR PRINCIPAL y crea un borrador por cada uno: una orden
 * mezcla productos de dos distribuidoras no se le puede mandar a ninguna.
 *
 * Un producto sin proveedor principal se SALTEA y se informa por su nombre. La
 * alternativa --meterlo en cualquier orden-- haria que alguien le pidiera a
 * Distribuidora X algo que X no vende.
 *
 * Lo que NO hace, y es deliberado: no confirma nada. Deja BORRADORES para que
 * una persona los revise. Ordenar mercaderia sola es exactamente el tipo de
 * automatismo que termina con veinte cajas de algo que nadie compra.
 */
export async function borradorDesdeReposicion(
  session: Session,
  input: BorradorDesdeReposicionInput,
) {
  const productos = await prisma.product.findMany({
    where: { id: { in: input.productIds }, branchId: session.branchId, isActive: true },
    select: {
      id: true,
      name: true,
      cost: true,
      minimumStock: true,
      purchaseUnit: true,
      unitsPerPurchaseUnit: true,
      saleUnit: true,
      stocks: { where: { branchId: session.branchId }, select: { quantity: true } },
      suppliers: {
        where: { isPreferred: true },
        select: { supplierId: true, lastCost: true, supplier: { select: { isActive: true } } },
        take: 1,
      },
    },
  })

  const sinProveedor: string[] = []
  const porProveedor = new Map<number, LineaDeCompraInput[]>()

  for (const p of productos) {
    const vinculo = p.suppliers[0]
    if (!vinculo || !vinculo.supplier.isActive) {
      sinProveedor.push(p.name)
      continue
    }

    // Cuanto pedir: lo que falta para llegar al minimo, redondeado hacia
    // arriba a unidades de compra enteras. Nadie pide media caja.
    //
    // Es una SUGERENCIA sobre un borrador: quien arma la compra la corrige
    // antes de confirmar. Por eso el criterio puede ser simple y no intenta
    // adivinar la rotacion, que es una cuenta que este sistema todavia no
    // tiene datos para hacer.
    const stock = p.stocks[0]?.quantity ?? aCantidad(0)
    const faltante = p.minimumStock.minus(stock)
    const porUnidad = p.unitsPerPurchaseUnit.isZero() ? aCantidad(1) : p.unitsPerPurchaseUnit
    const cajas = faltante.dividedBy(porUnidad).ceil()
    const cantidad = cajas.lessThan(1) ? aCantidad(1) : cajas

    // El costo sugerido: el ultimo pactado con ese proveedor, o el costo del
    // producto llevado a unidad de compra. Si no hay ninguno, cero, que es
    // "no sabemos" y obliga a completarlo antes de confirmar.
    const costo = vinculo.lastCost ?? (p.cost === null ? aCantidad(0) : p.cost.times(porUnidad))

    const lista = porProveedor.get(vinculo.supplierId) ?? []
    lista.push({
      productId: p.id,
      quantity: aTextoCantidad(cantidad),
      unitCost: aMontoCosto(dinero(costo)),
    })
    porProveedor.set(vinculo.supplierId, lista)
  }

  const creadas: Array<{ id: number; number: string; supplierId: number; lineas: number }> = []
  for (const [supplierId, items] of porProveedor) {
    const orden = await crearOrden(session, {
      supplierId,
      notes: 'Generada desde los productos bajo mínimo',
      items,
    })
    creadas.push({
      id: orden.id,
      number: orden.number,
      supplierId,
      lineas: items.length,
    })
  }

  return {
    creadas,
    // Se informan por nombre, no se cuentan: "3 productos quedaron afuera" no
    // dice cuales, y quien pidio la reposicion tiene que poder ir a buscarlos.
    sinProveedor,
  }
}

// ---------------------------------------------------------------------------
// Panel de inicio
// ---------------------------------------------------------------------------

export interface ResumenDeCompras {
  pendientes: number
  parciales: number
  borradores: number
  /** Solo con `products.cost.view`. Ausente si no. */
  totalPendiente?: Monto
}

/**
 * Cuantas compras esperan mercaderia. Para el panel de inicio.
 *
 * `parciales` es el numero accionable: son las ordenes de las que llego una
 * parte y hay que perseguir el resto. Una orden pedida y todavia sin entregar
 * es lo normal; una a medio entregar hace una semana, no.
 */
export async function resumenDeCompras(session: Session): Promise<ResumenDeCompras> {
  const base = { branchId: session.branchId }

  const [pendientes, parciales, borradores, suma] = await Promise.all([
    prisma.purchaseOrder.count({ where: { ...base, status: 'ORDERED' } }),
    prisma.purchaseOrder.count({ where: { ...base, status: 'PARTIALLY_RECEIVED' } }),
    prisma.purchaseOrder.count({ where: { ...base, status: 'DRAFT' } }),
    prisma.purchaseOrder.aggregate({
      where: { ...base, status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } },
      _sum: { expectedTotal: true },
    }),
  ])

  const resumen: ResumenDeCompras = { pendientes, parciales, borradores }
  if (!puedeVerCosto(session)) return resumen

  return { ...resumen, totalPendiente: aMonto(suma._sum.expectedTotal ?? dinero(0)) }
}

/** Ultimos cambios de costo que vinieron de una recepcion. Para la ficha. */
export async function costosDeRecepcion(receiptId: number) {
  const filas = await prisma.productCostHistory.findMany({
    where: { receiptId },
    select: {
      productId: true,
      previousCost: true,
      newCost: true,
      product: { select: { name: true } },
    },
    orderBy: { id: 'asc' },
  })

  return filas.map((f) => ({
    productId: f.productId,
    name: f.product.name,
    previousCost: aMontoCostoOpcional(f.previousCost),
    // Una recepcion nunca deja el costo en NULL --siempre llega con un costo--
    // pero la columna admite nulo desde la 3D y el tipo lo refleja.
    newCost: aMontoCostoOpcional(f.newCost),
  }))
}
