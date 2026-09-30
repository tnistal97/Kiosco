/**
 * Mercado Pago como medio de pago propio. V1 comercial.
 *
 * La regla que resume el cambio, en mayusculas porque es la unica que importa
 * para la caja:
 *
 *   UNA VENTA COBRADA POR MERCADO PAGO NO MUEVE EL EFECTIVO DEL CAJON.
 *
 * Y la que lo justifica para el dueño: en el cierre del dia, Mercado Pago y
 * la transferencia son DOS renglones, no uno.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, cashOf, expectedOfShift, hoyLocal, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import {
  MEDIOS_COBRABLES,
  MEDIOS_DE_CAJA,
  MEDIOS_DE_COBRANZA,
  MEDIOS_DE_PAGO_A_PROVEEDOR,
  esEfectivo,
  etiquetaDeMedio,
  normalizarMedio,
} from '@/modules/sales/payment-methods'

import { POST as CREAR_VENTA } from '@/app/api/sales/route'
import { POST as COBRAR } from '@/app/api/clients/[id]/pagos/route'
import { GET as REPORTE_VENTAS } from '@/app/api/reports/ventas/route'

interface VentaCreada {
  id: number
  total: string
  payments: Array<{ method: string; label: string; amount: string }>
  cashCollected: string
}
interface ReporteDeVentas {
  totales: { facturado: string; operaciones: number }
  porMedio: Array<{ medio: string; etiqueta: string; cobrado: string; operaciones: number }>
}

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: '10000.00' } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

function tresUnidades() {
  return [{ productId: fx.productoA.id, quantity: 3 }]
}

async function vender(body: unknown) {
  return call<VentaCreada>(CREAR_VENTA, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body,
  })
}

async function reporteDeHoy() {
  const hoy = hoyLocal()
  return call<ReporteDeVentas>(REPORTE_VENTAS, `/api/reports/ventas?desde=${hoy}&hasta=${hoy}`, {
    cookie: await sessionCookie(fx.admin),
  })
}

describe('El vocabulario', () => {
  it('Mercado Pago es un medio fijo, cobrable, de caja y de cobranza', () => {
    expect(MEDIOS_COBRABLES).toContain('MERCADO_PAGO')
    expect(MEDIOS_DE_CAJA).toContain('MERCADO_PAGO')
    expect(MEDIOS_DE_COBRANZA).toContain('MERCADO_PAGO')
    expect(etiquetaDeMedio('MERCADO_PAGO')).toBe('Mercado Pago')
  })

  it('NO es efectivo, y no se ofrece para pagarle a un proveedor en esta tanda', () => {
    expect(esEfectivo('MERCADO_PAGO')).toBe(false)
    expect(MEDIOS_DE_PAGO_A_PROVEEDOR).not.toContain('MERCADO_PAGO')
  })

  it('la forma vieja `mercado_pago` ahora significa lo que decia', () => {
    expect(normalizarMedio('mercado_pago')).toBe('MERCADO_PAGO')
  })
})

describe('Una venta por Mercado Pago', () => {
  it('se guarda con su codigo y NO toca la caja', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'MERCADO_PAGO', amount: '30000.00' }],
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.payments).toHaveLength(1)
    expect(res.body.payments[0]?.method).toBe('MERCADO_PAGO')
    expect(res.body.payments[0]?.label).toBe('Mercado Pago')
    expect(res.body.cashCollected).toBe('0.00')

    expect(await cashOf(fx.branchA.id), 'Mercado Pago no entra al cajon').toBe('0.00')
    expect(await expectedOfShift(fx.branchA.id)).toBe('0.00')
  })

  it('deja su movimiento en el listado del turno, con su medio', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'MERCADO_PAGO', amount: '30000.00', reference: 'QR 1234' }],
    })

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { saleId: res.body.id },
    })
    expect(movimientos).toHaveLength(1)
    expect(movimientos[0]?.paymentMethod).toBe('MERCADO_PAGO')

    const pagos = await prisma.salePayment.findMany({ where: { saleId: res.body.id } })
    expect(pagos[0]?.reference).toBe('QR 1234')
  })

  it('no admite "con cuanto pago": no da vuelto', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [{ method: 'MERCADO_PAGO', amount: '30000.00', cashReceived: '50000.00' }],
    })
    expect(res.status).toBe(400)
  })
})

describe('Venta combinada: Mercado Pago mas efectivo', () => {
  it('la caja sube SOLO por el efectivo', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'MERCADO_PAGO', amount: '20000.00' },
        { method: 'CASH', amount: '10000.00' },
      ],
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.total).toBe('30000.00')
    expect(res.body.cashCollected).toBe('10000.00')
    expect(await cashOf(fx.branchA.id)).toBe('10000.00')
    expect(await expectedOfShift(fx.branchA.id)).toBe('10000.00')

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { saleId: res.body.id },
      orderBy: { id: 'asc' },
    })
    expect(movimientos.map((m) => m.paymentMethod)).toEqual(['MERCADO_PAGO', 'CASH'])
  })

  it('tres medios a la vez, incluido Mercado Pago, siguen sumando el total exacto', async () => {
    const res = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'MERCADO_PAGO', amount: '15000.00' },
        { method: 'TRANSFER', amount: '5000.00' },
        { method: 'CASH', amount: '10000.00' },
      ],
    })
    expect(res.status).toBeLessThan(300)
    expect(await cashOf(fx.branchA.id)).toBe('10000.00')

    const descuadrada = await vender({
      items: tresUnidades(),
      payments: [
        { method: 'MERCADO_PAGO', amount: '15000.00' },
        { method: 'CASH', amount: '14999.99' },
      ],
    })
    expect(descuadrada.status).toBe(400)
  })
})

describe('Cobro de fiado por Mercado Pago', () => {
  it('baja el saldo del cliente y la caja NO sube', async () => {
    await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })
    const cajaAntes = await cashOf(fx.branchA.id)

    const res = await call<{ id: number; resultingBalance: string; entroACaja: boolean }>(
      COBRAR,
      `/api/clients/${String(fx.cliente.id)}/pagos`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.cajero),
        body: { amount: '8000.00', method: 'MERCADO_PAGO' },
        params: { id: String(fx.cliente.id) },
      },
    )

    expect(res.status).toBeLessThan(300)
    expect(res.body.resultingBalance).toBe('12000.00')
    expect(res.body.entroACaja).toBe(false)
    expect(await cashOf(fx.branchA.id)).toBe(cajaAntes)

    const pago = await prisma.customerPayment.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(pago.method).toBe('MERCADO_PAGO')
  })
})

describe('En el reporte', () => {
  it('Mercado Pago y transferencia son DOS renglones distintos', async () => {
    await vender({
      items: tresUnidades(),
      payments: [{ method: 'MERCADO_PAGO', amount: '30000.00' }],
    })
    await vender({
      items: tresUnidades(),
      payments: [{ method: 'TRANSFER', amount: '30000.00', reference: 'Mercado Pago' }],
    })
    await vender({
      items: tresUnidades(),
      payments: [
        { method: 'MERCADO_PAGO', amount: '20000.00' },
        { method: 'CASH', amount: '10000.00' },
      ],
    })

    const reporte = await reporteDeHoy()
    expect(reporte.status).toBe(200)
    expect(reporte.body.totales.operaciones).toBe(3)

    const porMedio = Object.fromEntries(reporte.body.porMedio.map((m) => [m.medio, m]))
    expect(porMedio.MERCADO_PAGO?.cobrado).toBe('50000.00')
    expect(porMedio.MERCADO_PAGO?.operaciones).toBe(2)
    expect(porMedio.MERCADO_PAGO?.etiqueta).toBe('Mercado Pago')
    // La transferencia historica con la referencia "Mercado Pago" NO se
    // reinterpreta: se guardo como transferencia y se informa como tal.
    expect(porMedio.TRANSFER?.cobrado).toBe('30000.00')
    expect(porMedio.CASH?.cobrado).toBe('10000.00')
  })
})
