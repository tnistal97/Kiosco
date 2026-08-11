/**
 * Objetivo 28 — anticipos y devoluciones bajo concurrencia.
 *
 * Estos tests fallan de forma INTERMITENTE si la implementación es incorrecta,
 * no siempre. Por eso cada caso repite la operación varias veces: una sola
 * pasada puede no llegar a solapar.
 *
 * Los cuatro casos del objetivo, y lo que protege a cada uno:
 *
 *   1. DOS IMPUTACIONES del mismo anticipo de $50.000, de $40.000 cada una.
 *      Nunca pueden terminar imputados $80.000. Lo cierra el bloqueo de la fila
 *      del pago, tomado ANTES de sumar sus imputaciones.
 *
 *   2. DOS DEVOLUCIONES de 8 sobre 10 retornables. Nunca pueden salir 16. Lo
 *      cierra el bloqueo de la línea de la recepción, tomado antes de sumar lo
 *      ya devuelto.
 *
 *   3. VENTA Y DEVOLUCIÓN a la vez sobre el mismo stock. Nunca puede quedar
 *      negativo. Lo cierra la condición `quantity + delta >= 0` del libro de
 *      inventario, que viaja dentro de la misma sentencia que descuenta.
 *
 *   4. DEVOLUCIÓN Y PAGO a la vez. El libro del proveedor tiene que quedar
 *      continuo: cada fila apoyada en la anterior, sin huecos ni saltos.
 *
 * La diferencia con las fronteras anteriores es que acá el tope NO vive en la
 * fila que se escribe --es la suma de otra tabla-- y por eso no se puede
 * resolver con un `UPDATE ... WHERE`. Ver src/modules/suppliers/imputacion.ts.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

import { POST as CREAR_ORDEN } from '@/app/api/purchases/route'
import { POST as CONFIRMAR } from '@/app/api/purchases/[id]/confirm/route'
import { POST as RECIBIR } from '@/app/api/purchases/[id]/receive/route'
import { POST as PAGAR } from '@/app/api/suppliers/[id]/pagos/route'
import { POST as IMPUTAR } from '@/app/api/suppliers/[id]/pagos/[pagoId]/imputar/route'
import { GET as RETORNABLES } from '@/app/api/purchases/recepciones/[id]/retornables/route'
import { POST as CREAR_DEVOLUCION } from '@/app/api/devoluciones/route'
import { POST as CONFIRMAR_DEVOLUCION } from '@/app/api/devoluciones/[id]/confirmar/route'
import { POST as VENDER } from '@/app/api/sales/route'

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

/** Una entrega recibida entera. `unidades x costo` da el importe. */
async function recibir(unidades: string, costo: string): Promise<{ receiptId: number }> {
  const cookie = await sessionCookie(fx.admin)

  const orden = await call<{ id: number }>(CREAR_ORDEN, '/api/purchases', {
    method: 'POST',
    cookie,
    body: {
      supplierId: fx.proveedor.id,
      items: [
        {
          productId: fx.productoCaja.id,
          quantity: unidades,
          unitCost: costo,
          // Por unidad, para que las cuentas del escenario sean directas.
          purchaseUnit: 'UNIT',
          unitsPerPurchaseUnit: '1',
        },
      ],
    },
  })

  const confirmada = await call<{ items: Array<{ id: number }> }>(
    CONFIRMAR,
    `/api/purchases/${String(orden.body.id)}/confirm`,
    { method: 'POST', cookie, params: { id: String(orden.body.id) } },
  )

  const res = await call<{ receiptId: number }>(
    RECIBIR,
    `/api/purchases/${String(orden.body.id)}/receive`,
    {
      method: 'POST',
      cookie,
      params: { id: String(orden.body.id) },
      body: { items: [{ orderItemId: confirmada.body.items[0]?.id, quantity: unidades }] },
    },
  )
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

async function anticipo(importe: string) {
  return call<{ id: number; number: string }>(
    PAGAR,
    `/api/suppliers/${String(fx.proveedor.id)}/pagos`,
    {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
      body: {
        imputacion: 'ninguna',
        amount: importe,
        method: 'TRANSFER',
        acceptCredit: true,
      },
    },
  )
}

async function imputar(paymentId: number, receiptId: number, importe: string) {
  return call(
    IMPUTAR,
    `/api/suppliers/${String(fx.proveedor.id)}/pagos/${String(paymentId)}/imputar`,
    {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id), pagoId: String(paymentId) },
      body: { allocations: [{ receiptId, amount: importe }] },
    },
  )
}

/** Un borrador de devolución, listo para confirmar. */
async function borrador(receiptId: number, cantidad: string): Promise<number> {
  const cookie = await sessionCookie(fx.admin)

  const r = await call<{ lineas: Array<{ receiptItemId: number }> }>(
    RETORNABLES,
    `/api/purchases/recepciones/${String(receiptId)}/retornables`,
    { cookie, params: { id: String(receiptId) } },
  )

  const d = await call<{ id: number }>(CREAR_DEVOLUCION, '/api/devoluciones', {
    method: 'POST',
    cookie,
    body: {
      purchaseReceiptId: receiptId,
      reason: 'DAMAGED',
      items: [{ receiptItemId: r.body.lineas[0]?.receiptItemId, quantity: cantidad }],
    },
  })
  expect(d.status, JSON.stringify(d.body)).toBe(201)
  return d.body.id
}

async function confirmarDevolucion(id: number) {
  return call(CONFIRMAR_DEVOLUCION, `/api/devoluciones/${String(id)}/confirmar`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(id) },
  })
}

async function stock(): Promise<number> {
  const s = await prisma.branchStock.findUniqueOrThrow({
    where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoCaja.id } },
    select: { quantity: true },
  })
  return Number(s.quantity)
}

// ===========================================================================
// 1. Dos imputaciones del mismo anticipo
// ===========================================================================

describe('Dos imputaciones simultáneas del mismo pago', () => {
  it('nunca terminan imputando más de lo que el pago tiene', async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      fx = await seedFixture()

      const pago = await anticipo('50000')
      // Dos entregas distintas: si apuntaran a la misma, el tope de la entrega
      // frenaría a la segunda y la prueba mediría otra cosa.
      const a = await recibir('40', '1000')
      const b = await recibir('40', '1000')

      const [uno, dos] = await Promise.all([
        imputar(pago.body.id, a.receiptId, '40000'),
        imputar(pago.body.id, b.receiptId, '40000'),
      ])

      const ok = [uno, dos].filter((r) => r.status === 201)
      const rechazados = [uno, dos].filter((r) => r.status === 409)

      expect(ok, `vuelta ${String(vuelta)}: una entra`).toHaveLength(1)
      expect(rechazados, `vuelta ${String(vuelta)}: la otra no`).toHaveLength(1)

      const imputado = await prisma.supplierPaymentAllocation.aggregate({
        where: { paymentId: pago.body.id },
        _sum: { amount: true },
      })
      expect(
        Number(imputado._sum.amount ?? 0),
        `vuelta ${String(vuelta)}: nunca 80.000`,
      ).toBeLessThanOrEqual(50000)
      expect(Number(imputado._sum.amount ?? 0)).toBe(40000)
    }
  })

  it('dos imputaciones a la MISMA entrega tampoco la cancelan dos veces', async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      fx = await seedFixture()

      const a = await anticipo('60000')
      const b = await anticipo('60000')
      const r = await recibir('50', '1000')

      const [uno, dos] = await Promise.all([
        imputar(a.body.id, r.receiptId, '40000'),
        imputar(b.body.id, r.receiptId, '40000'),
      ])

      expect([uno, dos].filter((x) => x.status === 201)).toHaveLength(1)

      const imputado = await prisma.supplierPaymentAllocation.aggregate({
        where: { receiptId: r.receiptId },
        _sum: { amount: true },
      })
      expect(
        Number(imputado._sum.amount ?? 0),
        `vuelta ${String(vuelta)}: la entrega vale 50.000`,
      ).toBeLessThanOrEqual(50000)
    }
  })
})

// ===========================================================================
// 2. Dos devoluciones sobre la misma mercadería
// ===========================================================================

describe('Dos devoluciones simultáneas', () => {
  it('nunca devuelven más de lo que llegó', async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      fx = await seedFixture()

      const r = await recibir('10', '1000')
      const uno = await borrador(r.receiptId, '8')
      const dos = await borrador(r.receiptId, '8')

      const [a, b] = await Promise.all([confirmarDevolucion(uno), confirmarDevolucion(dos)])

      const ok = [a, b].filter((x) => x.status === 200)
      expect(ok, `vuelta ${String(vuelta)}: solo una`).toHaveLength(1)

      const devuelto = await prisma.purchaseReturnItem.aggregate({
        where: { return: { status: 'CONFIRMED' } },
        _sum: { quantity: true },
      })
      expect(
        Number(devuelto._sum.quantity ?? 0),
        `vuelta ${String(vuelta)}: nunca 16`,
      ).toBeLessThanOrEqual(10)
      expect(Number(devuelto._sum.quantity ?? 0)).toBe(8)
    }
  })
})

// ===========================================================================
// 3. Venta y devolución sobre el mismo stock
// ===========================================================================

describe('Venta y devolución a la vez', () => {
  it('el stock nunca queda negativo', async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      fx = await seedFixture()

      // Se deja el stock en 10 exactos: se vende todo lo que la fixture trae y
      // después entran 10 por una entrega. Es el escenario del objetivo.
      const inicial = await stock()
      const cookie = await sessionCookie(fx.admin)
      await call(VENDER, '/api/sales', {
        method: 'POST',
        cookie,
        body: {
          items: [{ productId: fx.productoCaja.id, quantity: String(inicial) }],
          payments: [
            { method: 'CASH', amount: (Number(fx.productoCaja.price) * inicial).toFixed(2) },
          ],
        },
      })

      const r = await recibir('10', '1000')
      expect(await stock()).toBe(10)

      const devolucion = await borrador(r.receiptId, '5')

      const [venta, dev] = await Promise.all([
        call(VENDER, '/api/sales', {
          method: 'POST',
          cookie,
          body: {
            items: [{ productId: fx.productoCaja.id, quantity: '8' }],
            payments: [{ method: 'CASH', amount: (Number(fx.productoCaja.price) * 8).toFixed(2) }],
          },
        }),
        confirmarDevolucion(devolucion),
      ])

      // Las dos juntas piden 13 de 10. Al menos una tiene que caer, y la que
      // caiga no puede haber dejado rastro.
      const entraron = [venta.status === 201, dev.status === 200].filter(Boolean).length
      expect(entraron, `vuelta ${String(vuelta)}: 8 + 5 no entran en 10`).toBe(1)
      expect(await stock(), `vuelta ${String(vuelta)}: nunca negativo`).toBeGreaterThanOrEqual(0)
    }
  })
})

// ===========================================================================
// 4. Devolución y pago a la vez
// ===========================================================================

describe('Devolución y pago a la vez', () => {
  it('el libro del proveedor queda continuo', async () => {
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      fx = await seedFixture()

      const r = await recibir('100', '1000')
      const devolucion = await borrador(r.receiptId, '20')

      await Promise.all([
        confirmarDevolucion(devolucion),
        call(PAGAR, `/api/suppliers/${String(fx.proveedor.id)}/pagos`, {
          method: 'POST',
          cookie: await sessionCookie(fx.admin),
          params: { id: String(fx.proveedor.id) },
          body: { imputacion: 'automatica', amount: '30000', method: 'TRANSFER' },
        }),
      ])

      // La invariante del libro: cada fila apoyada en la anterior, y la suma
      // igual al saldo. Es lo que la reconciliación mira, comprobado acá bajo
      // dos escrituras que compitieron por la misma fila.
      const movimientos = await prisma.supplierAccountMovement.findMany({
        where: { supplierId: fx.proveedor.id },
        orderBy: { id: 'asc' },
        select: { amount: true, previousBalance: true, resultingBalance: true },
      })

      let esperado = 0
      for (const [i, m] of movimientos.entries()) {
        expect(Number(m.previousBalance), `vuelta ${String(vuelta)}, fila ${String(i)}`).toBe(
          esperado,
        )
        esperado = Number(m.resultingBalance)
        expect(Number(m.resultingBalance)).toBe(Number(m.previousBalance) + Number(m.amount))
      }

      const proveedor = await prisma.supplier.findUniqueOrThrow({
        where: { id: fx.proveedor.id },
        select: { balance: true },
      })
      expect(Number(proveedor.balance), `vuelta ${String(vuelta)}`).toBe(esperado)
    }
  })
})
