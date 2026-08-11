/**
 * Los tres reportes de la Fase 4D: vencimientos, mermas e inventarios.
 *
 * Van en su propio archivo y no dentro de `service.ts` --que ya son mil lineas--
 * pero comparten sus reglas: agregan en PostgreSQL, nunca en JavaScript; el
 * rango son DIAS de la sucursal y no instantes; y los importes salen como texto.
 *
 * QUE COSTO USA CADA UNO, que es la pregunta que decide si el numero significa
 * algo:
 *
 *   mermas         `costAtSale` NO existe para una merma, asi que se usa el
 *                  COSTO ACTUAL del producto. Va etiquetado como tal.
 *   inventarios    lo mismo, y por el mismo motivo.
 *   vencimientos   costo actual, y el nombre del campo lo dice: `valorACostoActual`.
 *
 * No se inventa un costo historico que no se guardo. La Fase 3D congelo
 * `SaleItem.costAtSale` porque una venta tiene un costo en el momento de
 * ocurrir; un ajuste de inventario NO lo tiene guardado, y ponerle el costo de
 * hoy con nombre de costo historico seria escribir un dato falso con formato de
 * dato real. Ver docs/REPORTING_MODEL.md.
 */

import { prisma } from '@/lib/prisma'
import type { Session } from '@/server/auth/session'
import { forbidden, invalid } from '@/server/http/errors'
import { cantidadDeDias, esFechaLocal, hoyEn } from '@/lib/tiempo'
import { comoTimestampUTC, rangoDeSucursal, zonaDeSucursal } from '@/server/tiempo'
import type { RangoQuery } from './schemas'

/** Igual que el resto de los reportes: el rango es de dias, no de instantes. */
const MAX_DIAS = 366

type Fila = Record<string, string | null>

async function filas(sql: string, ...args: unknown[]): Promise<Fila[]> {
  return prisma.$queryRawUnsafe<Fila[]>(sql, ...args)
}

async function preparar(
  session: Session,
  query: RangoQuery,
): Promise<{ desde: string; hasta: string; branchId: number }> {
  if (!session.permissions.has('reports.inventory.view')) {
    throw forbidden('No tiene permiso para ver este reporte')
  }
  if (!esFechaLocal(query.desde) || !esFechaLocal(query.hasta)) throw invalid('Fechas invalidas')
  if (query.desde > query.hasta) throw invalid('La fecha inicial es posterior a la final')
  if (cantidadDeDias(query.desde, query.hasta) > MAX_DIAS) {
    throw invalid(`El rango no puede superar ${String(MAX_DIAS)} dias`)
  }

  const { desde, hasta } = await rangoDeSucursal(prisma, session.branchId, query.desde, query.hasta)
  return {
    desde: comoTimestampUTC(desde),
    hasta: comoTimestampUTC(hasta),
    branchId: session.branchId,
  }
}

// ---------------------------------------------------------------------------
// Mermas
// ---------------------------------------------------------------------------

export interface RenglonDeMerma {
  categoria: string
  etiqueta: string
  movimientos: number
  unidades: string
  /** Al COSTO ACTUAL del producto. Nulo sin permiso de costos. */
  valorACostoActual: string | null
}

export interface ReporteDeMermas {
  desde: string
  hasta: string
  renglones: RenglonDeMerma[]
  totalUnidades: string
  totalACostoActual: string | null
  /** Cuantos productos participan, para saber si son muchos o uno solo. */
  productos: number
  porProducto: Array<{
    productId: number
    productName: string
    categoria: string
    unidades: string
    valorACostoActual: string | null
  }>
}

/**
 * Las CINCO categorias, y por que son cinco y no una.
 *
 *   PERDIDA               `LOSS`     mercaderia que falta y nadie sabe por que
 *   ROTURA                `BREAKAGE` se rompio
 *   VENCIDO RETIRADO      una salida cargada contra una partida QUE YA ESTABA
 *                         VENCIDA el dia del movimiento
 *   USO INTERNO           `INTERNAL_USE`
 *   DIFERENCIA DE INVENTARIO  `INVENTORY_COUNT` negativo
 *   OTRO AJUSTE NEGATIVO  `MANUAL_ADJUSTMENT` negativo
 *
 * LA REGLA DEL OBJETIVO 50, y es la unica que importa de todas: una diferencia
 * de inventario NO es una merma. Un faltante contado puede ser robo, error de
 * carga, una venta mal cobrada o mercaderia que nunca llego; llamarlo "perdida"
 * es afirmar una causa que nadie averiguo. Aparece con su propio nombre.
 *
 * Y una diferencia POSITIVA no aparece en este reporte en absoluto: un sobrante
 * no es una perdida negativa.
 *
 * "Vencido retirado" NO es un tipo de movimiento nuevo: es una PERDIDA --o una
 * rotura-- cargada contra una partida cuya fecha ya habia pasado. Es un dato
 * registrado, no una suposicion: sale de comparar `ProductLot.expirationDate`
 * con `StockMovement.createdAt`. Se clasifica primero por la partida porque es
 * el hecho mas especifico: si la mercaderia estaba vencida, eso explica la baja
 * mejor que la etiqueta que eligio quien la cargo.
 */
const CATEGORIA_SQL = `
  CASE
    WHEN sm."type" = 'INVENTORY_COUNT'                    THEN 'INVENTORY_DIFF'
    WHEN l."expirationDate" IS NOT NULL
     AND l."expirationDate" < (sm."createdAt" AT TIME ZONE 'UTC')::date THEN 'EXPIRED'
    WHEN sm."type" = 'LOSS'                               THEN 'LOSS'
    WHEN sm."type" = 'BREAKAGE'                           THEN 'BREAKAGE'
    WHEN sm."type" = 'INTERNAL_USE'                       THEN 'INTERNAL_USE'
    ELSE 'OTHER_NEGATIVE'
  END`

const ETIQUETA: Record<string, string> = {
  LOSS: 'Pérdida',
  BREAKAGE: 'Rotura',
  EXPIRED: 'Vencido retirado',
  INTERNAL_USE: 'Uso interno',
  INVENTORY_DIFF: 'Diferencia de inventario',
  OTHER_NEGATIVE: 'Otro ajuste negativo',
}

/** El orden en que se leen: primero lo que es merma de verdad. */
const ORDEN = ['LOSS', 'BREAKAGE', 'EXPIRED', 'INTERNAL_USE', 'OTHER_NEGATIVE', 'INVENTORY_DIFF']

/** Los tipos que pueden restar. `SALE` y `PURCHASE_RETURN` NO son mermas. */
const TIPOS_DE_BAJA = "('LOSS','BREAKAGE','INTERNAL_USE','MANUAL_ADJUSTMENT','INVENTORY_COUNT')"

export async function reporteDeMermas(
  session: Session,
  query: RangoQuery,
): Promise<ReporteDeMermas> {
  const { desde, hasta, branchId } = await preparar(session, query)
  const verCostos = session.permissions.has('reports.costs.view')

  const base = `
      FROM "StockMovement" sm
      JOIN "Product" p ON p."id" = sm."productId"
      LEFT JOIN "ProductLot" l ON l."id" = sm."lotId"
     WHERE sm."branchId" = $1
       AND sm."createdAt" >= $2::timestamp
       AND sm."createdAt" <= $3::timestamp
       AND sm."quantity" < 0
       AND sm."type" IN ${TIPOS_DE_BAJA}`

  const [porCategoria, porProducto, cuantos] = await Promise.all([
    filas(
      `SELECT ${CATEGORIA_SQL} AS categoria,
              count(*)::text AS movimientos,
              sum(-sm."quantity")::numeric(14,3)::text AS unidades,
              ${
                verCostos
                  ? `COALESCE(sum(round(-sm."quantity" * p."cost", 2)), 0)::numeric(14,2)::text`
                  : 'NULL'
              } AS valor
         ${base}
        GROUP BY 1`,
      branchId,
      desde,
      hasta,
    ),
    filas(
      `SELECT sm."productId"::text AS "productId",
              p."name" AS "productName",
              ${CATEGORIA_SQL} AS categoria,
              sum(-sm."quantity")::numeric(14,3)::text AS unidades,
              ${
                verCostos
                  ? `COALESCE(sum(round(-sm."quantity" * p."cost", 2)), 0)::numeric(14,2)::text`
                  : 'NULL'
              } AS valor
         ${base}
        GROUP BY 1, 2, 3
        ORDER BY sum(-sm."quantity") DESC
        LIMIT 50`,
      branchId,
      desde,
      hasta,
    ),
    filas(`SELECT count(DISTINCT sm."productId")::text AS n ${base}`, branchId, desde, hasta),
  ])

  const renglones = ORDEN.map((categoria) => {
    const f = porCategoria.find((x) => x.categoria === categoria)
    return {
      categoria,
      etiqueta: ETIQUETA[categoria] ?? categoria,
      movimientos: Number(f?.movimientos ?? 0),
      unidades: f?.unidades ?? '0.000',
      valorACostoActual: verCostos ? (f?.valor ?? '0.00') : null,
    }
  }).filter((r) => r.movimientos > 0)

  // El total EXCLUYE la diferencia de inventario, por la misma razon por la que
  // tiene renglon propio: sumarla dentro de "mermas" haria que el total afirme
  // una causa que nadie averiguo.
  const mermasDeVerdad = renglones.filter((r) => r.categoria !== 'INVENTORY_DIFF')

  return {
    desde: query.desde,
    hasta: query.hasta,
    renglones,
    totalUnidades: mermasDeVerdad.reduce((s, r) => s + Number(r.unidades), 0).toFixed(3),
    totalACostoActual: verCostos
      ? mermasDeVerdad.reduce((s, r) => s + Number(r.valorACostoActual ?? 0), 0).toFixed(2)
      : null,
    productos: Number(cuantos[0]?.n ?? 0),
    porProducto: porProducto.map((f) => ({
      productId: Number(f.productId),
      productName: f.productName ?? '—',
      categoria: ETIQUETA[f.categoria ?? ''] ?? f.categoria ?? '—',
      unidades: f.unidades ?? '0.000',
      valorACostoActual: verCostos ? (f.valor ?? '0.00') : null,
    })),
  }
}

// ---------------------------------------------------------------------------
// Inventarios físicos
// ---------------------------------------------------------------------------

export interface RenglonDeInventario {
  id: number
  number: string
  fecha: Date
  responsable: string
  estado: string
  alcance: string
  productosContados: number
  productosConDiferencia: number
  diferenciaPositiva: string
  diferenciaNegativa: string
  /** Al COSTO ACTUAL. Nulo sin permiso de costos. */
  valorACostoActual: string | null
}

export interface ReporteDeInventarios {
  desde: string
  hasta: string
  sesiones: RenglonDeInventario[]
  aplicadas: number
  pendientes: number
}

/**
 * Las sesiones del periodo, con lo que cada una encontro.
 *
 * `diferenciaPositiva` y `diferenciaNegativa` van SEPARADAS y no netas: un
 * inventario que encontro 20 de mas y 20 de menos no encontro cero. Netearlas
 * borraria exactamente la informacion que hace util al reporte.
 *
 * El VALOR es el neto de las dos, al costo actual, y por eso puede ser
 * negativo: un inventario con mas faltante que sobrante vale menos que cero.
 * "Perdida" no se dice en ningun lado, porque una diferencia positiva no lo es.
 */
export async function reporteDeInventarios(
  session: Session,
  query: RangoQuery,
): Promise<ReporteDeInventarios> {
  const { desde, hasta, branchId } = await preparar(session, query)
  const verCostos = session.permissions.has('reports.costs.view')

  const sesiones = await filas(
    `SELECT s."id"::text                                          AS id,
            s."number"                                            AS "number",
            s."startedAt"::text                                   AS fecha,
            u."name"                                              AS responsable,
            s."status"                                            AS estado,
            s."scope"                                             AS alcance,
            count(cl."id") FILTER (WHERE cl."status" = 'COUNTED')::text AS contados,
            count(cl."id") FILTER (WHERE cl."variance" <> 0)::text      AS "conDiferencia",
            COALESCE(sum(cl."variance") FILTER (WHERE cl."variance" > 0), 0)::numeric(14,3)::text AS positiva,
            COALESCE(sum(cl."variance") FILTER (WHERE cl."variance" < 0), 0)::numeric(14,3)::text AS negativa,
            ${
              verCostos
                ? `COALESCE(sum(round(cl."variance" * p."cost", 2)), 0)::numeric(14,2)::text`
                : 'NULL'
            } AS valor
       FROM "InventoryCountSession" s
       JOIN "User" u ON u."id" = s."startedById"
       LEFT JOIN "InventoryCountLine" cl ON cl."sessionId" = s."id"
       LEFT JOIN "Product" p ON p."id" = cl."productId"
      WHERE s."branchId" = $1
        AND s."startedAt" >= $2::timestamp
        AND s."startedAt" <= $3::timestamp
      GROUP BY s."id", s."number", s."startedAt", u."name", s."status", s."scope"
      ORDER BY s."startedAt" DESC
      LIMIT 200`,
    branchId,
    desde,
    hasta,
  )

  const renglones = sesiones.map((f) => ({
    id: Number(f.id),
    number: f.number ?? '—',
    fecha: new Date(f.fecha ?? ''),
    responsable: f.responsable ?? '—',
    estado: f.estado ?? '—',
    alcance: f.alcance ?? '—',
    productosContados: Number(f.contados ?? 0),
    productosConDiferencia: Number(f.conDiferencia ?? 0),
    diferenciaPositiva: f.positiva ?? '0.000',
    diferenciaNegativa: f.negativa ?? '0.000',
    valorACostoActual: verCostos ? (f.valor ?? '0.00') : null,
  }))

  return {
    desde: query.desde,
    hasta: query.hasta,
    sesiones: renglones,
    aplicadas: renglones.filter((s) => s.estado === 'APPLIED').length,
    pendientes: renglones.filter((s) => s.estado === 'REVIEW' || s.estado === 'COUNTING').length,
  }
}

// ---------------------------------------------------------------------------
// Vencimientos, con su valor
// ---------------------------------------------------------------------------

export interface ReporteDeVencimientos {
  hoy: string
  tramos: Array<{
    tramo: string
    etiqueta: string
    lotes: number
    productos: number
    unidades: string
    /** Al COSTO ACTUAL. Nulo sin permiso. NO es una pérdida realizada. */
    valorACostoActual: string | null
  }>
  /** Partidas sin fecha: no vencen, y por eso no entran en ningún tramo. */
  sinFecha: { lotes: number; unidades: string }
  detalle: Array<{
    lotId: number
    code: string
    productName: string
    expirationDate: string | null
    quantity: string
    dias: number | null
  }>
}

const ETIQUETA_DE_TRAMO: Record<string, string> = {
  VENCIDO: 'Vencido',
  SIETE: 'Vence en 7 días',
  TREINTA: 'Vence en 30 días',
}

/**
 * Lo que hay en el depósito, ordenado por cuánto le queda.
 *
 * EL VALOR NO ES UNA PÉRDIDA. Es lo que costaría reponer esa mercadería HOY, y
 * el campo se llama `valorACostoActual` justo para que nadie lo lea como plata
 * perdida: lo que vence la semana que viene todavía se puede vender, y lo ya
 * vencido se compró a un costo que puede no ser el de hoy. Presentarlo como
 * pérdida realizada sería afirmar dos cosas falsas a la vez.
 *
 * `SIN FECHA` va aparte y no dentro de "OK": una partida sin vencimiento no es
 * una que vence lejos, es una sobre la que no hay nada que controlar.
 */
export async function reporteDeVencimientos(session: Session): Promise<ReporteDeVencimientos> {
  if (!session.permissions.has('lots.view')) {
    throw forbidden('No tiene permiso para ver los vencimientos')
  }
  const zona = await zonaDeSucursal(prisma, session.branchId)
  const hoy = hoyEn(zona)
  const verCostos = session.permissions.has('reports.costs.view')

  const [tramos, sinFecha, detalle] = await Promise.all([
    filas(
      `SELECT CASE
                WHEN l."expirationDate" < $2::date THEN 'VENCIDO'
                WHEN l."expirationDate" <= $2::date + 7  THEN 'SIETE'
                ELSE 'TREINTA'
              END AS tramo,
              count(*)::text                          AS lotes,
              count(DISTINCT l."productId")::text     AS productos,
              sum(bls."quantity")::numeric(14,3)::text AS unidades,
              ${
                verCostos
                  ? `COALESCE(sum(round(bls."quantity" * p."cost", 2)), 0)::numeric(14,2)::text`
                  : 'NULL'
              } AS valor
         FROM "BranchLotStock" bls
         JOIN "ProductLot" l ON l."id" = bls."lotId"
         JOIN "Product" p    ON p."id" = l."productId"
        WHERE bls."branchId" = $1
          AND bls."quantity" > 0
          AND l."expirationDate" IS NOT NULL
          AND l."expirationDate" <= $2::date + 30
        GROUP BY 1`,
      session.branchId,
      hoy,
    ),
    filas(
      `SELECT count(*)::text AS lotes, COALESCE(sum(bls."quantity"), 0)::numeric(14,3)::text AS unidades
         FROM "BranchLotStock" bls
         JOIN "ProductLot" l ON l."id" = bls."lotId"
        WHERE bls."branchId" = $1 AND bls."quantity" > 0 AND l."expirationDate" IS NULL`,
      session.branchId,
    ),
    filas(
      `SELECT l."id"::text AS "lotId", l."code" AS code, p."name" AS "productName",
              l."expirationDate"::text AS "expirationDate",
              bls."quantity"::numeric(14,3)::text AS quantity,
              (l."expirationDate" - $2::date)::text AS dias
         FROM "BranchLotStock" bls
         JOIN "ProductLot" l ON l."id" = bls."lotId"
         JOIN "Product" p    ON p."id" = l."productId"
        WHERE bls."branchId" = $1
          AND bls."quantity" > 0
          AND l."expirationDate" IS NOT NULL
          AND l."expirationDate" <= $2::date + 30
        ORDER BY l."expirationDate" ASC, l."id" ASC
        LIMIT 200`,
      session.branchId,
      hoy,
    ),
  ])

  return {
    hoy,
    tramos: ['VENCIDO', 'SIETE', 'TREINTA'].map((tramo) => {
      const f = tramos.find((x) => x.tramo === tramo)
      return {
        tramo,
        etiqueta: ETIQUETA_DE_TRAMO[tramo] ?? tramo,
        lotes: Number(f?.lotes ?? 0),
        productos: Number(f?.productos ?? 0),
        unidades: f?.unidades ?? '0.000',
        valorACostoActual: verCostos ? (f?.valor ?? '0.00') : null,
      }
    }),
    sinFecha: {
      lotes: Number(sinFecha[0]?.lotes ?? 0),
      unidades: sinFecha[0]?.unidades ?? '0.000',
    },
    detalle: detalle.map((f) => ({
      lotId: Number(f.lotId),
      code: f.code ?? '—',
      productName: f.productName ?? '—',
      expirationDate: f.expirationDate ?? null,
      quantity: f.quantity ?? '0.000',
      dias: f.dias === null ? null : Number(f.dias),
    })),
  }
}
