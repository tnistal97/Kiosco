/**
 * Objetivo 37 — las cuentas por pagar con volumen de verdad.
 *
 * Cinco mil proveedores, veinte mil recepciones, cincuenta mil movimientos y
 * veinte mil imputaciones. Es el volumen que pide el objetivo, y es donde se
 * ven los problemas que con tres filas no existen.
 *
 * LO QUE SE MIDE, y por que cada uno:
 *
 *   · el listado de proveedores    no puede traer cinco mil filas
 *   · el saldo de un proveedor     NO se calcula sumando su libro
 *   · las deudas abiertas          es la consulta con la suma anidada
 *   · el extracto paginado         un proveedor viejo tiene cientos de filas
 *   · el tablero de cartera        agrega en la base, no en JavaScript
 *   · el reporte del rango         seis consultas, todas agregadas
 *
 * Los topes son generosos a proposito: esto corre en una portatil junto con el
 * resto de la suite, y lo que se busca no es un numero fino sino detectar el
 * orden de magnitud equivocado --un N+1, un recorrido completo, una suma en
 * memoria--.
 *
 * PARA VER LOS TIEMPOS MEDIDOS, sin romper nada:
 *
 *   npx vitest run tests/performance/proveedores.test.ts --reporter=verbose --disable-console-intercept
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedFixture, prisma, hoyLocal, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

import { GET as LISTAR } from '@/app/api/suppliers/route'
import { GET as RESUMEN } from '@/app/api/suppliers/[id]/cuenta/resumen/route'
import { GET as DEUDAS } from '@/app/api/suppliers/[id]/deudas/route'
import { GET as EXTRACTO } from '@/app/api/suppliers/[id]/cuenta/route'
import { GET as CARTERA } from '@/app/api/suppliers/cartera/route'
import { GET as REPORTE } from '@/app/api/reports/proveedores/route'

const PROVEEDORES = 5_000
const RECEPCIONES = 20_000
const MOVIMIENTOS = 50_000
const IMPUTACIONES = 20_000

/** Tope generoso: lo que se busca es el orden de magnitud, no el milisegundo. */
const TOPE_MS = 1_500

let fx: Fixture
let proveedorConHistorial = 0

/** Lo medido, para imprimirlo al final. Ver la cabecera. */
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

  // Con SQL directo y en bloque: crearlos de a uno por la API tardaria minutos
  // y no probaria nada distinto. Lo que importa es el volumen de LECTURA.
  //
  // El saldo se reparte a proposito: un tercio se debe, un tercio esta al dia y
  // un tercio tiene credito a favor nuestro. Con todos en cero, el filtro "con
  // deuda" devolveria vacio y el indice no se ejercitaria.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Supplier" ("name", "taxId", "phone", "balance", "defaultPaymentTermDays", "updatedAt")
    SELECT 'Proveedor ' || i,
           '30-' || lpad((70000000 + i)::text, 8, '0') || '-1',
           '11-' || lpad((i % 10000)::text, 4, '0') || '-0000',
           CASE i % 3 WHEN 0 THEN (i % 500) * 100 WHEN 1 THEN 0 ELSE -((i % 50) * 10) END,
           CASE WHEN i % 4 = 0 THEN NULL ELSE 30 END,
           now()
      FROM generate_series(1, ${String(PROVEEDORES)}) AS i
  `)

  // El libro que sostiene esos saldos: UN movimiento por proveedor con saldo
  // distinto de cero, asi la invariante cierra.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierAccountMovement"
      ("branchId", "supplierId", "type", "amount", "previousBalance", "resultingBalance",
       "userId", "reason", "createdAt")
    SELECT ${String(fx.branchA.id)}, s."id", 'MANUAL_ADJUSTMENT',
           s."balance", 0, s."balance", ${String(fx.admin.id)},
           'Carga masiva para la prueba de volumen', now()
      FROM "Supplier" s
     WHERE s."balance" <> 0 AND s."name" LIKE 'Proveedor %'
  `)

  const primero = await prisma.supplier.findFirstOrThrow({
    where: { name: { startsWith: 'Proveedor ' } },
    select: { id: true, balance: true },
    orderBy: { id: 'asc' },
  })
  proveedorConHistorial = primero.id

  // El relleno del libro: pares que se cancelan, para no mover ningun saldo.
  // Van todos al mismo proveedor, que pasa a ser el del historial largo.
  const yaHay = await prisma.supplierAccountMovement.count()
  const pares = Math.floor(Math.max(0, MOVIMIENTOS - yaHay) / 2)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierAccountMovement"
      ("branchId", "supplierId", "type", "amount", "previousBalance", "resultingBalance",
       "userId", "reason", "createdAt")
    SELECT ${String(fx.branchA.id)}, ${String(proveedorConHistorial)}, 'MANUAL_ADJUSTMENT',
           CASE WHEN par = 0 THEN 100 ELSE -100 END,
           ${primero.balance.toFixed(2)}::numeric + CASE WHEN par = 0 THEN 0 ELSE 100 END,
           ${primero.balance.toFixed(2)}::numeric + CASE WHEN par = 0 THEN 100 ELSE 0 END,
           ${String(fx.admin.id)}, 'Relleno de la prueba de volumen', now()
      FROM generate_series(1, ${String(pares)}) AS i,
           generate_series(0, 1) AS par
  `)

  // Y las OBLIGACIONES. Una orden por proveedor y varias entregas colgando de
  // ella: es la forma real --una orden, muchas recepciones-- y ademas es lo que
  // hace que la consulta de deudas tenga que unir tres tablas.
  //
  // Los vencimientos se reparten entre pasado y futuro para que el filtro de
  // vencidas encuentre algo y el indice se ejercite.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "PurchaseOrder"
      ("number", "branchId", "supplierId", "status", "createdById", "expectedTotal",
       "orderedAt", "updatedAt")
    SELECT 'OC-VOL-' || lpad(s."id"::text, 8, '0'), ${String(fx.branchA.id)}, s."id",
           'RECEIVED', ${String(fx.admin.id)}, 0, now(), now()
      FROM "Supplier" s
     WHERE s."name" LIKE 'Proveedor %'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "PurchaseReceipt"
      ("purchaseOrderId", "branchId", "receivedById", "receivedAt", "total", "dueDate", "debtRecorded")
    SELECT o."id", ${String(fx.branchA.id)}, ${String(fx.admin.id)},
           now() - (i || ' days')::interval,
           10000 + (i * 137) % 5000,
           now() + ((i % 60) - 30 || ' days')::interval,
           true
      FROM "PurchaseOrder" o,
           generate_series(1, ${String(Math.ceil(RECEPCIONES / PROVEEDORES))}) AS i
     WHERE o."number" LIKE 'OC-VOL-%'
  `)

  // Las imputaciones necesitan pagos de los que colgar. Uno por proveedor, y
  // las imputaciones repartidas entre las entregas mas viejas.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierPayment"
      ("number", "branchId", "supplierId", "amount", "method", "paidById", "paidAt")
    SELECT 'PP-VOL-' || lpad(s."id"::text, 8, '0'), ${String(fx.branchA.id)}, s."id",
           5000, 'TRANSFER', ${String(fx.admin.id)}, now()
      FROM "Supplier" s
     WHERE s."name" LIKE 'Proveedor %'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierPaymentAllocation" ("paymentId", "receiptId", "amount", "createdById")
    SELECT p."id", r."id", 1000, ${String(fx.admin.id)}
      FROM "SupplierPayment" p
      JOIN "PurchaseOrder" o ON o."supplierId" = p."supplierId" AND o."number" LIKE 'OC-VOL-%'
      JOIN LATERAL (
        SELECT "id" FROM "PurchaseReceipt"
         WHERE "purchaseOrderId" = o."id"
         ORDER BY "id" LIMIT ${String(Math.ceil(IMPUTACIONES / PROVEEDORES))}
      ) r ON true
     WHERE p."number" LIKE 'PP-VOL-%'
  `)

  // FASE 5A.2: sin esto, el planificador decide los planes con las
  // estadisticas que hubiera dejado el archivo anterior --que no tienen nada
  // que ver con estas cincuenta mil filas-- y lo que se mide es su ignorancia,
  // no la consulta. `lotes.test.ts` ya lo hacia; este archivo no, y el reporte
  // pasaba de 1.100 ms a 2.900 ms segun que hubiera corrido antes. Un techo de
  // milisegundos sobre un plan elegido al azar es una prueba que falla sola.
  await prisma.$executeRawUnsafe(
    'ANALYZE "Supplier", "SupplierAccountMovement", "SupplierPayment", ' +
      '"SupplierPaymentAllocation", "PurchaseOrder", "PurchaseReceipt"',
  )
}, 600_000)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('las cuentas por pagar con volumen', () => {
  it('hay el volumen que se pidió', async () => {
    const [proveedores, recepciones, movimientos, imputaciones] = await Promise.all([
      prisma.supplier.count(),
      prisma.purchaseReceipt.count(),
      prisma.supplierAccountMovement.count(),
      prisma.supplierPaymentAllocation.count(),
    ])
    expect(proveedores).toBeGreaterThanOrEqual(PROVEEDORES)
    expect(recepciones).toBeGreaterThanOrEqual(RECEPCIONES)
    expect(movimientos).toBeGreaterThanOrEqual(MOVIMIENTOS - 2)
    expect(imputaciones).toBeGreaterThanOrEqual(IMPUTACIONES)
  })

  it('el listado de proveedores está paginado', async () => {
    const cookie = await sessionCookie(fx.admin)
    let cuantos = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[] }>(LISTAR, '/api/suppliers?page=1&pageSize=25', {
        cookie,
      })
      cuantos = res.body.data.length
    })

    expect(cuantos, 'no puede traer cinco mil filas').toBe(25)
    anotar('listado paginado (25 de 5.000)', ms)
  })

  it('leer el saldo de un proveedor no suma su libro', async () => {
    const cookie = await sessionCookie(fx.admin)
    const id = String(proveedorConHistorial)

    const ms = await cuantoTarda(async () => {
      await call(RESUMEN, `/api/suppliers/${id}/cuenta/resumen`, { cookie, params: { id } })
    })

    // Ese proveedor tiene decenas de miles de movimientos. Si el resumen los
    // sumara, esto no bajaria del segundo.
    anotar('resumen de un proveedor con 20.000+ movimientos', ms)
  })

  it('las deudas abiertas se resuelven en una consulta', async () => {
    const cookie = await sessionCookie(fx.admin)
    const id = String(proveedorConHistorial)

    const ms = await cuantoTarda(async () => {
      await call(DEUDAS, `/api/suppliers/${id}/deudas?abiertas=true`, { cookie, params: { id } })
    })

    anotar('deudas abiertas de un proveedor', ms)
  })

  it('el extracto viene paginado', async () => {
    const cookie = await sessionCookie(fx.admin)
    const id = String(proveedorConHistorial)
    let cuantos = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[] }>(
        EXTRACTO,
        `/api/suppliers/${id}/cuenta?page=1&pageSize=20`,
        { cookie, params: { id } },
      )
      cuantos = res.body.data.length
    })

    expect(cuantos).toBe(20)
    anotar('extracto paginado (20 de 20.000+)', ms)
  })

  it('el tablero de cartera agrega en la base', async () => {
    const cookie = await sessionCookie(fx.admin)

    const ms = await cuantoTarda(async () => {
      await call(CARTERA, '/api/suppliers/cartera', { cookie })
    })

    anotar('tablero de cuentas por pagar', ms)
  })

  it('el reporte del rango agrega en la base', async () => {
    const cookie = await sessionCookie(fx.admin)
    const hoy = hoyLocal()

    const ms = await cuantoTarda(async () => {
      await call(REPORTE, `/api/reports/proveedores?desde=${hoy}&hasta=${hoy}`, { cookie })
    })

    anotar('reporte de proveedores', ms)
  })

  it('deja los tiempos por escrito', () => {
    const ancho = Math.max(...MEDIDO.map((m) => m.que.length))
    const lineas = MEDIDO.map(
      (m) => `  ${m.que.padEnd(ancho)}  ${String(m.ms).padStart(5)} ms  (tope ${String(m.tope)})`,
    )
    console.log(['', 'CUENTAS POR PAGAR — TIEMPOS MEDIDOS', ...lineas, ''].join('\n'))

    // Que no se pierda una medicion en silencio: si alguien borra un caso, este
    // numero baja y la prueba lo dice.
    expect(MEDIDO).toHaveLength(6)
  })
})
