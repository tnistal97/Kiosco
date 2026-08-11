/**
 * Objetivo 32 — anticipos y devoluciones con volumen de verdad.
 *
 * Dos mil proveedores, diez mil recepciones, diez mil pagos con saldo y cinco
 * mil devoluciones confirmadas. Es donde se ven los problemas que con tres filas
 * no existen.
 *
 * LO QUE SE MIDE, y por qué cada uno:
 *
 *   · pagos sin imputar        la suma de imputaciones va por pago: es el N+1
 *                              más fácil de escribir sin darse cuenta
 *   · deudas netas             la consulta con DOS sumas anidadas (pagos y
 *                              devoluciones) sobre la misma entrega
 *   · listado de devoluciones  paginado, con proveedor y orden
 *   · detalle de una recepción con lo devuelto por renglón y el desglose
 *                              financiero: dos agregados más
 *   · ficha del proveedor      resumen, que ahora también cuenta anticipos y
 *                              devoluciones
 *
 * Los topes son generosos a propósito: esto corre en una portátil junto con el
 * resto de la suite, y lo que se busca no es un número fino sino detectar el
 * orden de magnitud equivocado --un N+1, un recorrido completo, una suma en
 * memoria--.
 *
 * PARA VER LOS TIEMPOS MEDIDOS, sin romper nada:
 *
 *   npx vitest run tests/performance/devoluciones.test.ts --reporter=verbose --disable-console-intercept
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

import { GET as ANTICIPOS } from '@/app/api/suppliers/[id]/anticipos/route'
import { GET as DEUDAS } from '@/app/api/suppliers/[id]/deudas/route'
import { GET as RESUMEN } from '@/app/api/suppliers/[id]/cuenta/resumen/route'
import { GET as DEVOLUCIONES } from '@/app/api/devoluciones/route'
import { GET as ORDEN } from '@/app/api/purchases/[id]/route'

const PROVEEDORES = 2_000
const POR_PROVEEDOR = 5
const DEVUELTAS = 5_000

/** Tope generoso: lo que se busca es el orden de magnitud, no el milisegundo. */
const TOPE_MS = 1_500

let fx: Fixture
let proveedorGordo = 0
let ordenGorda = 0

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

  // Con SQL directo y en bloque: crearlos de a uno por la API tardaría minutos
  // y no probaría nada distinto. Lo que importa es el volumen de LECTURA.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Supplier" ("name", "balance", "defaultPaymentTermDays", "updatedAt")
    SELECT 'Volumen 4C ' || i, 0, 30, now()
      FROM generate_series(1, ${String(PROVEEDORES)}) AS i
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "PurchaseOrder"
      ("number", "branchId", "supplierId", "status", "createdById", "expectedTotal",
       "orderedAt", "updatedAt")
    SELECT 'OC-4C-' || lpad(s."id"::text, 8, '0'), ${branch}, s."id",
           'RECEIVED', ${admin}, 0, now(), now()
      FROM "Supplier" s
     WHERE s."name" LIKE 'Volumen 4C %'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "PurchaseOrderItem"
      ("purchaseOrderId", "productId", "orderedQuantity", "receivedQuantity",
       "purchaseUnit", "unitsPerPurchaseUnit", "unitCost", "subtotal")
    SELECT o."id", ${String(fx.productoCaja.id)}, 1000, 1000, 'UNIT', 1, 100, 100000
      FROM "PurchaseOrder" o
     WHERE o."number" LIKE 'OC-4C-%'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "PurchaseReceipt"
      ("purchaseOrderId", "branchId", "receivedById", "receivedAt", "total", "dueDate", "debtRecorded")
    SELECT o."id", ${branch}, ${admin},
           now() - (i || ' days')::interval,
           10000, now() + ((i % 60) - 30 || ' days')::interval, true
      FROM "PurchaseOrder" o,
           generate_series(1, ${String(POR_PROVEEDOR)}) AS i
     WHERE o."number" LIKE 'OC-4C-%'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "PurchaseReceiptItem"
      ("purchaseReceiptId", "purchaseOrderItemId", "productId", "receivedQuantity",
       "purchaseUnit", "unitsPerPurchaseUnit", "unitCost", "expectedUnitCost",
       "stockQuantity", "stockUnitCost")
    SELECT r."id", oi."id", ${String(fx.productoCaja.id)}, 100, 'UNIT', 1, 100, 100, 100, 100
      FROM "PurchaseReceipt" r
      JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
      JOIN "PurchaseOrderItem" oi ON oi."purchaseOrderId" = o."id"
     WHERE o."number" LIKE 'OC-4C-%'
  `)

  // Los cargos que sostienen esas obligaciones: sin ellos la reconciliación
  // marcaría todo, y una prueba de volumen no debe dejar la base inconsistente.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierAccountMovement"
      ("branchId", "supplierId", "type", "amount", "previousBalance", "resultingBalance",
       "receiptId", "userId", "createdAt")
    SELECT ${branch}, o."supplierId", 'PURCHASE_CHARGE', r."total", 0, r."total",
           r."id", ${admin}, r."receivedAt"
      FROM "PurchaseReceipt" r
      JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
     WHERE o."number" LIKE 'OC-4C-%'
  `)

  // UN pago por proveedor, PARCIALMENTE imputado: así todos tienen saldo
  // disponible y la lista de anticipos tiene con qué trabajar.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierPayment"
      ("number", "branchId", "supplierId", "amount", "method", "paidById", "paidAt")
    SELECT 'PP-4C-' || lpad(s."id"::text, 8, '0'), ${branch}, s."id",
           20000, 'TRANSFER', ${admin}, now()
      FROM "Supplier" s
     WHERE s."name" LIKE 'Volumen 4C %'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierPaymentAllocation" ("paymentId", "receiptId", "amount", "createdById")
    SELECT p."id", r."id", 2000, ${admin}
      FROM "SupplierPayment" p
      JOIN "PurchaseOrder" o ON o."supplierId" = p."supplierId" AND o."number" LIKE 'OC-4C-%'
      JOIN LATERAL (
        SELECT "id" FROM "PurchaseReceipt" WHERE "purchaseOrderId" = o."id" ORDER BY "id" LIMIT 2
      ) r ON true
     WHERE p."number" LIKE 'PP-4C-%'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierAccountMovement"
      ("branchId", "supplierId", "type", "amount", "previousBalance", "resultingBalance",
       "paymentId", "userId", "createdAt")
    SELECT ${branch}, p."supplierId", 'PAYMENT', -p."amount", 0, -p."amount",
           p."id", ${admin}, p."paidAt"
      FROM "SupplierPayment" p
     WHERE p."number" LIKE 'PP-4C-%'
  `)

  // Y las devoluciones confirmadas, sobre las entregas más nuevas.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "PurchaseReturn"
      ("number", "branchId", "supplierId", "purchaseReceiptId", "status", "reason",
       "total", "createdById", "createdAt", "confirmedById", "confirmedAt")
    SELECT 'DV-4C-' || lpad(r."id"::text, 8, '0'), ${branch}, o."supplierId", r."id",
           'CONFIRMED', 'DAMAGED', 1000, ${admin}, now(), ${admin}, now()
      FROM "PurchaseReceipt" r
      JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
     WHERE o."number" LIKE 'OC-4C-%'
     ORDER BY r."id" DESC
     LIMIT ${String(DEVUELTAS)}
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "PurchaseReturnItem"
      ("purchaseReturnId", "productId", "purchaseReceiptItemId", "quantity",
       "purchaseUnit", "unitsPerPurchaseUnit", "stockQuantity", "unitCost", "amount")
    SELECT d."id", ri."productId", ri."id", 10, 'UNIT', 1, 10, 100, 1000
      FROM "PurchaseReturn" d
      JOIN "PurchaseReceiptItem" ri ON ri."purchaseReceiptId" = d."purchaseReceiptId"
     WHERE d."number" LIKE 'DV-4C-%'
  `)

  await prisma.$executeRawUnsafe(`
    INSERT INTO "SupplierAccountMovement"
      ("branchId", "supplierId", "type", "amount", "previousBalance", "resultingBalance",
       "returnId", "userId", "reason", "createdAt")
    SELECT ${branch}, d."supplierId", 'PURCHASE_CREDIT', -d."total", 0, -d."total",
           d."id", ${admin}, 'Volumen', d."confirmedAt"
      FROM "PurchaseReturn" d
     WHERE d."number" LIKE 'DV-4C-%'
  `)

  const primero = await prisma.supplier.findFirstOrThrow({
    where: { name: { startsWith: 'Volumen 4C ' } },
    select: { id: true },
    orderBy: { id: 'asc' },
  })
  proveedorGordo = primero.id

  const orden = await prisma.purchaseOrder.findFirstOrThrow({
    where: { supplierId: proveedorGordo, number: { startsWith: 'OC-4C-' } },
    select: { id: true },
  })
  ordenGorda = orden.id
}, 900_000)

afterAll(async () => {
  await prisma.$disconnect()
})

describe('anticipos y devoluciones con volumen', () => {
  it('hay el volumen que se pidió', async () => {
    const [proveedores, recepciones, devoluciones, imputaciones] = await Promise.all([
      prisma.supplier.count(),
      prisma.purchaseReceipt.count(),
      prisma.purchaseReturn.count(),
      prisma.supplierPaymentAllocation.count(),
    ])
    expect(proveedores).toBeGreaterThanOrEqual(PROVEEDORES)
    expect(recepciones).toBeGreaterThanOrEqual(PROVEEDORES * POR_PROVEEDOR)
    expect(devoluciones).toBeGreaterThanOrEqual(DEVUELTAS)
    expect(imputaciones).toBeGreaterThanOrEqual(PROVEEDORES * 2)
  })

  it('los pagos sin imputar de un proveedor', async () => {
    const cookie = await sessionCookie(fx.admin)
    let cuantos = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[] }>(
        ANTICIPOS,
        `/api/suppliers/${String(proveedorGordo)}/anticipos`,
        { cookie, params: { id: String(proveedorGordo) } },
      )
      expect(res.status).toBe(200)
      cuantos = res.body.data.length
    })

    expect(cuantos, 'el pago está parcialmente imputado, así que aparece').toBe(1)
    anotar('pagos sin imputar', ms)
  })

  it('las deudas NETAS, con las dos sumas anidadas', async () => {
    const cookie = await sessionCookie(fx.admin)
    let devuelto = ''

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: Array<{ devuelto: string; neto: string }> }>(
        DEUDAS,
        `/api/suppliers/${String(proveedorGordo)}/deudas?abiertas=false`,
        { cookie, params: { id: String(proveedorGordo) } },
      )
      expect(res.status).toBe(200)
      devuelto = res.body.data.map((d) => d.devuelto).join(',')
    })

    expect(devuelto, 'alguna entrega tiene devoluciones').toContain('1000.00')
    anotar('deudas netas', ms)
  })

  it('el listado de devoluciones está paginado', async () => {
    const cookie = await sessionCookie(fx.admin)
    let cuantas = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{ data: unknown[]; pagination: { total: number } }>(
        DEVOLUCIONES,
        '/api/devoluciones?page=1&pageSize=25',
        { cookie },
      )
      expect(res.status).toBe(200)
      cuantas = res.body.data.length
      expect(res.body.pagination.total).toBeGreaterThanOrEqual(DEVUELTAS)
    })

    expect(cuantas, 'una página, no cinco mil filas').toBe(25)
    anotar('listado de devoluciones', ms)
  })

  it('el detalle de una orden con sus entregas y lo devuelto', async () => {
    const cookie = await sessionCookie(fx.admin)
    let conDevolucion = 0

    const ms = await cuantoTarda(async () => {
      const res = await call<{
        receipts: Array<{
          financiero?: { devuelto: string; neto: string }
          items: Array<{ returnedQuantity: string; netQuantity: string }>
        }>
      }>(ORDEN, `/api/purchases/${String(ordenGorda)}`, {
        cookie,
        params: { id: String(ordenGorda) },
      })
      expect(res.status).toBe(200)
      conDevolucion = res.body.receipts.filter((r) => r.financiero?.devuelto !== '0.00').length
    })

    expect(conDevolucion, 'alguna entrega volvió').toBeGreaterThan(0)
    anotar('detalle de recepción con devoluciones', ms)
  })

  it('la ficha del proveedor cuenta anticipos y devoluciones', async () => {
    const cookie = await sessionCookie(fx.admin)
    let resumen: { sinImputar: string; devoluciones: number } | null = null

    const ms = await cuantoTarda(async () => {
      const res = await call<{ sinImputar: string; devoluciones: number }>(
        RESUMEN,
        `/api/suppliers/${String(proveedorGordo)}/cuenta/resumen`,
        { cookie, params: { id: String(proveedorGordo) } },
      )
      expect(res.status).toBe(200)
      resumen = res.body
    })

    expect(resumen, 'la ficha respondió').not.toBeNull()
    anotar('resumen de la ficha', ms)
  })

  it('imprime lo medido', () => {
    const lineas = MEDIDO.map(
      (m) => `  ${m.que.padEnd(38)} ${String(m.ms).padStart(5)} ms   (tope ${String(m.tope)})`,
    )
    console.log(`\nRENDIMIENTO — devoluciones y anticipos\n${lineas.join('\n')}\n`)
    expect(MEDIDO.length).toBe(5)
  })
})
