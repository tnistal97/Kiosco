/**
 * Inventario fisico: contar el deposito y corregir lo que no coincide.
 *
 * TRES reglas atraviesan el modulo, y las tres son el punto:
 *
 *   1. Lo ESPERADO se lee en el momento de contar, no al empezar. Si la sesion
 *      empezo con 10, se vendieron 2 y el operario conto 8, la diferencia es
 *      CERO. Sin esto habria que cerrar el local para inventariar.
 *   2. Se aplica el DELTA, nunca el numero contado. Si despues de contar 7 se
 *      vendio una unidad mas, el stock esta en 6 y hay que dejarlo en 6:
 *      escribir "stock = 7" borraria esa venta.
 *   3. Una sesion APLICADA es inmutable, con disparador en la base.
 *
 * El stock no se toca desde aca: se llama a `applyStockMovement`, que es la
 * unica puerta.
 *
 * Ver docs/PHYSICAL_INVENTORY.md y docs/INVENTORY_COUNT_CONCURRENCY.md.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { audit as escribirAuditoria } from '@/server/audit/audit'
import { conflict, invalid, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { TextoCantidad } from '@/lib/cantidad'
import {
  CERO_C,
  aTextoCantidad,
  absolutoCantidad,
  cantidad as aCantidad,
  esCeroCantidad,
  restarCantidades,
  sumaCantidadODefecto,
  type Cantidad,
} from '@/server/cantidad'
import { applyStockMovement, type TxClient } from '@/modules/inventory/service'
import { unidadDeVentaODefecto, type UnidadDeVenta } from '@/modules/products/units'
import { politicaDeLoteODefecto } from '@/modules/lots/politicas'
import { comoFechaLocal } from '@/modules/lots/fefo'
import type { FechaLocal } from '@/lib/tiempo'
import {
  etiquetaDeAlcance,
  etiquetaDeEstado,
  etiquetaDeLinea,
  sePuedeAplicar,
  sePuedeCancelar,
  sePuedeContar,
  sePuedeRevisar,
  type Alcance,
  type EstadoDeInventario,
} from './estados'
import type {
  CancelarInventarioInput,
  CargarConteoInput,
  CrearInventarioInput,
  LineasQuery,
  ListarInventariosQuery,
  ResolverLineaInput,
} from './schemas'

// ---------------------------------------------------------------------------
// Numeracion
// ---------------------------------------------------------------------------

/**
 * `IF-00000012`, desde una SECUENCIA.
 *
 * Por lo mismo que "OC-", "RC-", "PP-", "CB-" y "DV-": dos sesiones creadas en
 * el mismo segundo leerian el mismo `count() + 1`.
 */
async function siguienteNumero(): Promise<string> {
  const filas = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT nextval('"InventoryCountSession_numero_seq"') AS n
  `
  const n = filas[0]?.n
  if (n === undefined) throw new Error('No se pudo obtener el numero de inventario')
  return `IF-${String(n).padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------

export interface InventarioListado {
  id: number
  number: string
  status: EstadoDeInventario
  statusLabel: string
  scope: Alcance
  scopeLabel: string
  categoryName: string | null
  blindCount: boolean
  recountThreshold: TextoCantidad | null
  notes: string | null
  startedAt: Date
  startedByName: string
  completedAt: Date | null
  appliedAt: Date | null
  /** Cuantas lineas y en que estado. Es lo que la pantalla necesita para decidir. */
  lineas: {
    total: number
    contadas: number
    pendientes: number
    sinResolver: number
    conDiferencia: number
  }
  /**
   * Lineas que OTRO inventario ya corrigio. Solo en el detalle: en el listado
   * seria una consulta por fila y ahi no se decide nada.
   *
   * Va en la respuesta y no solo en el error de aplicar porque quien revisa
   * necesita verlo ANTES de apretar el boton, no como motivo del rechazo.
   */
  conflictos?: LineaEnConflicto[]
}

/**
 * Arma la sesion y GENERA SUS LINEAS.
 *
 * Las lineas se generan con UN INSERT ... SELECT y no con un bucle: un
 * inventario de todo el catalogo son miles de filas, y traerlas a JavaScript
 * para volver a mandarlas de a una convertiria "crear el inventario" en una
 * operacion de minutos.
 *
 * Se genera una linea por (producto, lote con unidades) MAS una linea por
 * producto con `lotId` nulo. Esa ultima no es decorativa: es donde vive el stock
 * no atribuido de los productos `OPTIONAL`, es la linea unica de los `NONE`, y
 * es donde van a parar las unidades que aparecen sin partida conocida --el caso
 * `UNRESOLVED` del objetivo 31--.
 *
 * Entran los productos ACTIVOS: contar un producto dado de baja es contar algo
 * que ya no se repone.
 */
export async function crearInventario(
  session: Session,
  input: CrearInventarioInput,
): Promise<InventarioListado> {
  if (input.categoryId !== undefined) {
    const categoria = await prisma.category.findUnique({
      where: { id: input.categoryId },
      select: { id: true },
    })
    if (!categoria) throw notFound('La categoría no existe')
  }

  const number = await siguienteNumero()
  const productIds = input.productIds ?? []

  const creada = await prisma.$transaction(async (tx) => {
    const sesion = await tx.inventoryCountSession.create({
      data: {
        number,
        branchId: session.branchId,
        status: 'DRAFT',
        scope: input.scope,
        categoryId: input.categoryId ?? null,
        blindCount: input.blindCount,
        recountThreshold:
          input.recountThreshold === undefined ? null : aCantidad(input.recountThreshold),
        notes: input.notes ?? null,
        startedById: session.userId,
      },
      select: { id: true },
    })

    // El filtro de alcance, una sola vez, para las dos mitades del UNION.
    const alcance =
      input.scope === 'CATEGORY'
        ? Prisma.sql`AND p."categoryId" = ${input.categoryId ?? 0}`
        : input.scope === 'SELECTION'
          ? Prisma.sql`AND p."id" = ANY(${productIds}::int[])`
          : Prisma.sql``

    await tx.$executeRaw`
      INSERT INTO "InventoryCountLine"
        ("sessionId", "productId", "lotId", "snapshotQuantity", "status")
      SELECT ${sesion.id}, l."productId", l."id", bls."quantity", 'PENDING'
        FROM "BranchLotStock" bls
        JOIN "ProductLot" l ON l."id" = bls."lotId"
        JOIN "Product" p    ON p."id" = l."productId"
       WHERE bls."branchId" = ${session.branchId}
         AND p."branchId" = ${session.branchId}
         AND p."isActive" = true
         AND bls."quantity" > 0
         ${alcance}
      UNION ALL
      SELECT ${sesion.id}, p."id", NULL,
             GREATEST(COALESCE(bs."quantity", 0) - COALESCE(sum(bls."quantity"), 0), 0),
             'PENDING'
        FROM "Product" p
        LEFT JOIN "BranchStock" bs
          ON bs."productId" = p."id" AND bs."branchId" = ${session.branchId}
        LEFT JOIN "ProductLot" l ON l."productId" = p."id"
        LEFT JOIN "BranchLotStock" bls
          ON bls."lotId" = l."id" AND bls."branchId" = ${session.branchId}
       WHERE p."branchId" = ${session.branchId}
         AND p."isActive" = true
         ${alcance}
       GROUP BY p."id", bs."quantity"
    `

    await escribirAuditoria(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'InventoryCountSession',
      recordId: sesion.id,
      action: 'create',
      after: {
        number,
        scope: input.scope,
        categoryId: input.categoryId ?? null,
        blindCount: input.blindCount,
        recountThreshold: input.recountThreshold ?? null,
      },
      origin: 'POST /api/inventarios',
    })

    return sesion
  })

  return obtenerInventario(session, creada.id)
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

async function sesionDeLaSucursal(cliente: TxClient | typeof prisma, session: Session, id: number) {
  const sesion = await cliente.inventoryCountSession.findFirst({
    where: { id, branchId: session.branchId },
    select: {
      id: true,
      number: true,
      status: true,
      scope: true,
      categoryId: true,
      blindCount: true,
      recountThreshold: true,
      notes: true,
      startedAt: true,
      completedAt: true,
      appliedAt: true,
      startedBy: { select: { name: true } },
      category: { select: { name: true } },
    },
  })
  // Mismo trato que "no existe": no se confirma que exista en otra sucursal.
  if (!sesion) throw notFound('El inventario no existe')
  return sesion
}

export async function obtenerInventario(session: Session, id: number): Promise<InventarioListado> {
  const sesion = await sesionDeLaSucursal(prisma, session, id)
  const resumen = await conResumen(sesion)

  // Los conflictos se calculan SOLO en el detalle. En el listado serian una
  // consulta mas por fila, y ahi no se decide nada: la decision --aplicar o
  // volver a contar-- se toma con la sesion abierta delante.
  return { ...resumen, conflictos: await conflictosDeInventario(prisma, session, id) }
}

// ---------------------------------------------------------------------------
// Dos inventarios sobre el mismo producto
// ---------------------------------------------------------------------------

/** Una linea cuya diferencia ya la corrigio OTRA sesion. */
export interface LineaEnConflicto {
  lineId: number
  productId: number
  productName: string
  lotId: number | null
  lotCode: string | null
  /** El inventario ajeno que ya corrigio esta misma partida. */
  sessionNumber: string
  correctedAt: Date
}

/**
 * Las lineas de esta sesion que OTRO inventario ya corrigio.
 *
 * Dos sesiones sobre el mismo producto pueden existir --nada lo impide, y
 * prohibirlo obligaria a cerrar el deposito para contar una categoria--. Lo que
 * no puede pasar es que las dos apliquen la MISMA discrepancia fisica: contar
 * 7 donde habia 8 dos veces daria dos correcciones de -1 y dejaria el stock en
 * 6 cuando en el estante hay 7.
 *
 * DOS decisiones de diseno, las dos deliberadas:
 *
 * 1. EL CORTE ES `countedAt`, NO EL SNAPSHOT.
 *
 *    Una correccion ajena APLICADA ANTES de que esta sesion contara ya esta
 *    dentro de lo que esta sesion vio: `expectedAtCount` se lee en el momento
 *    de contar, asi que la diferencia calculada ya la descuenta. Cortar por el
 *    snapshot marcaria como conflicto un caso que no lo es, y obligaria a
 *    recontar sin motivo. Ver docs/INVENTORY_COUNT_CONCURRENCY.md.
 *
 * 2. SE COMPARA PRODUCTO **Y LOTE**, no solo producto.
 *
 *    Corregir la partida A no cambia el stock de la partida B, asi que una
 *    sesion que conto B sigue teniendo razon. Comparar solo por producto
 *    bloquearia esa sesion sin que hubiera doble correccion. `IS NOT DISTINCT
 *    FROM` porque el lado sin partida es NULL, y `NULL = NULL` no es cierto.
 *
 * Se devuelven TODAS, no la primera: quien revisa necesita saber cuantas
 * lineas hay que volver a contar antes de decidir.
 */
export async function conflictosDeInventario(
  cliente: TxClient | typeof prisma,
  session: Session,
  id: number,
): Promise<LineaEnConflicto[]> {
  return cliente.$queryRaw<LineaEnConflicto[]>`
    SELECT DISTINCT ON (cl."id")
           cl."id"        AS "lineId",
           cl."productId" AS "productId",
           p."name"       AS "productName",
           cl."lotId"     AS "lotId",
           l."code"       AS "lotCode",
           s."number"     AS "sessionNumber",
           sm."createdAt" AS "correctedAt"
      FROM "InventoryCountLine" cl
      JOIN "Product" p ON p."id" = cl."productId"
      LEFT JOIN "ProductLot" l ON l."id" = cl."lotId"
      JOIN "StockMovement" sm
        ON sm."productId" = cl."productId"
       AND sm."lotId" IS NOT DISTINCT FROM cl."lotId"
       AND sm."branchId" = ${session.branchId}
       AND sm."type" = 'INVENTORY_COUNT'
       AND sm."createdAt" > cl."countedAt"
       AND sm."referenceType" = 'InventoryCountSession'
       AND sm."referenceId" <> ${id}
      JOIN "InventoryCountSession" s ON s."id" = sm."referenceId"
     WHERE cl."sessionId" = ${id}
       AND cl."variance" <> 0
       AND cl."countedAt" IS NOT NULL
     ORDER BY cl."id", sm."createdAt"
  `
}

async function conResumen(sesion: {
  id: number
  number: string
  status: string
  scope: string
  blindCount: boolean
  recountThreshold: Cantidad | null
  notes: string | null
  startedAt: Date
  completedAt: Date | null
  appliedAt: Date | null
  startedBy: { name: string }
  category: { name: string } | null
}): Promise<InventarioListado> {
  const [porEstado, conDiferencia] = await Promise.all([
    prisma.inventoryCountLine.groupBy({
      by: ['status'],
      where: { sessionId: sesion.id },
      _count: { _all: true },
    }),
    prisma.inventoryCountLine.count({
      where: { sessionId: sesion.id, variance: { not: 0 } },
    }),
  ])

  const de = (estado: string) => porEstado.find((p) => p.status === estado)?._count._all ?? 0
  const total = porEstado.reduce((s, p) => s + p._count._all, 0)

  return {
    id: sesion.id,
    number: sesion.number,
    status: sesion.status as EstadoDeInventario,
    statusLabel: etiquetaDeEstado(sesion.status),
    scope: sesion.scope as Alcance,
    scopeLabel: etiquetaDeAlcance(sesion.scope),
    categoryName: sesion.category?.name ?? null,
    blindCount: sesion.blindCount,
    recountThreshold:
      sesion.recountThreshold === null ? null : aTextoCantidad(sesion.recountThreshold),
    notes: sesion.notes,
    startedAt: sesion.startedAt,
    startedByName: sesion.startedBy.name,
    completedAt: sesion.completedAt,
    appliedAt: sesion.appliedAt,
    lineas: {
      total,
      contadas: de('COUNTED'),
      pendientes: de('PENDING') + de('RECOUNT'),
      sinResolver: de('UNRESOLVED'),
      conDiferencia,
    },
  }
}

export async function listarInventarios(
  session: Session,
  query: ListarInventariosQuery,
): Promise<Paginated<InventarioListado>> {
  const where: Prisma.InventoryCountSessionWhereInput = {
    branchId: session.branchId,
    ...(query.estado === undefined ? {} : { status: query.estado }),
  }

  const [total, sesiones] = await Promise.all([
    prisma.inventoryCountSession.count({ where }),
    prisma.inventoryCountSession.findMany({
      where,
      select: {
        id: true,
        number: true,
        status: true,
        scope: true,
        blindCount: true,
        recountThreshold: true,
        notes: true,
        startedAt: true,
        completedAt: true,
        appliedAt: true,
        startedBy: { select: { name: true } },
        category: { select: { name: true } },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = await Promise.all(sesiones.map(conResumen))
  return paginado(data, total, query)
}

export interface LineaListada {
  id: number
  productId: number
  productName: string
  saleUnit: UnidadDeVenta
  lotId: number | null
  lotCode: string | null
  expirationDate: FechaLocal | null
  status: string
  statusLabel: string
  snapshotQuantity: TextoCantidad
  countedQuantity: TextoCantidad | null
  firstCountQuantity: TextoCantidad | null
  /**
   * Lo que el sistema esperaba EN EL MOMENTO de contar. `null` en conteo a
   * ciegas mientras la sesion no cerro: mostrarlo antes de contar es
   * exactamente lo que el conteo a ciegas evita.
   */
  expectedAtCount: TextoCantidad | null
  variance: TextoCantidad | null
  countedAt: Date | null
  notes: string | null
}

/**
 * Las lineas de una sesion, paginadas y filtrables.
 *
 * `expectedAtCount` y `variance` se OCULTAN mientras la sesion esta en conteo y
 * es a ciegas. No es cosmetica: es la funcionalidad. Se devuelven en cuanto la
 * sesion pasa a revision, que es cuando hay que mirarlas.
 */
export async function lineasDeInventario(
  session: Session,
  id: number,
  query: LineasQuery,
): Promise<Paginated<LineaListada>> {
  const sesion = await sesionDeLaSucursal(prisma, session, id)
  const ocultar = sesion.blindCount && sePuedeContar(sesion.status)

  const where: Prisma.InventoryCountLineWhereInput = {
    sessionId: id,
    ...(query.estado === undefined ? {} : { status: query.estado }),
    ...(query.diferencia === 'con' ? { variance: { not: 0 } } : {}),
    ...(query.diferencia === 'positivas' ? { variance: { gt: 0 } } : {}),
    ...(query.diferencia === 'negativas' ? { variance: { lt: 0 } } : {}),
    ...(query.q ? { product: { name: { contains: query.q, mode: 'insensitive' as const } } } : {}),
  }

  const [total, lineas] = await Promise.all([
    prisma.inventoryCountLine.count({ where }),
    prisma.inventoryCountLine.findMany({
      where,
      select: {
        id: true,
        productId: true,
        lotId: true,
        status: true,
        snapshotQuantity: true,
        countedQuantity: true,
        firstCountQuantity: true,
        expectedAtCount: true,
        variance: true,
        countedAt: true,
        notes: true,
        product: { select: { name: true, saleUnit: true } },
        lot: { select: { code: true, expirationDate: true } },
      },
      orderBy: [{ productId: 'asc' }, { lotId: { sort: 'asc', nulls: 'first' } }],
      ...toSkipTake(query),
    }),
  ])

  const data = lineas.map((l): LineaListada => ({
    id: l.id,
    productId: l.productId,
    productName: l.product.name,
    saleUnit: unidadDeVentaODefecto(l.product.saleUnit),
    lotId: l.lotId,
    lotCode: l.lot?.code ?? null,
    expirationDate: comoFechaLocal(l.lot?.expirationDate ?? null),
    status: l.status,
    statusLabel: etiquetaDeLinea(l.status),
    snapshotQuantity: ocultar ? '0.000' : aTextoCantidad(l.snapshotQuantity),
    countedQuantity: l.countedQuantity === null ? null : aTextoCantidad(l.countedQuantity),
    firstCountQuantity: l.firstCountQuantity === null ? null : aTextoCantidad(l.firstCountQuantity),
    expectedAtCount:
      ocultar || l.expectedAtCount === null ? null : aTextoCantidad(l.expectedAtCount),
    variance: ocultar || l.variance === null ? null : aTextoCantidad(l.variance),
    countedAt: l.countedAt,
    notes: l.notes,
  }))

  return paginado(data, total, query)
}

// ---------------------------------------------------------------------------
// Contar
// ---------------------------------------------------------------------------

export interface ResultadoDeConteo {
  lineas: Array<{
    id: number
    status: string
    /** Solo cuando la politica de la sesion permite verlo. */
    expectedAtCount: TextoCantidad | null
    variance: TextoCantidad | null
  }>
}

/**
 * Carga conteos. La operacion del operario.
 *
 * LO ESPERADO SE LEE ACA, no al crear la sesion, y es lo que permite contar sin
 * cerrar el local. Se lee el stock ACTUAL --del producto o del lote-- dentro de
 * la misma transaccion que escribe la linea, y esa lectura ES la suma de los
 * movimientos hasta este instante: por la invariante de la Fase 3A, el saldo
 * materializado es exactamente `snapshot + movimientos posteriores`.
 *
 * Leer el saldo en vez de sumar los movimientos por fecha no es un atajo: es lo
 * CORRECTO. Sumar por `createdAt` usa el orden de los relojes, y una transaccion
 * que empezo antes puede confirmar despues; el saldo usa el orden de los
 * commits, que es el unico que describe lo que de verdad hay en el deposito.
 * Ver docs/INVENTORY_COUNT_CONCURRENCY.md.
 */
export async function cargarConteo(
  session: Session,
  id: number,
  input: CargarConteoInput,
): Promise<ResultadoDeConteo> {
  return prisma.$transaction(async (tx) => {
    const sesion = await sesionDeLaSucursal(tx, session, id)
    if (!sePuedeContar(sesion.status)) {
      throw conflict(
        `El inventario ${sesion.number} está ${etiquetaDeEstado(sesion.status).toLowerCase()}: ya no se cargan conteos.`,
        { code: 'COUNT_NOT_EDITABLE' },
      )
    }

    // El primer conteo abre la sesion. Un estado que cambia solo cuando pasa
    // algo dice mas que uno que hay que apretar aparte.
    if (sesion.status === 'DRAFT') {
      await tx.inventoryCountSession.update({ where: { id }, data: { status: 'COUNTING' } })
    }

    const ids = input.lineas.map((l) => l.lineId)
    const lineas = await tx.inventoryCountLine.findMany({
      where: { id: { in: ids }, sessionId: id },
      select: {
        id: true,
        productId: true,
        lotId: true,
        status: true,
        countedQuantity: true,
        firstCountQuantity: true,
        notes: true,
        product: { select: { name: true, lotTracking: true } },
      },
    })
    if (lineas.length !== new Set(ids).size) {
      throw invalid('Alguna de las líneas no pertenece a este inventario')
    }
    const porId = new Map(lineas.map((l) => [l.id, l]))

    const ahora = new Date()
    const umbral = sesion.recountThreshold
    const salida: ResultadoDeConteo['lineas'] = []

    // Por id ascendente: el orden de los bloqueos es parte del contrato.
    for (const pedido of [...input.lineas].sort((a, b) => a.lineId - b.lineId)) {
      const linea = porId.get(pedido.lineId)
      if (!linea) throw invalid('Alguna de las líneas no pertenece a este inventario')

      const contado = aCantidad(pedido.countedQuantity)
      const esperado = await stockActual(tx, session.branchId, linea.productId, linea.lotId)
      const diferencia = restarCantidades(contado, esperado)

      const politica = politicaDeLoteODefecto(linea.product.lotTracking)
      const sinPartida = linea.lotId === null && politica === 'REQUIRED' && !esCeroCantidad(contado)

      // El segundo conteo se pide UNA vez: si ya hubo uno, el que vale es el
      // segundo. Pedirlo indefinidamente convertiria una diferencia real en un
      // bucle del que no se sale.
      const yaHuboSegundo = linea.firstCountQuantity !== null
      const pideSegundo =
        !sinPartida &&
        !yaHuboSegundo &&
        umbral !== null &&
        absolutoCantidad(diferencia).greaterThan(umbral)

      const estado = sinPartida ? 'UNRESOLVED' : pideSegundo ? 'RECOUNT' : 'COUNTED'

      await tx.inventoryCountLine.update({
        where: { id: linea.id },
        data: {
          status: estado,
          countedQuantity: contado,
          // El primer conteo NO se pisa: es evidencia. Si el primero dijo 4 y el
          // segundo 17, esa diferencia es informacion sobre el conteo.
          firstCountQuantity:
            linea.status === 'RECOUNT' && !yaHuboSegundo
              ? linea.countedQuantity
              : linea.firstCountQuantity,
          expectedAtCount: esperado,
          variance: diferencia,
          countedById: session.userId,
          countedAt: ahora,
          notes: pedido.notes ?? linea.notes ?? null,
        },
      })

      const visible = !(sesion.blindCount && sePuedeContar(sesion.status))
      salida.push({
        id: linea.id,
        status: estado,
        expectedAtCount: visible ? aTextoCantidad(esperado) : null,
        variance: visible ? aTextoCantidad(diferencia) : null,
      })
    }

    return { lineas: salida }
  })
}

/** El saldo de HOY del producto, o del lote cuando la linea tiene uno. */
async function stockActual(
  tx: TxClient,
  branchId: number,
  productId: number,
  lotId: number | null,
): Promise<Cantidad> {
  if (lotId !== null) {
    const fila = await tx.branchLotStock.findUnique({
      where: { branchId_lotId: { branchId, lotId } },
      select: { quantity: true },
    })
    return fila?.quantity ?? CERO_C
  }

  // Sin lote, lo esperado es lo NO ATRIBUIDO: el stock del producto menos lo que
  // los lotes explican. En un producto sin rastreo eso es el stock entero.
  const filas = await tx.$queryRaw<Array<{ sinAsignar: Cantidad }>>`
    SELECT GREATEST(COALESCE(bs."quantity", 0) - COALESCE(sum(bls."quantity"), 0), 0)::numeric(14,3)
             AS "sinAsignar"
      FROM "Product" p
      LEFT JOIN "BranchStock" bs
        ON bs."productId" = p."id" AND bs."branchId" = ${branchId}
      LEFT JOIN "ProductLot" l ON l."productId" = p."id"
      LEFT JOIN "BranchLotStock" bls
        ON bls."lotId" = l."id" AND bls."branchId" = ${branchId}
     WHERE p."id" = ${productId}
     GROUP BY bs."quantity"
  `
  return filas[0]?.sinAsignar ?? CERO_C
}

/**
 * Resuelve una linea sin partida atribuyendola a un lote. Objetivo 31.
 *
 * Las unidades ESTAN: alguien las conto con la mano. Lo que falta es decir de
 * que partida son, y eso NO se inventa --nada de `UNKNOWN123`--. Se suman a la
 * linea de esa partida, que pasa a decir lo que de verdad hay.
 */
export async function resolverLinea(
  session: Session,
  id: number,
  lineId: number,
  input: ResolverLineaInput,
): Promise<ResultadoDeConteo> {
  return prisma.$transaction(async (tx) => {
    const sesion = await sesionDeLaSucursal(tx, session, id)
    if (sesion.status === 'APPLIED' || sesion.status === 'CANCELLED') {
      throw conflict(`El inventario ${sesion.number} ya está cerrado.`, {
        code: 'COUNT_NOT_EDITABLE',
      })
    }

    const linea = await tx.inventoryCountLine.findFirst({
      where: { id: lineId, sessionId: id },
      select: { id: true, productId: true, lotId: true, status: true, countedQuantity: true },
    })
    if (!linea) throw notFound('La línea no existe')
    if (linea.status !== 'UNRESOLVED') {
      throw conflict('Esa línea no está esperando que se resuelva su partida.', {
        code: 'COUNT_NOT_EDITABLE',
      })
    }

    const lote = await tx.productLot.findFirst({
      where: { id: input.lotId, productId: linea.productId },
      select: { id: true },
    })
    if (!lote) throw invalid('Esa partida no es de este producto')

    const encontradas = linea.countedQuantity ?? CERO_C
    const ahora = new Date()

    // La linea del lote: puede no existir todavia --una partida sin stock no
    // genera linea al crear la sesion-- y en ese caso se crea con snapshot cero.
    const delLote = await tx.inventoryCountLine.findFirst({
      where: { sessionId: id, productId: linea.productId, lotId: input.lotId },
      select: { id: true, countedQuantity: true },
    })

    const yaContado = delLote?.countedQuantity ?? CERO_C
    const total = yaContado.plus(encontradas)
    const esperado = await stockActual(tx, session.branchId, linea.productId, input.lotId)

    if (delLote) {
      await tx.inventoryCountLine.update({
        where: { id: delLote.id },
        data: {
          status: 'COUNTED',
          countedQuantity: total,
          expectedAtCount: esperado,
          variance: restarCantidades(total, esperado),
          countedById: session.userId,
          countedAt: ahora,
        },
      })
    } else {
      await tx.inventoryCountLine.create({
        data: {
          sessionId: id,
          productId: linea.productId,
          lotId: input.lotId,
          status: 'COUNTED',
          snapshotQuantity: CERO_C,
          countedQuantity: total,
          expectedAtCount: esperado,
          variance: restarCantidades(total, esperado),
          countedById: session.userId,
          countedAt: ahora,
        },
      })
    }

    // La linea sin partida queda en cero y contada: las unidades ya tienen dueño.
    const esperadoSinLote = await stockActual(tx, session.branchId, linea.productId, null)
    await tx.inventoryCountLine.update({
      where: { id: linea.id },
      data: {
        status: 'COUNTED',
        countedQuantity: CERO_C,
        expectedAtCount: esperadoSinLote,
        variance: restarCantidades(CERO_C, esperadoSinLote),
        countedById: session.userId,
        countedAt: ahora,
        notes: input.notes ?? null,
      },
    })

    return {
      lineas: [
        {
          id: linea.id,
          status: 'COUNTED',
          expectedAtCount: aTextoCantidad(esperadoSinLote),
          variance: aTextoCantidad(restarCantidades(CERO_C, esperadoSinLote)),
        },
      ],
    }
  })
}

// ---------------------------------------------------------------------------
// Revision, aplicacion y cancelacion
// ---------------------------------------------------------------------------

/**
 * Cierra el conteo. COUNTING → REVIEW.
 *
 * NO toca el stock: es exactamente lo que hace util al estado. Entre esto y la
 * aplicacion alguien mira las diferencias, y puede pasar un dia.
 */
export async function cerrarConteo(session: Session, id: number): Promise<InventarioListado> {
  await prisma.$transaction(async (tx) => {
    const sesion = await sesionDeLaSucursal(tx, session, id)
    if (!sePuedeRevisar(sesion.status)) {
      throw conflict(
        `El inventario ${sesion.number} está ${etiquetaDeEstado(sesion.status).toLowerCase()}: no se puede cerrar el conteo.`,
        { code: 'COUNT_NOT_EDITABLE' },
      )
    }

    const pendientes = await tx.inventoryCountLine.count({
      where: { sessionId: id, status: { in: ['PENDING', 'RECOUNT'] } },
    })
    if (pendientes > 0) {
      throw conflict(
        `Quedan ${String(pendientes)} línea(s) sin contar o esperando segundo conteo.`,
        { code: 'COUNT_INCOMPLETE' },
      )
    }

    await tx.inventoryCountSession.update({
      where: { id },
      data: { status: 'REVIEW', completedAt: new Date() },
    })

    await escribirAuditoria(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'InventoryCountSession',
      recordId: id,
      action: 'update',
      before: { status: sesion.status },
      after: { status: 'REVIEW' },
      origin: 'POST /api/inventarios/:id/revision',
    })
  })

  return obtenerInventario(session, id)
}

export interface ResultadoDeAplicacion {
  id: number
  number: string
  status: EstadoDeInventario
  /** Cuantas lineas generaron movimiento. Las de diferencia cero, no. */
  movimientos: number
  positivas: TextoCantidad
  negativas: TextoCantidad
}

/**
 * Aplica las diferencias. LA operacion del modulo.
 *
 * TODO O NADA: si una linea falla, no se aplica ninguna. Una correccion de
 * inventario a medias es peor que ninguna, porque deja el deposito con la mitad
 * de los numeros corregidos y sin forma de saber cual mitad.
 *
 * SE APLICA EL DELTA, NO EL NUMERO CONTADO. Si despues de contar 7 se vendio una
 * unidad mas, el stock esta en 6 y hay que dejarlo en 6: escribir "stock = 7"
 * borraria esa venta. Ver el objetivo 28.
 *
 * LA DOBLE CORRECCION, y por que hacen falta dos sentencias. Dos sesiones pueden
 * contar el mismo producto: eso es legitimo y no se prohibe --prohibirlo
 * obligaria a serializar el deposito entero--. Lo que no puede pasar es que las
 * dos apliquen la misma diferencia. Se detecta asi:
 *
 *   1. `SELECT ... FOR UPDATE` sobre las filas de `BranchStock`. Nada mas.
 *   2. RECIEN DESPUES, buscar movimientos `INVENTORY_COUNT` de otra sesion
 *      posteriores al conteo de esta linea, en su propia sentencia.
 *
 * Que sean dos importa: bajo READ COMMITTED la instantanea se toma al EMPEZAR la
 * sentencia, asi que la transaccion que espera el bloqueo buscaria con una foto
 * anterior a la escritura de la que estaba esperando. Es la misma leccion que la
 * Fase 4C aprendio en las imputaciones.
 */
export async function aplicarInventario(
  session: Session,
  id: number,
): Promise<ResultadoDeAplicacion> {
  return prisma.$transaction(async (tx) => {
    const sesion = await sesionDeLaSucursal(tx, session, id)
    if (!sePuedeAplicar(sesion.status)) {
      throw conflict(
        `El inventario ${sesion.number} está ${etiquetaDeEstado(sesion.status).toLowerCase()}: no se puede aplicar.`,
        { code: 'COUNT_NOT_EDITABLE' },
      )
    }

    const sinResolver = await tx.inventoryCountLine.count({
      where: { sessionId: id, status: 'UNRESOLVED' },
    })
    if (sinResolver > 0) {
      throw conflict(
        `Quedan ${String(sinResolver)} línea(s) con unidades cuya partida no se identificó. ` +
          'Resolvelas antes de aplicar: el sistema no inventa códigos de lote.',
        { code: 'COUNT_HAS_UNRESOLVED' },
      )
    }

    const conDiferencia = await tx.inventoryCountLine.findMany({
      where: { sessionId: id, status: 'COUNTED', variance: { not: 0 } },
      select: {
        id: true,
        productId: true,
        lotId: true,
        variance: true,
        countedAt: true,
        product: { select: { name: true, saleUnit: true } },
      },
      // Por producto y lote: el orden de los bloqueos es parte del contrato.
      orderBy: [{ productId: 'asc' }, { lotId: { sort: 'asc', nulls: 'first' } }],
    })

    const productIds = [...new Set(conDiferencia.map((l) => l.productId))].sort((a, b) => a - b)

    if (productIds.length > 0) {
      // 1. EL BLOQUEO, Y NADA MAS.
      await tx.$queryRaw`
        SELECT bs."id" FROM "BranchStock" bs
         WHERE bs."branchId" = ${session.branchId}
           AND bs."productId" = ANY(${productIds}::int[])
         ORDER BY bs."productId"
           FOR UPDATE
      `

      // 2. RECIEN AHORA, la busqueda de correcciones ajenas, en su propia
      //    sentencia y con los bloqueos ya tomados. La condicion de READ
      //    COMMITTED: la instantanea de una sentencia se toma cuando ESA
      //    sentencia empieza, asi que preguntar despues de bloquear es lo que
      //    hace que la respuesta incluya lo que la otra sesion acaba de aplicar.
      const pisadas = await conflictosDeInventario(tx, session, id)

      const primera = pisadas[0]
      if (primera) {
        const cuantas = pisadas.length
        const donde =
          primera.lotCode === null
            ? `"${primera.productName}"`
            : `"${primera.productName}" (partida ${primera.lotCode})`

        throw conflict(
          `Otro inventario (${primera.sessionNumber}) ya corrigió ${donde} después de que ` +
            'este lo contó: aplicar ahora corregiría dos veces la misma diferencia. ' +
            (cuantas === 1
              ? 'Volvé a contar esa línea.'
              : `Hay ${String(cuantas)} líneas en esa situación: volvé a contarlas.`),
          { code: 'COUNT_SUPERSEDED' },
        )
      }
    }

    let positivas = CERO_C
    let negativas = CERO_C

    for (const linea of conDiferencia) {
      const delta = linea.variance ?? CERO_C
      if (esCeroCantidad(delta)) continue

      await applyStockMovement(tx, {
        branchId: session.branchId,
        productId: linea.productId,
        lotId: linea.lotId,
        type: 'INVENTORY_COUNT',
        quantity: delta,
        saleUnit: unidadDeVentaODefecto(linea.product.saleUnit),
        userId: session.userId,
        reason: `Inventario físico ${sesion.number}`,
        referenceType: 'InventoryCountSession',
        referenceId: id,
      })

      if (delta.greaterThan(CERO_C)) positivas = positivas.plus(delta)
      else negativas = negativas.plus(delta)
    }

    await tx.inventoryCountSession.update({
      where: { id },
      data: { status: 'APPLIED', appliedAt: new Date(), appliedById: session.userId },
    })

    await escribirAuditoria(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'InventoryCountSession',
      recordId: id,
      action: 'update',
      before: { status: 'REVIEW' },
      after: {
        status: 'APPLIED',
        movimientos: conDiferencia.length,
        positivas: aTextoCantidad(positivas),
        negativas: aTextoCantidad(negativas),
      },
      origin: 'POST /api/inventarios/:id/aplicar',
    })

    return {
      id,
      number: sesion.number,
      status: 'APPLIED' as const,
      movimientos: conDiferencia.length,
      positivas: aTextoCantidad(positivas),
      negativas: aTextoCantidad(negativas),
    }
  })
}

export async function cancelarInventario(
  session: Session,
  id: number,
  input: CancelarInventarioInput,
): Promise<InventarioListado> {
  await prisma.$transaction(async (tx) => {
    const sesion = await sesionDeLaSucursal(tx, session, id)
    if (!sePuedeCancelar(sesion.status)) {
      throw conflict(
        `El inventario ${sesion.number} ya está ${etiquetaDeEstado(sesion.status).toLowerCase()}.`,
        { code: 'COUNT_NOT_EDITABLE' },
      )
    }

    await tx.inventoryCountSession.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: session.userId,
        cancelReason: input.reason,
      },
    })

    await escribirAuditoria(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'InventoryCountSession',
      recordId: id,
      action: 'update',
      reason: input.reason,
      before: { status: sesion.status },
      after: { status: 'CANCELLED' },
      origin: 'POST /api/inventarios/:id/cancelar',
    })
  })

  return obtenerInventario(session, id)
}

/** Cuantas sesiones abiertas hay. Para el panel. */
export async function inventariosAbiertos(branchId: number): Promise<number> {
  return prisma.inventoryCountSession.count({
    where: { branchId, status: { in: ['DRAFT', 'COUNTING', 'REVIEW'] } },
  })
}

/** La suma de diferencias de una sesion aplicada. Para el reporte. */
export async function diferenciasDe(sessionId: number): Promise<{
  positivas: Cantidad
  negativas: Cantidad
}> {
  const [pos, neg] = await Promise.all([
    prisma.inventoryCountLine.aggregate({
      where: { sessionId, variance: { gt: 0 } },
      _sum: { variance: true },
    }),
    prisma.inventoryCountLine.aggregate({
      where: { sessionId, variance: { lt: 0 } },
      _sum: { variance: true },
    }),
  ])
  return {
    positivas: sumaCantidadODefecto(pos._sum.variance),
    negativas: sumaCantidadODefecto(neg._sum.variance),
  }
}
