/**
 * El libro de inventario bajo concurrencia.
 *
 * Dos propiedades, y ninguna de las dos admite excepciones:
 *
 *   1. BranchStock.quantity == resultingQuantity del ULTIMO movimiento
 *   2. quantity nunca es negativo
 *
 * La primera es mas fuerte que "la suma cuadra": exige que la cadena de
 * movimientos sea CONTINUA. Si dos operaciones simultaneas leen el mismo saldo
 * y escriben cada una el suyo, la suma puede seguir cuadrando de casualidad
 * mientras los saldos intermedios cuentan una historia que nunca paso.
 *
 * Estos tests fallan de forma intermitente si la implementacion es incorrecta,
 * no siempre. Por eso cada caso repite la operacion varias veces: una sola
 * pasada puede no llegar a solapar.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Prisma } from '@prisma/client'
import { seedFixture, prisma, stockOf, ponerStock, type Fixture, num } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function vender(qty = 1) {
  const { POST } = await import('@/app/api/sales/route')
  return call<{ id: number }>(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body: { items: [{ productId: fx.productoA.id, quantity: qty }], paymentMethod: 'efectivo' },
  })
}

async function ajustar(delta: number, tipo = 'MANUAL_ADJUSTMENT') {
  const { PATCH } = await import('@/app/api/stock/[id]/route')
  return call(PATCH, `/api/stock/${String(fx.productoA.id)}`, {
    method: 'PATCH',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(fx.productoA.id) },
    body: { delta, type: tipo, reason: 'Ajuste concurrente' },
  })
}

async function anular(saleId: number) {
  const { POST } = await import('@/app/api/sales/[id]/cancel/route')
  return call(POST, `/api/sales/${String(saleId)}/cancel`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(saleId) },
    body: { reason: 'Anulacion concurrente' },
  })
}

/**
 * Las dos propiedades, comprobadas juntas.
 *
 * Devuelve el saldo para que el caso pueda ademas afirmar cuanto tiene que ser.
 */
async function exigirCadenaContinua(): Promise<number> {
  const saldo = await stockOf(fx.branchA.id, fx.productoA.id)

  expect(saldo, 'el stock quedo negativo').toBeGreaterThanOrEqual(0)

  const movimientos = await prisma.stockMovement.findMany({
    where: { branchId: fx.branchA.id, productId: fx.productoA.id },
    orderBy: { id: 'asc' },
  })

  const ultimo = movimientos[movimientos.length - 1]
  expect(
    num(ultimo?.resultingQuantity),
    'el saldo no coincide con el ultimo movimiento del libro: alguien escribio stock sin registrarlo',
  ).toBe(saldo)

  // Y la cadena, eslabon por eslabon.
  for (let i = 1; i < movimientos.length; i++) {
    expect(
      num(movimientos[i]?.previousQuantity),
      `el movimiento ${String(movimientos[i]?.id)} arranca en ${String(movimientos[i]?.previousQuantity)}, ` +
        `pero el anterior termino en ${String(movimientos[i - 1]?.resultingQuantity)}: ` +
        'dos operaciones leyeron el mismo saldo',
    ).toBe(num(movimientos[i - 1]?.resultingQuantity))
  }

  // Y la suma, que es la propiedad global.
  const suma = movimientos.reduce((acc, m) => acc.plus(m.quantity), new Prisma.Decimal(0))
  expect(suma.toFixed(3), 'la suma del libro no da el saldo').toBe(saldo.toFixed(3))

  return saldo
}

describe('Dos operaciones sobre la ultima unidad', () => {
  it('dos ventas simultaneas del ultimo producto: una sola pasa', async () => {
    for (let intento = 0; intento < 5; intento++) {
      fx = await seedFixture()
      await ponerStock(fx.branchA.id, fx.productoA.id, 1, fx.admin.id)

      const [a, b] = await Promise.all([vender(1), vender(1)])
      const exitosas = [a, b].filter((r) => r.status < 300).length

      expect(exitosas, 'se vendio la ultima unidad dos veces').toBe(1)
      expect(await exigirCadenaContinua()).toBe(0)
    }
  }, 60_000)

  it('diez ventas concurrentes dejan diez movimientos encadenados', async () => {
    await ponerStock(fx.branchA.id, fx.productoA.id, 50, fx.admin.id)

    const N = 10
    const resultados = await Promise.all(Array.from({ length: N }, () => vender(1)))
    expect(resultados.filter((r) => r.status < 300)).toHaveLength(N)

    expect(await exigirCadenaContinua()).toBe(40)
    expect(await prisma.stockMovement.count({ where: { type: 'SALE' } })).toBe(N)
  }, 60_000)

  it('diez ventas por las ultimas tres unidades: pasan exactamente tres', async () => {
    for (let intento = 0; intento < 3; intento++) {
      fx = await seedFixture()
      await ponerStock(fx.branchA.id, fx.productoA.id, 3, fx.admin.id)

      const resultados = await Promise.all(Array.from({ length: 10 }, () => vender(1)))
      const exitosas = resultados.filter((r) => r.status < 300).length

      expect(exitosas, 'se sobrevendio').toBe(3)
      expect(await exigirCadenaContinua()).toBe(0)
    }
  }, 60_000)
})

describe('Operaciones de distinto tipo a la vez', () => {
  it('venta y ajuste simultaneos no se pisan', async () => {
    for (let intento = 0; intento < 5; intento++) {
      fx = await seedFixture()
      await ponerStock(fx.branchA.id, fx.productoA.id, 20, fx.admin.id)

      const [venta, ajuste] = await Promise.all([vender(3), ajustar(7)])
      expect(venta.status).toBeLessThan(300)
      expect(ajuste.status).toBeLessThan(300)

      // 20 - 3 + 7 = 24, sin importar en que orden se resolvieron.
      expect(await exigirCadenaContinua()).toBe(24)
    }
  }, 60_000)

  it('venta y anulacion de otra venta a la vez', async () => {
    for (let intento = 0; intento < 5; intento++) {
      fx = await seedFixture()
      await ponerStock(fx.branchA.id, fx.productoA.id, 20, fx.admin.id)

      const primera = await vender(4) // 20 → 16
      expect(primera.status).toBeLessThan(300)

      const [segunda, anulacion] = await Promise.all([vender(2), anular(primera.body.id)])
      expect(segunda.status).toBeLessThan(300)
      expect(anulacion.status).toBeLessThan(300)

      // 16 - 2 + 4 = 18.
      expect(await exigirCadenaContinua()).toBe(18)
    }
  }, 60_000)

  it('dos ajustes simultaneos suman los dos', async () => {
    for (let intento = 0; intento < 5; intento++) {
      fx = await seedFixture()
      await ponerStock(fx.branchA.id, fx.productoA.id, 10, fx.admin.id)

      const [a, b] = await Promise.all([ajustar(5), ajustar(-3, 'LOSS')])
      expect(a.status).toBeLessThan(300)
      expect(b.status).toBeLessThan(300)

      expect(await exigirCadenaContinua()).toBe(12)
    }
  }, 60_000)

  it('dos anulaciones simultaneas de la misma venta devuelven el stock una sola vez', async () => {
    for (let intento = 0; intento < 5; intento++) {
      fx = await seedFixture()
      const venta = await vender(4) // 10 → 6

      const [a, b] = await Promise.all([anular(venta.body.id), anular(venta.body.id)])
      const exitosas = [a, b].filter((r) => r.status < 300).length

      expect(exitosas, 'la venta se anulo dos veces').toBe(1)
      expect(await exigirCadenaContinua()).toBe(10)
      expect(await prisma.stockMovement.count({ where: { type: 'SALE_CANCEL' } })).toBe(1)
    }
  }, 60_000)
})
