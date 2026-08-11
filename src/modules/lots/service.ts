/**
 * Lotes: la partida, su stock y su vencimiento.
 *
 * Este modulo NO escribe stock. Ni el del producto ni el del lote: para eso
 * llama a `applyStockMovement()` y a `applyLotAssignment()`, que viven en el
 * servicio de inventario y son la unica puerta. Hay una regla de ESLint que lo
 * impide desde aca.
 *
 * Ver docs/LOT_TRACKING_DESIGN.md y docs/LOT_EXPIRATION_POLICY.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit as escribirAuditoria } from '@/server/audit/audit'
import { conflict, forbidden, invalid, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { TextoCantidad } from '@/lib/cantidad'
import type { FechaLocal } from '@/lib/tiempo'
import {
  CERO_C,
  aTextoCantidad,
  cantidad as aCantidad,
  esPositivaCantidad,
  restarCantidades,
  sumaCantidadODefecto,
  sumarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import { hoyEnSucursal, sumarDias, zonaDeSucursal, hoyEn } from '@/server/tiempo'
import { applyLotAssignment, type TxClient } from '@/modules/inventory/service'
import { unidadDeVentaODefecto, type UnidadDeVenta } from '@/modules/products/units'
import { comoFechaDeBase, comoFechaLocal } from './fefo'
import {
  diasHastaVencer,
  estadoDeVencimiento,
  combinacionValida,
  normalizarCodigoDeLote,
  politicaDeLoteODefecto,
  politicaDeVencimientoODefecto,
  type EstadoDeVencimiento,
  type PoliticaDeLote,
  type PoliticaDeVencimiento,
} from './politicas'
import type {
  AtribuirStockInput,
  CambiarPoliticaInput,
  CrearLoteInput,
  EditarLoteInput,
  ListarLotesQuery,
} from './schemas'

export interface LoteListado {
  id: number
  code: string
  expirationDate: FechaLocal | null
  manufacturedAt: FechaLocal | null
  notes: string | null
  /** Negativo si ya vencio, null si no vence. */
  dias: number | null
  estado: EstadoDeVencimiento
  quantity: TextoCantidad
  product: { id: number; name: string; saleUnit: UnidadDeVenta }
  createdAt: Date
}

/** Producto con su politica, comprobado contra la sucursal de la sesion. */
async function productoDeLaSucursal(
  cliente: TxClient | typeof prisma,
  session: Session,
  productId: number,
) {
  const producto = await cliente.product.findFirst({
    where: { id: productId, branchId: session.branchId },
    select: {
      id: true,
      name: true,
      saleUnit: true,
      lotTracking: true,
      expirationTracking: true,
    },
  })
  // 404 y no 403: un 403 confirmaria que el producto existe en otra sucursal.
  if (!producto) throw notFound('Producto no encontrado')
  return producto
}

// ---------------------------------------------------------------------------
// Alta y edicion
// ---------------------------------------------------------------------------

export async function crearLote(session: Session, input: CrearLoteInput): Promise<LoteListado> {
  const producto = await productoDeLaSucursal(prisma, session, input.productId)
  const politicaLote = politicaDeLoteODefecto(producto.lotTracking)
  const politicaVenc = politicaDeVencimientoODefecto(producto.expirationTracking)

  if (politicaLote === 'NONE') {
    throw conflict(
      `"${producto.name}" no se sigue por lote. Activá el seguimiento antes de cargar partidas.`,
      { code: 'LOT_NOT_TRACKED' },
    )
  }

  // El vencimiento obligatorio se comprueba aca y no en el esquema de entrada
  // porque la politica vive en el producto: el mismo cuerpo es valido para uno
  // y no para otro.
  if (politicaVenc === 'REQUIRED' && (input.expirationDate ?? null) === null) {
    throw invalid(`"${producto.name}" exige fecha de vencimiento en cada partida.`)
  }
  if (politicaVenc === 'NONE' && (input.expirationDate ?? null) !== null) {
    throw invalid(`"${producto.name}" no controla vencimiento: la partida no puede llevar fecha.`)
  }

  const elaborado = input.manufacturedAt ?? null
  const vence = input.expirationDate ?? null
  if (elaborado !== null && vence !== null && elaborado > vence) {
    throw invalid('La fecha de elaboración no puede ser posterior a la de vencimiento')
  }

  const codeNormalized = normalizarCodigoDeLote(input.code)

  const repetido = await prisma.productLot.findUnique({
    where: { productId_codeNormalized: { productId: producto.id, codeNormalized } },
    select: { id: true },
  })
  if (repetido) {
    throw conflict(`"${producto.name}" ya tiene la partida ${input.code}.`, {
      code: 'CONFLICT',
    })
  }

  const lote = await prisma.$transaction(async (tx) => {
    const creado = await tx.productLot.create({
      data: {
        productId: producto.id,
        code: input.code.trim(),
        codeNormalized,
        expirationDate: vence === null ? null : comoFechaDeBase(vence),
        manufacturedAt: elaborado === null ? null : comoFechaDeBase(elaborado),
        notes: input.notes ?? null,
        createdById: session.userId,
      },
      select: { id: true, createdAt: true },
    })

    await escribirAuditoria(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'ProductLot',
      recordId: creado.id,
      action: 'create',
      after: {
        productId: producto.id,
        code: input.code.trim(),
        expirationDate: vence,
        manufacturedAt: elaborado,
      },
      origin: 'POST /api/lotes',
    })

    return creado
  })

  const hoy = await hoyEnSucursal(prisma, session.branchId)
  const dias = diasHastaVencer(hoy, vence)

  return {
    id: lote.id,
    code: input.code.trim(),
    expirationDate: vence,
    manufacturedAt: elaborado,
    notes: input.notes ?? null,
    dias,
    estado: estadoDeVencimiento(dias),
    quantity: '0.000',
    product: {
      id: producto.id,
      name: producto.name,
      saleUnit: unidadDeVentaODefecto(producto.saleUnit),
    },
    createdAt: lote.createdAt,
  }
}

/**
 * Corrige el vencimiento, la elaboracion o la nota. NUNCA el codigo.
 *
 * La asimetria es deliberada y esta explicada en la migracion: el codigo es la
 * IDENTIDAD de la partida y cambiarlo reescribiria el pasado. La fecha, en
 * cambio, es el error mas facil de cometer y el mas caro de dejar, porque decide
 * si la mercaderia se vende o se tira.
 */
export async function editarLote(
  session: Session,
  lotId: number,
  input: EditarLoteInput,
): Promise<LoteListado> {
  const lote = await loteDeLaSucursal(session, lotId)
  const politicaVenc = politicaDeVencimientoODefecto(lote.product.expirationTracking)

  const vence = input.expirationDate === undefined ? lote.expirationDate : input.expirationDate
  const elaborado = input.manufacturedAt === undefined ? lote.manufacturedAt : input.manufacturedAt

  if (politicaVenc === 'REQUIRED' && vence === null) {
    throw invalid(`"${lote.product.name}" exige fecha de vencimiento en cada partida.`)
  }
  if (politicaVenc === 'NONE' && vence !== null) {
    throw invalid(`"${lote.product.name}" no controla vencimiento.`)
  }
  if (elaborado !== null && vence !== null && elaborado > vence) {
    throw invalid('La fecha de elaboración no puede ser posterior a la de vencimiento')
  }

  await prisma.$transaction(async (tx) => {
    await tx.productLot.update({
      where: { id: lotId },
      data: {
        expirationDate: vence === null ? null : comoFechaDeBase(vence),
        manufacturedAt: elaborado === null ? null : comoFechaDeBase(elaborado),
        notes: input.notes === undefined ? lote.notes : (input.notes ?? null),
      },
    })

    await escribirAuditoria(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'ProductLot',
      recordId: lotId,
      action: 'update',
      before: { expirationDate: lote.expirationDate, manufacturedAt: lote.manufacturedAt },
      after: { expirationDate: vence, manufacturedAt: elaborado },
      origin: 'PATCH /api/lotes/:id',
    })
  })

  return obtenerLote(session, lotId)
}

async function loteDeLaSucursal(session: Session, lotId: number) {
  const lote = await prisma.productLot.findFirst({
    where: { id: lotId, product: { branchId: session.branchId } },
    select: {
      id: true,
      code: true,
      expirationDate: true,
      manufacturedAt: true,
      notes: true,
      createdAt: true,
      product: {
        select: {
          id: true,
          name: true,
          saleUnit: true,
          lotTracking: true,
          expirationTracking: true,
        },
      },
    },
  })
  if (!lote) throw notFound('El lote no existe')

  return {
    ...lote,
    expirationDate: comoFechaLocal(lote.expirationDate),
    manufacturedAt: comoFechaLocal(lote.manufacturedAt),
  }
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export interface DetalleDeLote extends LoteListado {
  /** Lo que hay de esta partida en CADA sucursal. */
  porSucursal: Array<{ branchId: number; branchName: string; quantity: TextoCantidad }>
  /** Cuanto entro y cuanto salio, para poder leer la fila sin el libro entero. */
  entradas: TextoCantidad
  salidas: TextoCantidad
  atribuido: TextoCantidad
}

export async function obtenerLote(session: Session, lotId: number): Promise<DetalleDeLote> {
  const lote = await loteDeLaSucursal(session, lotId)
  const hoy = await hoyEnSucursal(prisma, session.branchId)
  const dias = diasHastaVencer(hoy, lote.expirationDate)

  const [stocks, entradas, salidas, atribuciones] = await Promise.all([
    prisma.branchLotStock.findMany({
      where: { lotId },
      select: { quantity: true, branch: { select: { id: true, name: true } } },
      orderBy: { branchId: 'asc' },
    }),
    prisma.stockMovement.aggregate({
      where: { lotId, quantity: { gt: 0 } },
      _sum: { quantity: true },
    }),
    prisma.stockMovement.aggregate({
      where: { lotId, quantity: { lt: 0 } },
      _sum: { quantity: true },
    }),
    prisma.lotAssignment.aggregate({ where: { lotId }, _sum: { quantity: true } }),
  ])

  const enLaSucursal = stocks.find((s) => s.branch.id === session.branchId)

  return {
    id: lote.id,
    code: lote.code,
    expirationDate: lote.expirationDate,
    manufacturedAt: lote.manufacturedAt,
    notes: lote.notes,
    dias,
    estado: estadoDeVencimiento(dias),
    quantity: aTextoCantidad(enLaSucursal?.quantity ?? CERO_C),
    product: {
      id: lote.product.id,
      name: lote.product.name,
      saleUnit: unidadDeVentaODefecto(lote.product.saleUnit),
    },
    createdAt: lote.createdAt,
    porSucursal: stocks.map((s) => ({
      branchId: s.branch.id,
      branchName: s.branch.name,
      quantity: aTextoCantidad(s.quantity),
    })),
    entradas: aTextoCantidad(sumaCantidadODefecto(entradas._sum.quantity)),
    salidas: aTextoCantidad(sumaCantidadODefecto(salidas._sum.quantity)),
    atribuido: aTextoCantidad(sumaCantidadODefecto(atribuciones._sum.quantity)),
  }
}

/**
 * Los limites de fecha de cada estado, EN LA ZONA DE LA SUCURSAL.
 *
 * Se calculan en JavaScript y viajan a la consulta como fechas: filtrar con
 * `expirationDate < :hoy` usa el indice, mientras que calcular los dias del lado
 * de la base --`date_part` sobre cada fila-- obliga a recorrerlas todas.
 */
function bordes(hoy: FechaLocal) {
  return { hoy, sieteDias: sumarDias(hoy, 7), treintaDias: sumarDias(hoy, 30) }
}

function filtroDeEstado(estado: EstadoDeVencimiento, hoy: FechaLocal): Prisma.ProductLotWhereInput {
  const b = bordes(hoy)
  const f = (x: FechaLocal) => comoFechaDeBase(x)
  if (estado === 'SIN_FECHA') return { expirationDate: null }
  if (estado === 'VENCIDO') return { expirationDate: { lt: f(b.hoy) } }
  if (estado === 'VENCE_HOY') return { expirationDate: f(b.hoy) }
  if (estado === 'SIETE_DIAS') {
    return { expirationDate: { gt: f(b.hoy), lte: f(b.sieteDias) } }
  }
  if (estado === 'TREINTA_DIAS') {
    return { expirationDate: { gt: f(b.sieteDias), lte: f(b.treintaDias) } }
  }
  return { expirationDate: { gt: f(b.treintaDias) } }
}

/**
 * El listado de lotes de la sucursal, paginado.
 *
 * Por omision SIN los agotados: un lote en cero no es una alerta ni una tarea,
 * es historia. Con dos años de operacion son la mayoria, y dejarlos por omision
 * haria que la pantalla que existe para mirar vencimientos se llene de partidas
 * que ya no estan.
 */
export async function listarLotes(
  session: Session,
  query: ListarLotesQuery,
): Promise<Paginated<LoteListado>> {
  const hoy = await hoyEnSucursal(prisma, session.branchId)

  const where: Prisma.ProductLotWhereInput = {
    product: { branchId: session.branchId },
    ...(query.productId === undefined ? {} : { productId: query.productId }),
    ...(query.estado === undefined ? {} : filtroDeEstado(query.estado, hoy)),
    ...(query.q
      ? {
          OR: [
            { codeNormalized: { contains: normalizarCodigoDeLote(query.q) } },
            {
              product: {
                branchId: session.branchId,
                name: { contains: query.q, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {}),
    ...(query.agotados === true
      ? {}
      : { stocks: { some: { branchId: session.branchId, quantity: { gt: 0 } } } }),
  }

  const [total, lotes] = await Promise.all([
    prisma.productLot.count({ where }),
    prisma.productLot.findMany({
      where,
      select: {
        id: true,
        code: true,
        expirationDate: true,
        manufacturedAt: true,
        notes: true,
        createdAt: true,
        product: { select: { id: true, name: true, saleUnit: true } },
        stocks: { where: { branchId: session.branchId }, select: { quantity: true }, take: 1 },
      },
      // El mismo criterio FEFO: lo que vence antes, primero. Es el orden en que
      // hay que mirar la lista, no una casualidad.
      orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = lotes.map((l): LoteListado => {
    const vence = comoFechaLocal(l.expirationDate)
    const dias = diasHastaVencer(hoy, vence)
    return {
      id: l.id,
      code: l.code,
      expirationDate: vence,
      manufacturedAt: comoFechaLocal(l.manufacturedAt),
      notes: l.notes,
      dias,
      estado: estadoDeVencimiento(dias),
      quantity: aTextoCantidad(l.stocks[0]?.quantity ?? CERO_C),
      product: {
        id: l.product.id,
        name: l.product.name,
        saleUnit: unidadDeVentaODefecto(l.product.saleUnit),
      },
      createdAt: l.createdAt,
    }
  })

  return paginado(data, total, query)
}

export interface StockPorLote {
  productId: number
  productName: string
  saleUnit: UnidadDeVenta
  lotTracking: PoliticaDeLote
  expirationTracking: PoliticaDeVencimiento
  /** `BranchStock.quantity`: la verdad agregada, que no cambia en esta fase. */
  total: TextoCantidad
  /** Lo que los lotes explican. */
  enLotes: TextoCantidad
  /**
   * Lo que NO pertenece a ninguna partida. DERIVADO, no una columna: dos cifras
   * guardadas empiezan a diferir el dia que alguien se olvida de una.
   */
  sinAsignar: TextoCantidad
  vendible: TextoCantidad
  vencido: TextoCantidad
  lotes: Array<{
    id: number
    code: string
    expirationDate: FechaLocal | null
    quantity: TextoCantidad
    dias: number | null
    estado: EstadoDeVencimiento
  }>
}

/**
 * El desglose por lote de UN producto en la sucursal. Lo que muestra su ficha.
 *
 * `sinAsignar` aparece con su nombre y sin disfraz: no es un lote, y llamarlo
 * `LEGACY-2026` seria escribir un dato falso con formato de dato real.
 */
export async function stockPorLote(session: Session, productId: number): Promise<StockPorLote> {
  const producto = await productoDeLaSucursal(prisma, session, productId)
  const hoy = await hoyEnSucursal(prisma, session.branchId)

  const [stock, lotes] = await Promise.all([
    prisma.branchStock.findUnique({
      where: { branchId_productId: { branchId: session.branchId, productId } },
      select: { quantity: true },
    }),
    prisma.productLot.findMany({
      where: { productId },
      select: {
        id: true,
        code: true,
        expirationDate: true,
        stocks: { where: { branchId: session.branchId }, select: { quantity: true }, take: 1 },
      },
      orderBy: [{ expirationDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
    }),
  ])

  const conStock = lotes
    .map((l) => {
      const vence = comoFechaLocal(l.expirationDate)
      const dias = diasHastaVencer(hoy, vence)
      return {
        id: l.id,
        code: l.code,
        expirationDate: vence,
        cantidad: l.stocks[0]?.quantity ?? CERO_C,
        dias,
        estado: estadoDeVencimiento(dias),
      }
    })
    .filter((l) => esPositivaCantidad(l.cantidad))

  const total = stock?.quantity ?? CERO_C
  const enLotes = conStock.reduce((s, l) => sumarCantidades(s, l.cantidad), CERO_C)
  const vencido = conStock
    .filter((l) => l.estado === 'VENCIDO')
    .reduce((s, l) => sumarCantidades(s, l.cantidad), CERO_C)

  return {
    productId,
    productName: producto.name,
    saleUnit: unidadDeVentaODefecto(producto.saleUnit),
    lotTracking: politicaDeLoteODefecto(producto.lotTracking),
    expirationTracking: politicaDeVencimientoODefecto(producto.expirationTracking),
    total: aTextoCantidad(total),
    enLotes: aTextoCantidad(enLotes),
    sinAsignar: aTextoCantidad(restarCantidades(total, enLotes)),
    // Lo vendible incluye lo que no esta en lotes: en un producto OPTIONAL, el
    // stock sin asignar se vende igual. Lo unico que nunca es vendible es lo
    // vencido.
    vendible: aTextoCantidad(restarCantidades(total, vencido)),
    vencido: aTextoCantidad(vencido),
    lotes: conStock.map((l) => ({
      id: l.id,
      code: l.code,
      expirationDate: l.expirationDate,
      quantity: aTextoCantidad(l.cantidad),
      dias: l.dias,
      estado: l.estado,
    })),
  }
}

// ---------------------------------------------------------------------------
// Atribucion e inicializacion
// ---------------------------------------------------------------------------

export interface ResultadoDeAtribucion {
  productId: number
  total: TextoCantidad
  enLotes: TextoCantidad
  sinAsignar: TextoCantidad
  lineas: Array<{ lotId: number; code: string; quantity: TextoCantidad }>
}

/**
 * Atribuye stock EXISTENTE a lotes. NO mueve stock.
 *
 * Es el paso que hace posible activar `REQUIRED` sobre un producto que ya tiene
 * unidades. Cada linea pasa por `applyLotAssignment()`, que comprueba el tope
 * bajo bloqueo; el orden por `lotId` no es cosmetico, es lo que impide que dos
 * atribuciones simultaneas se traben entre si.
 */
export async function atribuirStock(
  session: Session,
  input: AtribuirStockInput,
): Promise<ResultadoDeAtribucion> {
  const producto = await productoDeLaSucursal(prisma, session, input.productId)
  const saleUnit = unidadDeVentaODefecto(producto.saleUnit)

  const repetidos = input.lineas.map((l) => l.lotId)
  if (new Set(repetidos).size !== repetidos.length) {
    throw invalid('Un lote no puede aparecer dos veces en la misma atribución')
  }

  return prisma.$transaction(async (tx) => {
    const lotes = await tx.productLot.findMany({
      where: { id: { in: repetidos }, productId: producto.id },
      select: { id: true, code: true },
    })
    if (lotes.length !== repetidos.length) {
      throw invalid('Alguna de las partidas no es de este producto')
    }
    const porId = new Map(lotes.map((l) => [l.id, l.code]))

    const lineas: ResultadoDeAtribucion['lineas'] = []
    // Por lotId ascendente: el orden de los bloqueos es parte del contrato.
    for (const linea of [...input.lineas].sort((a, b) => a.lotId - b.lotId)) {
      await applyLotAssignment(tx, {
        branchId: session.branchId,
        productId: producto.id,
        lotId: linea.lotId,
        quantity: aCantidad(linea.quantity),
        saleUnit,
        userId: session.userId,
        reason: input.reason,
        audit: { origin: 'POST /api/lotes/atribuir' },
      })
      lineas.push({
        lotId: linea.lotId,
        code: porId.get(linea.lotId) ?? '',
        quantity: linea.quantity,
      })
    }

    const cuentas = await cuentaDeAtribucion(tx, session.branchId, producto.id)
    return {
      productId: producto.id,
      total: aTextoCantidad(cuentas.total),
      enLotes: aTextoCantidad(cuentas.enLotes),
      sinAsignar: aTextoCantidad(restarCantidades(cuentas.total, cuentas.enLotes)),
      lineas,
    }
  })
}

/** El stock del producto y lo que los lotes explican, en una sola consulta. */
async function cuentaDeAtribucion(
  tx: TxClient,
  branchId: number,
  productId: number,
): Promise<{ total: Cantidad; enLotes: Cantidad }> {
  const filas = await tx.$queryRaw<Array<{ total: Cantidad; enLotes: Cantidad }>>`
    SELECT COALESCE(bs."quantity", 0)::numeric(14,3)       AS "total",
           COALESCE(sum(bls."quantity"), 0)::numeric(14,3) AS "enLotes"
      FROM "Product" p
      LEFT JOIN "BranchStock" bs
        ON bs."productId" = p."id" AND bs."branchId" = ${branchId}
      LEFT JOIN "ProductLot" l ON l."productId" = p."id"
      LEFT JOIN "BranchLotStock" bls
        ON bls."lotId" = l."id" AND bls."branchId" = ${branchId}
     WHERE p."id" = ${productId}
     GROUP BY bs."quantity"
  `
  return filas[0] ?? { total: CERO_C, enLotes: CERO_C }
}

export interface PoliticaCambiada {
  productId: number
  lotTracking: PoliticaDeLote
  expirationTracking: PoliticaDeVencimiento
  sinAsignar: TextoCantidad
}

/**
 * Cambia la politica de rastreo de un producto.
 *
 * LA REGLA: no se puede exigir lotes dejando stock sin explicar. Se comprueba
 * DENTRO de la transaccion y bajo el bloqueo de la fila de stock, no en la
 * pantalla: entre que el navegador muestra "ya cierra" y el usuario aprieta el
 * boton puede haber entrado una venta.
 *
 * Bajar de REQUIRED no borra nada: los lotes siguen, el stock por lote sigue y
 * el historial no se toca. Lo unico que cambia es que desde ese momento se
 * aceptan movimientos sin lote. Queda auditado, porque es la decision que hay
 * que poder explicar.
 */
export async function cambiarPolitica(
  session: Session,
  productId: number,
  input: CambiarPoliticaInput,
): Promise<PoliticaCambiada> {
  if (!combinacionValida(input.lotTracking, input.expirationTracking)) {
    throw invalid(
      'No se puede exigir vencimiento sin seguir por lote: la fecha vive en la partida.',
    )
  }

  return prisma.$transaction(async (tx) => {
    const producto = await productoDeLaSucursal(tx, session, productId)

    // 1. EL BLOQUEO, Y NADA MAS.
    await tx.$queryRaw`
      SELECT bs."id" FROM "BranchStock" bs
       WHERE bs."branchId" = ${session.branchId} AND bs."productId" = ${productId}
       FOR UPDATE
    `
    // 2. RECIEN AHORA las sumas, en su propia sentencia.
    const cuentas = await cuentaDeAtribucion(tx, session.branchId, productId)
    const sinAsignar = restarCantidades(cuentas.total, cuentas.enLotes)

    if (input.lotTracking === 'REQUIRED' && esPositivaCantidad(sinAsignar)) {
      throw conflict(
        `"${producto.name}" tiene ${aTextoCantidad(sinAsignar)} sin atribuir a ninguna ` +
          'partida. Asigná ese stock a lotes antes de exigirlos: activar la política ' +
          'ahora dejaría unidades que el sistema no puede explicar.',
        { code: 'LOT_TRACKING_NEEDS_ASSIGNMENT' },
      )
    }

    if (input.expirationTracking === 'REQUIRED') {
      const sinFecha = await tx.productLot.count({
        where: { productId, expirationDate: null },
      })
      if (sinFecha > 0) {
        throw conflict(
          `"${producto.name}" tiene ${String(sinFecha)} partida(s) sin fecha de ` +
            'vencimiento. Cargales la fecha antes de exigirla.',
          { code: 'CONFLICT' },
        )
      }
    }

    await tx.product.update({
      where: { id: productId },
      data: {
        lotTracking: input.lotTracking,
        expirationTracking: input.expirationTracking,
      },
    })

    await escribirAuditoria(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'Product',
      recordId: productId,
      action: 'update',
      before: {
        lotTracking: producto.lotTracking,
        expirationTracking: producto.expirationTracking,
      },
      after: {
        lotTracking: input.lotTracking,
        expirationTracking: input.expirationTracking,
        sinAsignar: aTextoCantidad(sinAsignar),
      },
      origin: 'PUT /api/productos/:id/lotes/politica',
    })

    return {
      productId,
      lotTracking: input.lotTracking,
      expirationTracking: input.expirationTracking,
      sinAsignar: aTextoCantidad(sinAsignar),
    }
  })
}

// ---------------------------------------------------------------------------
// Tablero
// ---------------------------------------------------------------------------

export interface ResumenDeVencimientos {
  /** Cuantas PARTIDAS, no cuantas unidades. Son dos preguntas distintas. */
  lotesVencidos: number
  unidadesVencidas: TextoCantidad
  lotesEnSieteDias: number
  unidadesEnSieteDias: TextoCantidad
  lotesEnTreintaDias: number
  unidadesEnTreintaDias: TextoCantidad
  /** Productos distintos alcanzados por cualquiera de los tres tramos. */
  productosAfectados: number
}

interface FilaResumen {
  tramo: string
  lotes: bigint
  unidades: Cantidad
  productos: bigint
}

/**
 * El tablero de vencimientos de la sucursal.
 *
 * UNA consulta con tres tramos, agregada del lado de PostgreSQL. Traer los lotes
 * para contarlos en JavaScript seria exactamente lo que este proyecto no hace:
 * con 10.000 partidas son 10.000 filas por cada vez que alguien abre el panel.
 *
 * Solo cuenta lo que TIENE UNIDADES: un lote vencido con cero no es una alerta,
 * es historia.
 */
export async function resumenDeVencimientos(session: Session): Promise<ResumenDeVencimientos> {
  const zona = await zonaDeSucursal(prisma, session.branchId)
  const hoy = hoyEn(zona)
  const b = bordes(hoy)

  const filas = await prisma.$queryRaw<FilaResumen[]>`
    SELECT CASE
             WHEN l."expirationDate" <  ${b.hoy}::date THEN 'vencido'
             WHEN l."expirationDate" <= ${b.sieteDias}::date THEN 'siete'
             ELSE 'treinta'
           END                                     AS "tramo",
           count(*)::bigint                        AS "lotes",
           sum(bls."quantity")::numeric(14,3)      AS "unidades",
           count(DISTINCT l."productId")::bigint   AS "productos"
      FROM "BranchLotStock" bls
      JOIN "ProductLot" l ON l."id" = bls."lotId"
      JOIN "Product" p    ON p."id" = l."productId"
     WHERE bls."branchId" = ${session.branchId}
       AND p."branchId" = ${session.branchId}
       AND bls."quantity" > 0
       AND l."expirationDate" IS NOT NULL
       AND l."expirationDate" <= ${b.treintaDias}::date
     GROUP BY 1
  `

  const afectados = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(DISTINCT l."productId")::bigint AS n
      FROM "BranchLotStock" bls
      JOIN "ProductLot" l ON l."id" = bls."lotId"
     WHERE bls."branchId" = ${session.branchId}
       AND bls."quantity" > 0
       AND l."expirationDate" IS NOT NULL
       AND l."expirationDate" <= ${b.treintaDias}::date
  `

  const de = (tramo: string) => filas.find((f) => f.tramo === tramo)

  return {
    lotesVencidos: Number(de('vencido')?.lotes ?? 0),
    unidadesVencidas: aTextoCantidad(sumaCantidadODefecto(de('vencido')?.unidades)),
    lotesEnSieteDias: Number(de('siete')?.lotes ?? 0),
    unidadesEnSieteDias: aTextoCantidad(sumaCantidadODefecto(de('siete')?.unidades)),
    lotesEnTreintaDias: Number(de('treinta')?.lotes ?? 0),
    unidadesEnTreintaDias: aTextoCantidad(sumaCantidadODefecto(de('treinta')?.unidades)),
    productosAfectados: Number(afectados[0]?.n ?? 0),
  }
}

/** Exigir el permiso, con el mensaje del dominio. */
export function exigirPermisoDeLotes(
  session: Session,
  permiso: 'lots.manage' | 'lots.adjust',
): void {
  if (!session.permissions.has(permiso)) {
    throw forbidden(
      permiso === 'lots.manage'
        ? 'No tenés permiso para administrar lotes'
        : 'No tenés permiso para elegir el lote a mano',
    )
  }
}
