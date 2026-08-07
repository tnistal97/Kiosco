/**
 * Pagos de una venta, y pago combinado.
 *
 * El caso obligatorio de la fase, escrito una sola vez y en mayusculas porque
 * es el que resume todo:
 *
 *   UNA VENTA DE $20.000 POR TRANSFERENCIA MAS $10.000 EN EFECTIVO
 *   AUMENTA LA CAJA EN $10.000, NO EN $30.000.
 *
 * Y la regla que lo hace posible: la suma de los pagos es EXACTAMENTE el total.
 * No "aproximadamente". Por eso el dinero se migro a Decimal antes que esto.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, cashOf, expectedOfShift, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'
import { multiplicarMonto, sumarMontos } from '@/lib/money'
import { aMonto, dinero, sumaODefecto } from '@/server/money'
import { MEDIO_EFECTIVO } from '@/modules/sales/payment-methods'

import { POST as CREAR_VENTA } from '@/app/api/sales/route'
import { POST as ANULAR } from '@/app/api/sales/[id]/cancel/route'

interface PagoDeRespuesta {
  method: string
  label: string
  amount: string
  cashReceived: string | null
  changeGiven: string | null
}
interface VentaCreada {
  id: number
  total: string
  payments: PagoDeRespuesta[]
  cashCollected: string
  changeGiven: string
}

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  // Precio redondo: las cuentas de esta suite hablan de $30.000, no de
  // multiplos de 12.500.
  await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: '10000.00' } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function vender(body: unknown) {
  return call<VentaCreada>(CREAR_VENTA, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body,
  })
}

/** Tres unidades a $10.000: total $30.000. */
function tresUnidades() {
  return [{ productId: fx.productoA.id, quantity: 3 }]
}

describe('EL caso: efectivo mas transferencia', () => {
  it('la caja sube SOLO por el efectivo', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'TRANSFER', amount: '20000.00' },
        { method: 'CASH', amount: '10000.00' },
      ],
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.total).toBe('30000.00')
    expect(res.body.cashCollected).toBe('10000.00')

    expect(await cashOf(fx.branchA.id), 'La caja fisica no puede subir por una transferencia').toBe(
      '10000.00',
    )
    expect(await expectedOfShift(fx.branchA.id)).toBe('10000.00')
  })

  it('quedan dos pagos guardados, con su medio y su importe', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'TRANSFER', amount: '20000.00', reference: 'Op. 4471' },
        { method: 'CASH', amount: '10000.00' },
      ],
    })

    const pagos = await prisma.salePayment.findMany({
      where: { saleId: res.body.id },
      orderBy: { id: 'asc' },
    })

    expect(pagos).toHaveLength(2)
    expect(pagos[0]?.method).toBe('TRANSFER')
    expect(aMonto(pagos[0]?.amount ?? dinero(0))).toBe('20000.00')
    expect(pagos[0]?.reference).toBe('Op. 4471')
    expect(pagos[1]?.method).toBe('CASH')
    expect(aMonto(pagos[1]?.amount ?? dinero(0))).toBe('10000.00')
  })

  it('el movimiento de caja es uno por medio, no uno por venta', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'TRANSFER', amount: '20000.00' },
        { method: 'CASH', amount: '10000.00' },
      ],
    })

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { saleId: res.body.id },
      orderBy: { id: 'asc' },
    })
    expect(movimientos).toHaveLength(2)
    expect(movimientos.map((m) => m.paymentMethod)).toEqual(['TRANSFER', 'CASH'])

    // Y el esperado del turno suma solo el que entro al cajon.
    const efectivo = await prisma.cashRegisterMovement.aggregate({
      where: { saleId: res.body.id, paymentMethod: MEDIO_EFECTIVO },
      _sum: { amount: true },
    })
    expect(aMonto(sumaODefecto(efectivo._sum.amount))).toBe('10000.00')
  })
})

describe('La suma de los pagos es el total', () => {
  it('rechaza cuando falta un centavo', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'TRANSFER', amount: '20000.00' },
        { method: 'CASH', amount: '9999.99' },
      ],
    })

    expect(res.status).toBe(400)
    expect(errorDe(res).code).toBe('PAYMENTS_DO_NOT_MATCH_TOTAL')
    expect(errorDe(res).message).toMatch(/faltan .*0\.01/)
  })

  it('rechaza cuando sobra', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'CASH', amount: '30000.01' }],
    })

    expect(res.status).toBe(400)
    expect(errorDe(res).message).toMatch(/sobran/)
  })

  it('una venta rechazada no descuenta stock ni toca la caja', async () => {
    await vender({
      items: tresUnidades(),
      payments: [{ method: 'CASH', amount: '1.00' }],
    })

    const stock = await prisma.branchStock.findUniqueOrThrow({
      where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
    })
    expect(stock.quantity.toFixed(3)).toBe('10.000')
    expect(await cashOf(fx.branchA.id)).toBe('0.00')
    expect(await prisma.sale.count()).toBe(0)
  })

  it('tres medios con centavos tambien cierran', async () => {
    await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: '19.99' } })

    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 3 }],
      // 59,97 repartido en tres.
      payments: [
        { method: 'CASH', amount: '19.99' },
        { method: 'DEBIT_CARD', amount: '19.99' },
        { method: 'TRANSFER', amount: '19.99' },
      ],
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.total).toBe('59.97')
    expect(await cashOf(fx.branchA.id)).toBe('19.99')
  })
})

describe('Vuelto', () => {
  it('se calcula en el servidor a partir de lo recibido', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'CASH', amount: '30000.00', cashReceived: '50000.00' }],
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.changeGiven).toBe('20000.00')

    const pago = await prisma.salePayment.findFirstOrThrow({ where: { saleId: res.body.id } })
    expect(pago.cashReceived).not.toBeNull()
    expect(aMonto(pago.cashReceived ?? dinero(0))).toBe('50000.00')
    expect(aMonto(pago.changeGiven ?? dinero(0))).toBe('20000.00')
  })

  it('el vuelto NO sale de la caja: el cajon recibio el importe del pago', async () => {
    await vender({
      items: tresUnidades(),
      payments: [{ method: 'CASH', amount: '30000.00', cashReceived: '50000.00' }],
    })

    // Entraron 50.000 y salieron 20.000 de vuelto: neto 30.000. Lo que se
    // registra es el neto, que es lo que queda en el cajon.
    expect(await cashOf(fx.branchA.id)).toBe('30000.00')
  })

  it('recibir menos que el pago se rechaza', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'CASH', amount: '30000.00', cashReceived: '10000.00' }],
    })

    expect(res.status).toBe(400)
    expect(errorDe(res).message).toMatch(/falta plata/i)
  })

  it('una transferencia no puede declarar con cuanto se pago', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'TRANSFER', amount: '30000.00', cashReceived: '50000.00' }],
    })
    expect(res.status).toBe(400)
  })

  it('pagar justo no genera vuelto', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'CASH', amount: '30000.00', cashReceived: '30000.00' }],
    })
    expect(res.body.changeGiven).toBe('0.00')
  })
})

describe('Compatibilidad con la forma anterior', () => {
  it('acepta `paymentMethod` suelto y lo convierte en un pago por el total', async () => {
    const res = await vender({ items: tresUnidades(), paymentMethod: 'efectivo' })

    expect(res.status).toBeLessThan(300)
    expect(res.body.payments).toHaveLength(1)
    expect(res.body.payments[0]?.method).toBe('CASH')
    expect(res.body.payments[0]?.amount).toBe('30000.00')
    expect(await cashOf(fx.branchA.id)).toBe('30000.00')
  })

  it('`mercado_pago` se guarda como transferencia y no toca la caja', async () => {
    const res = await vender({ items: tresUnidades(), paymentMethod: 'mercado_pago' })

    expect(res.status).toBeLessThan(300)
    expect(res.body.payments[0]?.method).toBe('TRANSFER')
    expect(await cashOf(fx.branchA.id)).toBe('0.00')
  })

  it('una venta sin decir como se cobro se rechaza', async () => {
    const res = await vender({ items: tresUnidades() })
    expect(res.status).toBe(400)
  })
})

describe('Anulacion con varios pagos', () => {
  async function ventaCombinada() {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'TRANSFER', amount: '20000.00' },
        { method: 'CASH', amount: '10000.00' },
      ],
    })
    return res.body.id
  }

  async function anular(saleId: number) {
    return call(ANULAR, `/api/sales/${saleId}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(saleId) },
      body: { reason: 'Error de cobro' },
    })
  }

  it('revierte SOLO el efectivo', async () => {
    const saleId = await ventaCombinada()
    expect(await cashOf(fx.branchA.id)).toBe('10000.00')

    const res = await anular(saleId)
    expect(res.status).toBeLessThan(300)

    expect(await cashOf(fx.branchA.id)).toBe('0.00')
    expect(await expectedOfShift(fx.branchA.id)).toBe('0.00')
  })

  it('NO borra los pagos originales', async () => {
    const saleId = await ventaCombinada()
    await anular(saleId)

    const pagos = await prisma.salePayment.findMany({ where: { saleId } })
    expect(pagos, 'Un registro financiero borrado no se puede auditar despues').toHaveLength(2)
    expect(sumarMontos(...pagos.map((p) => aMonto(p.amount)))).toBe('30000.00')
  })

  it('crea un contramovimiento por cada medio, sin tocar los originales', async () => {
    const saleId = await ventaCombinada()
    await anular(saleId)

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { saleId },
      orderBy: { id: 'asc' },
    })

    expect(movimientos).toHaveLength(4)
    expect(movimientos.filter((m) => m.type === 'sale')).toHaveLength(2)
    expect(movimientos.filter((m) => m.type === 'sale_cancel')).toHaveLength(2)

    // Los cuatro suman exactamente cero: no queda residuo.
    const suma = sumarMontos(...movimientos.map((m) => aMonto(m.amount)))
    expect(suma).toBe('0.00')
  })

  it('no se puede anular dos veces', async () => {
    const saleId = await ventaCombinada()
    expect((await anular(saleId)).status).toBeLessThan(300)
    expect((await anular(saleId)).status).toBe(409)

    // Y la caja no baja dos veces.
    expect(await cashOf(fx.branchA.id)).toBe('0.00')
  })

  it('anular una venta sin efectivo no mueve la caja', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'TRANSFER', amount: '30000.00' }],
    })
    expect(await cashOf(fx.branchA.id)).toBe('0.00')

    await anular(res.body.id)
    expect(await cashOf(fx.branchA.id)).toBe('0.00')
  })
})

describe('El total queda guardado', () => {
  it('coincide con la suma de las lineas', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 3 }],
      payments: [{ method: 'CASH', amount: '30000.00' }],
    })

    const venta = await prisma.sale.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(aMonto(venta.total)).toBe('30000.00')
    expect(aMonto(venta.total)).toBe(multiplicarMonto('10000.00', 3))
  })

  it('y con la suma de los pagos', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'CASH', amount: '7000.00' },
        { method: 'CREDIT_CARD', amount: '23000.00' },
      ],
    })

    const venta = await prisma.sale.findUniqueOrThrow({
      where: { id: res.body.id },
      include: { payments: true },
    })
    expect(sumarMontos(...venta.payments.map((p) => aMonto(p.amount)))).toBe(aMonto(venta.total))
  })
})

describe('Auditoria', () => {
  it('registra los pagos y cuanto entro al cajon', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'TRANSFER', amount: '20000.00' },
        { method: 'CASH', amount: '10000.00' },
      ],
    })

    const log = await prisma.auditLog.findFirstOrThrow({
      where: { tableName: 'Sale', actionType: 'create', recordId: res.body.id },
    })
    const cambios = log.changes as {
      after?: { enEfectivo?: string; pagos?: Array<{ method: string; amount: string }> }
    }

    expect(cambios.after?.enEfectivo).toBe('10000.00')
    expect(cambios.after?.pagos).toHaveLength(2)
    expect(cambios.after?.pagos?.map((p) => p.method)).toEqual(['TRANSFER', 'CASH'])
  })

  it('no guarda nada que se parezca a un numero de tarjeta', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'CREDIT_CARD', amount: '30000.00', reference: 'term. 4242' }],
    })

    const pago = await prisma.salePayment.findFirstOrThrow({ where: { saleId: res.body.id } })
    // Lo que se guarda es lo que el cajero anoto. El sistema no procesa
    // tarjetas: no hay PAN ni CVV que pudiera capturar.
    expect(pago.reference).toBe('term. 4242')
    expect(Object.keys(pago)).not.toContain('cardNumber')
  })
})
