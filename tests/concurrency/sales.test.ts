/**
 * Caso critico 9 — dos ventas simultaneas no pierden actualizaciones de caja
 * ni de stock.
 *
 * Estos tests fallan de forma intermitente si la implementacion es incorrecta,
 * no siempre. Por eso cada caso repite la operacion varias veces: una sola
 * pasada puede no llegar a solapar.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, stockOf, cashOf, type Fixture } from '../helpers/db'
import { multiplicarMonto } from '@/lib/money'
import { aMonto, sumaODefecto } from '@/server/money'
import { call, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function venderUna(qty = 1, method: string = 'efectivo') {
  const { POST } = await import('@/app/api/sales/route')
  return call(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body: {
      items: [{ productId: fx.productoA.id, quantity: qty }],
      paymentMethod: method,
    },
  })
}

describe('Caso 9 — ventas simultaneas', () => {
  it('diez ventas en paralelo suman diez veces en caja', async () => {
    await prisma.branchStock.update({
      where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
      data: { quantity: 50 },
    })

    const N = 10
    const resultados = await Promise.all(Array.from({ length: N }, () => venderUna(1)))
    const exitosas = resultados.filter((r) => r.status < 300).length

    expect(exitosas, 'Alguna venta fallo sin motivo').toBe(N)

    expect(
      await cashOf(fx.branchA.id),
      'Se perdieron actualizaciones de caja: dos ventas leyeron el mismo saldo',
    ).toBe(multiplicarMonto(fx.productoA.price, N))

    expect(await stockOf(fx.branchA.id, fx.productoA.id), 'Se perdieron descuentos de stock').toBe(
      50 - N,
    )

    expect(await prisma.sale.count()).toBe(N)
    expect(await prisma.cashRegisterMovement.count()).toBe(N)
  })

  it('el stock no se sobrevende cuando muchas ventas compiten por las ultimas unidades', async () => {
    // 3 unidades, 10 intentos de comprar 1 cada uno.
    await prisma.branchStock.update({
      where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
      data: { quantity: 3 },
    })

    const resultados = await Promise.all(Array.from({ length: 10 }, () => venderUna(1)))
    const exitosas = resultados.filter((r) => r.status < 300).length

    expect(exitosas, 'Se vendieron mas unidades de las que habia').toBe(3)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(0)
    expect(await prisma.sale.count()).toBe(3)
    expect(await cashOf(fx.branchA.id)).toBe(multiplicarMonto(fx.productoA.price, 3))
  })

  it('el stock nunca queda negativo bajo carga', async () => {
    await prisma.branchStock.update({
      where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
      data: { quantity: 5 },
    })

    await Promise.all(Array.from({ length: 12 }, () => venderUna(2)))

    const stock = await stockOf(fx.branchA.id, fx.productoA.id)
    expect(stock).toBeGreaterThanOrEqual(0)

    // Coherencia final: unidades vendidas + stock restante = stock inicial.
    const vendidas = await prisma.saleItem.aggregate({ _sum: { quantity: true } })
    expect((vendidas._sum.quantity ?? 0) + stock).toBe(5)
  })

  it('la caja refleja exactamente la suma de los movimientos', async () => {
    await prisma.branchStock.update({
      where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
      data: { quantity: 40 },
    })

    // Mezcla de medios de pago: solo el efectivo mueve currentCash.
    await Promise.all([
      ...Array.from({ length: 6 }, () => venderUna(1, 'efectivo')),
      ...Array.from({ length: 6 }, () => venderUna(1, 'tarjeta')),
    ])

    const efectivo = await prisma.cashRegisterMovement.aggregate({
      where: { branchId: fx.branchA.id, paymentMethod: 'efectivo' },
      _sum: { amount: true },
    })

    expect(await cashOf(fx.branchA.id)).toBe(aMonto(sumaODefecto(efectivo._sum.amount)))
  })
})
