/**
 * Objetivo 34 — el libro de proveedores bajo concurrencia.
 *
 * Estos tests fallan de forma INTERMITENTE si la implementacion es incorrecta,
 * no siempre. Por eso cada caso repite la operacion varias veces: una sola
 * pasada puede no llegar a solapar.
 *
 * El caso que da sentido a todo el archivo, y es el espejo exacto del limite de
 * credito de la Fase 4A:
 *
 *   SE LE DEBEN $50.000 A UN PROVEEDOR. DOS PERSONAS LE PAGAN $40.000 AL MISMO
 *   TIEMPO. NUNCA PUEDE TERMINAR HABIENDOLE PAGADO $80.000.
 *
 * La version ingenua --leer el saldo, comparar en JavaScript, escribir-- deja
 * un hueco entre la lectura y la escritura: las dos leen "entra", las dos
 * deciden "entra", y terminamos pagando de mas. Ese hueco no se cierra con mas
 * comprobaciones: se cierra no teniendolo, y por eso la condicion
 * `balance + delta >= 0` viaja DENTRO de la misma sentencia que mueve el saldo.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

import { POST as CREAR_ORDEN } from '@/app/api/purchases/route'
import { POST as CONFIRMAR } from '@/app/api/purchases/[id]/confirm/route'
import { POST as RECIBIR } from '@/app/api/purchases/[id]/receive/route'
import { POST as PAGAR } from '@/app/api/suppliers/[id]/pagos/route'
import { POST as AJUSTAR } from '@/app/api/suppliers/[id]/ajuste/route'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

/** Deja al proveedor con el saldo pedido, por la puerta oficial. */
async function ponerSaldo(monto: string) {
  await call(AJUSTAR, `/api/suppliers/${String(fx.proveedor.id)}/ajuste`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(fx.proveedor.id) },
    body: { delta: monto, reason: 'Preparación del escenario de concurrencia' },
  })
}

async function pagar(monto: string, extra: Record<string, unknown> = {}) {
  return call<{ resultingBalance: string }>(
    PAGAR,
    `/api/suppliers/${String(fx.proveedor.id)}/pagos`,
    {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
      body: { imputacion: 'automatica', amount: monto, method: 'TRANSFER', ...extra },
    },
  )
}

/** Una orden confirmada, lista para recibir. Devuelve el id de orden y de linea. */
async function ordenLista(cajas: string, costo: string) {
  const cookie = await sessionCookie(fx.admin)
  const orden = await call<{ id: number }>(CREAR_ORDEN, '/api/purchases', {
    method: 'POST',
    cookie,
    body: {
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoCaja.id, quantity: cajas, unitCost: costo }],
    },
  })
  const c = await call<{ items: Array<{ id: number }> }>(
    CONFIRMAR,
    `/api/purchases/${String(orden.body.id)}/confirm`,
    { method: 'POST', cookie, params: { id: String(orden.body.id) } },
  )
  return { orderId: orden.body.id, lineaId: c.body.items[0]?.id ?? 0 }
}

async function saldo(): Promise<number> {
  const p = await prisma.supplier.findUniqueOrThrow({
    where: { id: fx.proveedor.id },
    select: { balance: true },
  })
  return Number(p.balance.toFixed(2))
}

/** El saldo reconstruido sumando el libro. Tiene que dar lo mismo. */
async function saldoSegunElLibro(): Promise<number> {
  const filas = await prisma.$queryRaw<Array<{ total: string }>>`
    SELECT COALESCE(sum("amount"), 0)::numeric(14,2)::text AS total
      FROM "SupplierAccountMovement" WHERE "supplierId" = ${fx.proveedor.id}
  `
  return Number(filas[0]?.total ?? '0')
}

/** Que el libro este ENCADENADO: cada fila arranca donde termino la anterior. */
async function cadenaRota(): Promise<number> {
  const filas = await prisma.$queryRaw<Array<{ n: bigint }>>`
    WITH ordenado AS (
      SELECT "id", "previousBalance",
             lag("resultingBalance") OVER (ORDER BY "id") AS anterior
        FROM "SupplierAccountMovement"
       WHERE "supplierId" = ${fx.proveedor.id}
    )
    SELECT count(*)::bigint AS n FROM ordenado
     WHERE "previousBalance" <> COALESCE(anterior, 0)
  `
  return Number(filas[0]?.n ?? 0)
}

// ===========================================================================
// 1. Dos pagos simultaneos
// ===========================================================================

describe('Dos pagos simultáneos', () => {
  it('con $50.000 de deuda, dos pagos de $40.000 no terminan en -$30.000', async () => {
    // Cinco vueltas: una sola puede no llegar a solapar.
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      fx = await seedFixture()
      await ponerSaldo('50000')

      const [a, b] = await Promise.all([pagar('40000'), pagar('40000')])

      const final = await saldo()
      const aceptados = [a, b].filter((r) => r.status === 201).length

      expect(
        final,
        `vuelta ${String(vuelta)}: nunca se le puede pagar mas de lo que se le debe`,
      ).toBeGreaterThanOrEqual(0)

      expect(aceptados, 'uno entra y el otro se rechaza con 409').toBe(1)
      expect(final).toBe(10000)
      expect(await saldoSegunElLibro()).toBe(final)
      expect(await cadenaRota()).toBe(0)
    }
  })

  it('los dos pagos entran si el sobrepago esta autorizado', async () => {
    await ponerSaldo('50000')

    const [a, b] = await Promise.all([
      pagar('40000', { acceptCredit: true }),
      pagar('40000', { acceptCredit: true }),
    ])

    expect([a.status, b.status]).toEqual([201, 201])
    expect(await saldo(), 'con autorizacion, el saldo puede quedar negativo').toBe(-30000)
    expect(await saldoSegunElLibro()).toBe(-30000)
    expect(await cadenaRota(), 'el libro sigue encadenado').toBe(0)
  })
})

// ===========================================================================
// 2. Recepcion y pago a la vez
// ===========================================================================

describe('Recepción y pago a la vez', () => {
  it('el libro queda encadenado y el saldo cierra', async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      fx = await seedFixture()
      await ponerSaldo('50000')
      const { orderId, lineaId } = await ordenLista('10', '12000')
      const cookie = await sessionCookie(fx.admin)

      await Promise.all([
        call(RECIBIR, `/api/purchases/${String(orderId)}/receive`, {
          method: 'POST',
          cookie,
          params: { id: String(orderId) },
          body: { items: [{ orderItemId: lineaId, quantity: '10' }] },
        }),
        pagar('30000'),
      ])

      // 50.000 + 120.000 - 30.000 = 140.000, sin importar el orden.
      expect(await saldo(), `vuelta ${String(vuelta)}`).toBe(140000)
      expect(await saldoSegunElLibro()).toBe(140000)
      expect(await cadenaRota(), 'ninguna fila arranca donde no termino la anterior').toBe(0)
    }
  })
})

// ===========================================================================
// 3. Dos recepciones a la vez
// ===========================================================================

describe('Dos recepciones a la vez', () => {
  it('el saldo crece por las dos, y cada una deja su propio cargo', async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      fx = await seedFixture()
      const cookie = await sessionCookie(fx.admin)
      const una = await ordenLista('10', '12000')
      const otra = await ordenLista('5', '10000')

      await Promise.all([
        call(RECIBIR, `/api/purchases/${String(una.orderId)}/receive`, {
          method: 'POST',
          cookie,
          params: { id: String(una.orderId) },
          body: { items: [{ orderItemId: una.lineaId, quantity: '10' }] },
        }),
        call(RECIBIR, `/api/purchases/${String(otra.orderId)}/receive`, {
          method: 'POST',
          cookie,
          params: { id: String(otra.orderId) },
          body: { items: [{ orderItemId: otra.lineaId, quantity: '5' }] },
        }),
      ])

      expect(await saldo(), `vuelta ${String(vuelta)}: 120.000 + 50.000`).toBe(170000)
      expect(await saldoSegunElLibro()).toBe(170000)
      expect(await cadenaRota()).toBe(0)

      const cargos = await prisma.supplierAccountMovement.count({
        where: { supplierId: fx.proveedor.id, type: 'PURCHASE_CHARGE' },
      })
      expect(cargos, 'una entrega, un cargo').toBe(2)
    }
  })
})

// ===========================================================================
// 4. Imputacion
// ===========================================================================

describe('Imputación', () => {
  it('dos pagos no pueden cancelar dos veces el mismo importe pendiente', async () => {
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      fx = await seedFixture()
      const cookie = await sessionCookie(fx.admin)
      const { orderId, lineaId } = await ordenLista('10', '12000')

      const recepcion = await call<{ receiptId: number }>(
        RECIBIR,
        `/api/purchases/${String(orderId)}/receive`,
        {
          method: 'POST',
          cookie,
          params: { id: String(orderId) },
          body: { items: [{ orderItemId: lineaId, quantity: '10' }] },
        },
      )
      const receiptId = recepcion.body.receiptId

      // Los dos imputan A MANO los 120.000 completos a la misma entrega. Si la
      // comprobacion del pendiente ocurriera fuera de la transaccion, los dos
      // verian "faltan 120.000" y los dos entrarian.
      const manual = {
        imputacion: 'manual',
        method: 'TRANSFER',
        amount: '120000',
        allocations: [{ receiptId, amount: '120000' }],
      }
      await Promise.all([
        pagar('120000', manual),
        pagar('120000', { ...manual, acceptCredit: true }),
      ])

      const imputado = await prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(sum("amount"), 0)::numeric(14,2)::text AS total
          FROM "SupplierPaymentAllocation" WHERE "receiptId" = ${receiptId}
      `
      expect(
        Number(imputado[0]?.total ?? '0'),
        `vuelta ${String(vuelta)}: no se puede imputar mas que lo que costo la entrega`,
      ).toBeLessThanOrEqual(120000)
    }
  })
})
