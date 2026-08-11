/**
 * Objetivo 48 — lotes e inventario físico con volumen de verdad.
 *
 * Cinco mil productos, diez mil partidas, cien mil movimientos y una sesión de
 * inventario de mil líneas. Es donde se ven los problemas que con tres filas no
 * existen.
 *
 * LO QUE SE MIDE, y por qué cada uno:
 *
 *   · FEFO                    es LA consulta caliente: corre en cada línea de
 *                             cada venta de un producto con partidas
 *   · próximos a vencer       ordena por fecha sobre TODO el catálogo
 *   · stock por lote          el desglose de un producto, con su `sinAsignar`
 *   · listado de lotes        paginado, con filtro por estado de vencimiento
 *   · crear el inventario     genera mil líneas de una vez
 *   · las líneas              paginadas, con filtros
 *   · aplicar                 escribe un movimiento por línea con diferencia
 *   · reconciliación          las cuatro comprobaciones nuevas, sobre todo
 *
 * Y EL PLAN DE LA CONSULTA DE FEFO, que es distinto de medir el tiempo: con
 * diez mil partidas un recorrido de tabla puede tardar cinco milisegundos y
 * seguir siendo un recorrido de tabla. Con cien veces más deja de serlo.
 *
 * Los topes son generosos a propósito: esto corre en una portátil junto con el
 * resto de la suite, y lo que se busca no es un número fino sino detectar el
 * orden de magnitud equivocado.
 *
 *   npx vitest run tests/performance/lotes.test.ts --reporter=verbose --disable-console-intercept
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

import { GET as LOTES } from '@/app/api/lotes/route'
import { GET as DESGLOSE } from '@/app/api/productos/[id]/lotes/route'
import { GET as VENCIMIENTOS } from '@/app/api/reportes/vencimientos/route'
import { POST as CREAR_INVENTARIO } from '@/app/api/inventarios/route'
import { GET as LINEAS } from '@/app/api/inventarios/[id]/lineas/route'
import { lotesDisponibles } from '@/modules/lots/fefo'
import { COMPROBACIONES } from '@/modules/integrity/checks'

const PRODUCTOS = 5_000
const LOTES_TOTALES = 10_000
const MOVIMIENTOS = 100_000
const LINEAS_DE_INVENTARIO = 1_000

/** Tope generoso: lo que se busca es el orden de magnitud, no el milisegundo. */
const TOPE_MS = 1_500

let fx: Fixture
let productoGordo = 0
let sesionGorda = 0

const MEDIDO: Array<{ que: string; ms: number; tope: number }> = []

async function cuantoTarda(que: () => Promise<unknown>): Promise<number> {
  const arranque = Date.now()
  await que()
  return Date.now() - arranque
}

function anotar(que: string, ms: number, tope: number = TOPE_MS): void {
  MEDIDO.push({ que, ms, tope })
  expect(ms, `${que}: ${String(ms)} ms`).toBeLessThan(tope)
}

beforeAll(async () => {
  fx = await seedFixture()
  const admin = String(fx.admin.id)
  const branch = String(fx.branchA.id)
  const categoria = String(fx.categoryId)

  // Con SQL directo y en bloque: crearlos de a uno por la API tardaría horas y
  // no probaría nada distinto. Lo que importa es el volumen de LECTURA.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Product" ("name", "categoryId", "price", "branchId", "cost",
                           "lotTracking", "expirationTracking", "minimumStock")
    SELECT 'Volumen 4D ' || i, ${categoria}, 1000, ${branch}, 600, 'OPTIONAL', 'OPTIONAL', 0
      FROM generate_series(1, ${String(PRODUCTOS)}) AS i
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "BranchStock" ("branchId", "productId", "quantity")
    SELECT ${branch}, p."id", 200
      FROM "Product" p WHERE p."name" LIKE 'Volumen 4D %'
  `)

  /*
    DOS PARTIDAS POR PRODUCTO, con fechas repartidas alrededor de hoy.

    El reparto importa: si todas vencieran el mismo día, el índice por fecha
    parecería inútil y el tablero de vencimientos mediría un caso que no existe.
    El módulo 400 deja vencidas, próximas y lejanas en proporciones parecidas a
    las de un depósito real.

    El `id` de la partida se deriva de la fila para poder atribuir stock después
    sin volver a leer.
  */
  await prisma.$executeRawUnsafe(`
    INSERT INTO "ProductLot" ("productId", "code", "codeNormalized", "expirationDate", "createdById")
    SELECT p."id",
           'VOL-' || p."id" || '-' || i,
           'VOL-' || p."id" || '-' || i,
           CASE WHEN (p."id" + i) % 7 = 0 THEN NULL
                ELSE (CURRENT_DATE + (((p."id" + i) % 400) - 60))
           END,
           ${admin}
      FROM "Product" p, generate_series(1, 2) AS i
     WHERE p."name" LIKE 'Volumen 4D %'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "BranchLotStock" ("branchId", "lotId", "quantity")
    SELECT ${branch}, l."id", 80
      FROM "ProductLot" l
      JOIN "Product" p ON p."id" = l."productId"
     WHERE p."name" LIKE 'Volumen 4D %'
  `)

  // Y las atribuciones que explican ese stock: sin ellas la reconciliación
  // marcaría diez mil filas, y una prueba de volumen no debe dejar la base
  // inconsistente.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "LotAssignment" ("branchId", "productId", "lotId", "quantity", "reason", "userId")
    SELECT ${branch}, l."productId", l."id", 80, 'Volumen 4D', ${admin}
      FROM "ProductLot" l
      JOIN "Product" p ON p."id" = l."productId"
     WHERE p."name" LIKE 'Volumen 4D %'
  `)

  /*
    CIEN MIL MOVIMIENTOS, y con saldos coherentes.

    `previousQuantity` y `resultingQuantity` tienen un CHECK que exige que
    cierren con `quantity`, así que no se pueden inventar. Y la invariante de la
    Fase 3A exige que la SUMA del libro sea el stock: un fixture que la rompa
    deja la base inconsistente y mide otra cosa.

    Por eso van en dos partes: una entrada INITIAL de 200 por producto --que es
    de dónde salió el stock-- y veinte ajustes que suman cero de a pares. El
    saldo vuelve siempre al mismo número y la reconciliación cierra.
  */
  await prisma.$executeRawUnsafe(`
    INSERT INTO "StockMovement"
      ("branchId", "productId", "type", "quantity", "previousQuantity",
       "resultingQuantity", "userId", "reason", "createdAt")
    SELECT ${branch}, p."id", 'INITIAL', 200, 0, 200, ${admin}, 'Volumen 4D',
           now() - interval '1 day'
      FROM "Product" p WHERE p."name" LIKE 'Volumen 4D %'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "StockMovement"
      ("branchId", "productId", "type", "quantity", "previousQuantity",
       "resultingQuantity", "userId", "reason", "createdAt")
    SELECT ${branch}, p."id",
           'MANUAL_ADJUSTMENT',
           CASE WHEN i % 2 = 1 THEN 1 ELSE -1 END,
           CASE WHEN i % 2 = 1 THEN 200 ELSE 201 END,
           CASE WHEN i % 2 = 1 THEN 201 ELSE 200 END,
           ${admin}, 'Volumen 4D', now() - (i || ' minutes')::interval
      FROM "Product" p, generate_series(1, ${String(Math.floor(MOVIMIENTOS / PRODUCTOS))}) AS i
     WHERE p."name" LIKE 'Volumen 4D %'
  `)

  const primero = await prisma.product.findFirstOrThrow({
    where: { name: { startsWith: 'Volumen 4D ' } },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  productoGordo = primero.id

  // Estadísticas frescas: sin esto el planificador decide con `reltuples = -1`
  // y el plan que se mide no es el que va a correr en producción. Es la lección
  // que dejó el fixture de la Fase 4C.
  await prisma.$executeRawUnsafe('ANALYZE "ProductLot"')
  await prisma.$executeRawUnsafe('ANALYZE "BranchLotStock"')
  await prisma.$executeRawUnsafe('ANALYZE "StockMovement"')
  await prisma.$executeRawUnsafe('ANALYZE "Product"')
}, 900_000)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('lotes e inventario con volumen', () => {
  it('hay el volumen que se pidió', async () => {
    const [productos, lotes, saldos, movimientos] = await Promise.all([
      prisma.product.count(),
      prisma.productLot.count(),
      prisma.branchLotStock.count(),
      prisma.stockMovement.count(),
    ])

    expect(productos).toBeGreaterThanOrEqual(PRODUCTOS)
    expect(lotes).toBeGreaterThanOrEqual(LOTES_TOTALES)
    expect(saldos).toBeGreaterThanOrEqual(LOTES_TOTALES)
    expect(movimientos).toBeGreaterThanOrEqual(MOVIMIENTOS)
  })

  it('FEFO de un producto no recorre las diez mil partidas', async () => {
    let cuantos = 0
    const ms = await cuantoTarda(async () => {
      const lotes = await lotesDisponibles(prisma, fx.branchA.id, productoGordo, '2026-08-11')
      cuantos = lotes.length
    })

    expect(cuantos, 'las dos partidas del producto, no las de todos').toBe(2)
    // Diez veces más exigente que el resto: corre en cada línea de cada venta.
    anotar('FEFO de un producto', ms, 150)
  })

  it('EL PLAN de FEFO usa índice y NO recorre la tabla', async () => {
    const plan = await prisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN
       SELECT l."id", l."code", l."expirationDate", bls."quantity"
         FROM "BranchLotStock" bls
         JOIN "ProductLot" l ON l."id" = bls."lotId"
        WHERE bls."branchId" = $1
          AND l."productId" = $2
          AND bls."quantity" > 0
        ORDER BY (l."expirationDate" IS NULL), l."expirationDate" ASC,
                 l."createdAt" ASC, l."id" ASC`,
      fx.branchA.id,
      productoGordo,
    )

    const texto = plan.map((f) => f['QUERY PLAN']).join('\n')

    /*
      LO QUE SE EXIGE: que la entrada a `ProductLot` sea por índice.

      Con diez mil partidas, un `Seq Scan on "ProductLot"` tarda poco y sigue
      siendo lineal: con un millón deja de tardar poco. Lo que decide que la
      consulta escale es que llegue a las partidas del producto por
      `ProductLot_productId_idx` y no leyéndolas todas.

      NO se exige nada sobre `BranchLotStock`: son dos filas por producto, y el
      planificador puede resolverlas por su índice único o por el de `lotId`
      según cómo ordene el join. Las dos son correctas.
    */
    expect(texto, `el plan fue:\n${texto}`).toMatch(/Index (Scan|Only Scan).*"ProductLot"/)
    expect(texto, 'no puede recorrer la tabla de partidas entera').not.toMatch(
      /Seq Scan on "ProductLot"/,
    )
  })

  it('el desglose por partida de un producto', async () => {
    const cookie = await sessionCookie(fx.admin)
    let sinAsignar = ''

    const ms = await cuantoTarda(async () => {
      const res = await call<{ sinAsignar: string; lotes: unknown[] }>(
        DESGLOSE,
        `/api/productos/${String(productoGordo)}/lotes`,
        { cookie, params: { id: String(productoGordo) } },
      )
      expect(res.status).toBe(200)
      sinAsignar = res.body.sinAsignar
    })

    // 200 de stock, 160 en dos partidas de 80: 40 sin asignar.
    expect(sinAsignar, 'lo no atribuido se deriva, no se guarda').toBe('40.000')
    anotar('desglose por partida', ms)
  })

  it('el listado de lotes está paginado', async () => {
    const cookie = await sessionCookie(fx.admin)
    let cuantos = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[]; pagination: { total: number } }>(
        LOTES,
        '/api/lotes?page=1&pageSize=25',
        { cookie },
      )
      expect(res.status).toBe(200)
      cuantos = res.body.data.length
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(LOTES_TOTALES)
    })

    expect(cuantos, 'una página, no diez mil filas').toBe(25)
    anotar('listado de lotes', ms)
  })

  it('el filtro por estado de vencimiento tampoco trae todo', async () => {
    const cookie = await sessionCookie(fx.admin)
    let cuantos = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[] }>(LOTES, '/api/lotes?estado=VENCIDO&pageSize=25', {
        cookie,
      })
      expect(res.status).toBe(200)
      cuantos = res.body.data.length
    })

    expect(cuantos).toBeLessThanOrEqual(25)
    anotar('lotes filtrados por vencimiento', ms)
  })

  it('el tablero de vencimientos agrega en la base', async () => {
    const cookie = await sessionCookie(fx.admin)
    let vencidos = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{ lotesVencidos: number }>(
        VENCIMIENTOS,
        '/api/reportes/vencimientos',
        { cookie },
      )
      expect(res.status).toBe(200)
      vencidos = res.body.lotesVencidos
    })

    expect(vencidos, 'con diez mil partidas repartidas, hay vencidas').toBeGreaterThan(0)
    anotar('tablero de vencimientos', ms)
  })

  it('crear un inventario de mil líneas', async () => {
    const cookie = await sessionCookie(fx.admin)
    const productos = await prisma.product.findMany({
      where: { name: { startsWith: 'Volumen 4D ' } },
      select: { id: true },
      orderBy: { id: 'asc' },
      // Cada producto genera TRES líneas: dos partidas más la de sin asignar.
      take: Math.ceil(LINEAS_DE_INVENTARIO / 3),
    })

    let total = 0
    const ms = await cuantoTarda(async () => {
      const res = await call<{ id: number; lineas: { total: number } }>(
        CREAR_INVENTARIO,
        '/api/inventarios',
        {
          method: 'POST',
          cookie,
          body: {
            scope: 'SELECTION',
            productIds: productos.map((p) => p.id),
            blindCount: true,
          },
        },
      )
      expect(res.status).toBe(201)
      sesionGorda = res.body.id
      total = res.body.lineas.total
    })

    expect(total, 'las líneas se generan con un solo INSERT ... SELECT').toBeGreaterThanOrEqual(
      LINEAS_DE_INVENTARIO,
    )
    // Escribe mil filas: se le da más aire que a una lectura.
    anotar('crear inventario de mil líneas', ms, 3_000)
  })

  it('las líneas del inventario vienen paginadas', async () => {
    const cookie = await sessionCookie(fx.admin)
    let cuantas = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[]; pagination: { total: number } }>(
        LINEAS,
        `/api/inventarios/${String(sesionGorda)}/lineas?pageSize=100`,
        { cookie, params: { id: String(sesionGorda) } },
      )
      expect(res.status).toBe(200)
      cuantas = res.body.data.length
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(LINEAS_DE_INVENTARIO)
    })

    expect(cuantas, 'cien de mil').toBe(100)
    anotar('líneas del inventario', ms)
  })

  it('la reconciliación completa no crece con la cantidad de partidas', async () => {
    let inconsistencias = 0

    const ms = await cuantoTarda(async () => {
      const resultados = await Promise.all(COMPROBACIONES.map((c) => c()))
      inconsistencias = resultados.reduce((s, r) => s + r.inconsistencias.length, 0)
    })

    // Y de paso: el fixture no dejó la base inconsistente. Una prueba de
    // volumen que rompe las invariantes mide otra cosa.
    expect(inconsistencias, 'el volumen no rompió ninguna invariante').toBe(0)
    anotar('reconciliación completa', ms, 5_000)
  })

  it('imprime lo medido', () => {
    const lineas = MEDIDO.map(
      (m) => `  ${m.que.padEnd(34)} ${String(m.ms).padStart(5)} ms   (tope ${String(m.tope)})`,
    )
    console.log(`\nRENDIMIENTO — lotes e inventario físico\n${lineas.join('\n')}\n`)
    expect(MEDIDO.length).toBe(8)
  })
})
