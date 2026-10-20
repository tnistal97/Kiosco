/**
 * Lo que necesitan "Ventas de hoy" (en /venta) y el resumen de /reportes.
 *
 *   - el detalle de una venta trae COMO se pago: cada medio, con cuanto pago
 *     el cliente y el vuelto, y la referencia de Mercado Pago;
 *   - el reporte por medio de pago separa Mercado Pago de las demas
 *     transferencias, aunque en la base las dos son `TRANSFER`;
 *   - el reporte de caja dice quien abrio y cuando cerro cada caja, con
 *     fechas que el navegador puede leer.
 *
 * Contra la base de pruebas, por la API, como el resto de la integracion.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, hoyLocal, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { multiplicarMonto, sumarMontos } from '@/lib/money'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface Pago {
  method: string
  amount: string
  cashReceived?: string
  reference?: string
}

async function vender(cantidad: string, pagos: Pago[], usuario = fx.admin) {
  const { POST } = await import('@/app/api/sales/route')
  const res = await call<{ id: number }>(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: { items: [{ productId: fx.productoA.id, quantity: cantidad }], payments: pagos },
  })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.id
}

const total = (unidades: number) => multiplicarMonto(fx.productoA.price, unidades)

interface VentaDelReporte {
  id: number
  items: Array<{ quantity: string; saleUnit: string; price: string }>
  payments: Array<{
    method: string
    amount: string
    cashReceived: string | null
    changeGiven: string | null
    reference: string | null
  }>
  client: { id: number; name: string } | null
}

async function ventasDeHoy() {
  const { GET } = await import('@/app/api/admin/sales/route')
  const d = hoyLocal()
  return call<{ data: VentaDelReporte[] }>(
    GET,
    `/api/admin/sales?start=${d}&end=${d}&page=1&pageSize=50`,
    { cookie: await sessionCookie(fx.cajero) },
  )
}

describe('El detalle de una venta dice como se pago', () => {
  it('efectivo: con cuanto pago el cliente y el vuelto', async () => {
    const id = await vender('2', [{ method: 'CASH', amount: total(2), cashReceived: '50000' }])

    const res = await ventasDeHoy()
    expect(res.status).toBe(200)
    const venta = res.body.data.find((v) => v.id === id)
    expect(venta?.payments).toEqual([
      {
        method: 'CASH',
        amount: total(2),
        cashReceived: '50000.00',
        changeGiven: sumarMontos('50000.00', multiplicarMonto(total(2), -1)),
        reference: null,
      },
    ])
    // La cantidad viaja con su unidad, para escribirla "2 u." y no "2.000".
    expect(venta?.items[0]).toMatchObject({ quantity: '2.000', saleUnit: 'UNIT' })
    expect(venta?.client).toBeNull()
  })

  it('Mercado Pago llega como transferencia CON su referencia', async () => {
    const id = await vender('1', [
      { method: 'TRANSFER', amount: total(1), reference: 'Mercado Pago' },
    ])

    const venta = (await ventasDeHoy()).body.data.find((v) => v.id === id)
    expect(venta?.payments).toEqual([
      {
        method: 'TRANSFER',
        amount: total(1),
        cashReceived: null,
        changeGiven: null,
        reference: 'Mercado Pago',
      },
    ])
  })

  it('un pago dividido trae las dos lineas, en orden', async () => {
    const mitad = multiplicarMonto(total(2), 0.5)
    const id = await vender('2', [
      { method: 'CASH', amount: mitad },
      { method: 'TRANSFER', amount: mitad, reference: 'Mercado Pago' },
    ])

    const venta = (await ventasDeHoy()).body.data.find((v) => v.id === id)
    expect(venta?.payments.map((p) => [p.method, p.reference])).toEqual([
      ['CASH', null],
      ['TRANSFER', 'Mercado Pago'],
    ])
  })
})

interface ReporteVentas {
  totales: { facturado: string; operaciones: number; ticketPromedio: string }
  porMedio: Array<{ medio: string; etiqueta: string; cobrado: string; operaciones: number }>
}

async function reporteDeHoy() {
  const { GET } = await import('@/app/api/reports/ventas/route')
  const d = hoyLocal()
  return call<ReporteVentas>(GET, `/api/reports/ventas?desde=${d}&hasta=${d}`, {
    cookie: await sessionCookie(fx.admin),
  })
}

describe('El reporte por medio de pago separa Mercado Pago', () => {
  it('efectivo, transferencia y Mercado Pago, cada uno con lo suyo', async () => {
    await vender('1', [{ method: 'CASH', amount: total(1) }])
    await vender('2', [{ method: 'TRANSFER', amount: total(2) }])
    await vender('3', [{ method: 'TRANSFER', amount: total(3), reference: 'Mercado Pago' }])

    const res = await reporteDeHoy()
    expect(res.status).toBe(200)
    const medio = (m: string) => res.body.porMedio.find((f) => f.medio === m)

    expect(medio('CASH')).toMatchObject({ etiqueta: 'Efectivo', cobrado: total(1) })
    expect(medio('TRANSFER')).toMatchObject({ etiqueta: 'Transferencia', cobrado: total(2) })
    expect(medio('MERCADO_PAGO')).toMatchObject({
      etiqueta: 'Mercado Pago',
      cobrado: total(3),
      operaciones: 1,
    })
    // Separarlos no cambia el total: la suma de los medios sigue siendo lo vendido.
    expect(res.body.totales.facturado).toBe(total(6))
    expect(sumarMontos(...res.body.porMedio.map((m) => m.cobrado))).toBe(total(6))
  })

  it('una transferencia con OTRA referencia sigue siendo transferencia', async () => {
    await vender('1', [{ method: 'TRANSFER', amount: total(1), reference: 'Op. 4471' }])

    const res = await reporteDeHoy()
    expect(res.body.porMedio.map((m) => m.medio)).toEqual(['TRANSFER'])
  })
})

interface ReporteCaja {
  detalle: Array<{
    turno: number
    abierto: string
    cerrado: string | null
    abrio: string | null
    cerradoPor: string | null
    diferencia: string | null
  }>
}

async function reporteDeCaja() {
  const { GET } = await import('@/app/api/reports/caja/route')
  const d = hoyLocal()
  return call<ReporteCaja>(GET, `/api/reports/caja?desde=${d}&hasta=${d}`, {
    cookie: await sessionCookie(fx.admin),
  })
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

describe('El reporte de cierres de caja', () => {
  it('dice quien abrio la caja y cuando, con una fecha que el navegador lee', async () => {
    const res = await reporteDeCaja()
    expect(res.status).toBe(200)
    const turno = res.body.detalle.find((t) => t.turno === fx.turnoA)

    expect(turno?.abierto).toMatch(ISO)
    expect(Number.isNaN(new Date(turno?.abierto ?? '').getTime())).toBe(false)
    expect(turno?.abrio).toBeTruthy()
    // Sigue abierta: no hay cierre ni quien lo hizo.
    expect(turno?.cerrado).toBeNull()
    expect(turno?.cerradoPor).toBeNull()
  })

  it('al cerrarla, el cierre trae su hora y su diferencia', async () => {
    const { POST: CERRAR } = await import('@/app/api/cash/shift/[id]/close/route')
    const cierre = await call(CERRAR, `/api/cash/shift/${String(fx.turnoA)}/close`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.turnoA) },
      body: { countedAmount: '0.00', notes: 'Cierre de prueba' },
    })
    expect(cierre.status).toBe(200)

    const turno = (await reporteDeCaja()).body.detalle.find((t) => t.turno === fx.turnoA)
    expect(turno?.cerrado).toMatch(ISO)
    expect(turno?.cerradoPor).toBeTruthy()
    expect(turno?.diferencia).not.toBeNull()
  })
})
