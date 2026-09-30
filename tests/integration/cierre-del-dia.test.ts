/**
 * Cierre del dia. V1 comercial.
 *
 * La pantalla que el dueño mira al bajar la persiana. Lo que se prueba es la
 * separacion que la pantalla tiene que hacer imposible de confundir:
 *
 *   "VENTAS" SUMA TODOS LOS MEDIOS. "DEBERIA HABER" SUMA SOLO EL EFECTIVO.
 *
 * Y que los numeros salen del servidor: el mismo endpoint devuelve las
 * ventas, el desglose por medio y la cuenta del cajon, coherentes entre si.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, hoyLocal, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { sumarMontos, restarMontos } from '@/lib/money'

import { POST as CREAR_VENTA } from '@/app/api/sales/route'
import { POST as ANULAR } from '@/app/api/sales/[id]/cancel/route'
import { POST as MOVIMIENTO } from '@/app/api/cash/route'
import { POST as CERRAR } from '@/app/api/cash/shift/[id]/close/route'
import { POST as ABRIR } from '@/app/api/cash/shift/route'
import { GET as CIERRE } from '@/app/api/cash/cierre/route'
import type { CierreDelDia } from '@/modules/cash/service.cierre'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: '10000.00' } })
  await prisma.branchStock.updateMany({
    where: { productId: fx.productoA.id },
    data: { quantity: 1000 },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function vender(payments: unknown[], extra: Record<string, unknown> = {}) {
  return call<{ id: number }>(CREAR_VENTA, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body: { items: [{ productId: fx.productoA.id, quantity: 3 }], payments, ...extra },
  })
}

async function cierre(fecha?: string, quien = fx.admin) {
  const q = fecha ? `?fecha=${fecha}` : ''
  return call<CierreDelDia>(CIERRE, `/api/cash/cierre${q}`, {
    cookie: await sessionCookie(quien),
  })
}

async function cerrarCaja(countedAmount: string) {
  return call<{ turno: { id: number } }>(CERRAR, `/api/cash/shift/${String(fx.turnoA)}/close`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(fx.turnoA) },
    body: { countedAmount, notes: 'Cierre' },
  })
}

describe('El cierre del dia', () => {
  it('separa las ventas totales del efectivo que deberia haber', async () => {
    // Caja abierta por la fixture con $0. Tres ventas de $30.000:
    //   efectivo 30.000
    //   Mercado Pago 20.000 + efectivo 10.000
    //   fiado 30.000
    expect((await vender([{ method: 'CASH', amount: '30000.00' }])).status).toBe(201)
    expect(
      (
        await vender([
          { method: 'MERCADO_PAGO', amount: '20000.00' },
          { method: 'CASH', amount: '10000.00' },
        ])
      ).status,
    ).toBe(201)
    expect(
      (await vender([{ method: 'ACCOUNT', amount: '30000.00' }], { clientId: fx.cliente.id }))
        .status,
    ).toBe(201)

    // Un ingreso y un retiro en efectivo.
    await call(MOVIMIENTO, '/api/cash', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        amount: '8000.00',
        paymentMethod: 'CASH',
        movementType: 'ingreso',
        description: 'Cambio',
      },
    })
    await call(MOVIMIENTO, '/api/cash', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        amount: '15000.00',
        paymentMethod: 'CASH',
        movementType: 'retiro',
        description: 'Proveedor',
      },
    })

    const res = await cierre()
    expect(res.status).toBe(200)
    const c = res.body

    expect(c.esHoy).toBe(true)
    expect(c.fecha).toBe(hoyLocal())
    expect(c.ventas.total).toBe('90000.00')
    expect(c.ventas.operaciones).toBe(3)
    expect(c.ventas.ticketPromedio).toBe('30000.00')

    // Como me pagaron: la suma de los medios ES el total de ventas.
    const porMedio = Object.fromEntries(c.porMedio.map((m) => [m.medio, m]))
    expect(porMedio.CASH?.cobrado).toBe('40000.00')
    expect(porMedio.MERCADO_PAGO?.cobrado).toBe('20000.00')
    expect(porMedio.ACCOUNT?.cobrado).toBe('30000.00')
    expect(porMedio.ACCOUNT?.etiqueta).toBe('Fiado')
    expect(porMedio.ACCOUNT?.esFiado).toBe(true)
    expect(porMedio.CASH?.entraAlCajon).toBe(true)
    expect(porMedio.MERCADO_PAGO?.entraAlCajon).toBe(false)
    expect(sumarMontos(...c.porMedio.map((m) => m.cobrado))).toBe(c.ventas.total)

    // La caja: solo efectivo.
    expect(c.caja.estado).toBe('abierta')
    expect(c.caja.cajaInicial).toBe('0.00')
    expect(c.caja.ventasEnEfectivo).toBe('40000.00')
    expect(c.caja.ingresos).toBe('8000.00')
    expect(c.caja.egresos).toBe('15000.00')
    expect(c.caja.deberiaHaber).toBe('33000.00')
    expect(c.caja.deberiaHaber, 'no es el total de ventas').not.toBe(c.ventas.total)
    // Sigue abierta: no hay contado ni diferencia todavia.
    expect(c.caja.contado).toBeNull()
    expect(c.caja.diferencia).toBeNull()
    expect(c.avisos.map((a) => a.codigo)).toContain('caja_abierta')
  })

  it('al cerrar la caja aparecen "contaste" y la diferencia', async () => {
    await vender([{ method: 'CASH', amount: '30000.00' }])
    const contado = restarMontos('30000.00', '500.00')
    expect((await cerrarCaja(contado)).status).toBe(200)

    const c = (await cierre()).body
    expect(c.caja.estado).toBe('cerrada')
    expect(c.caja.deberiaHaber).toBe('30000.00')
    expect(c.caja.contado).toBe('29500.00')
    expect(c.caja.diferencia).toBe('-500.00')
    expect(c.avisos).toEqual([])
  })

  it('una venta anulada no suma a las ventas ni al efectivo', async () => {
    const v = await vender([{ method: 'CASH', amount: '30000.00' }])
    await vender([{ method: 'CASH', amount: '30000.00' }])
    await call(ANULAR, `/api/sales/${String(v.body.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(v.body.id) },
      body: { reason: 'Se equivoco de producto' },
    })

    const c = (await cierre()).body
    expect(c.ventas.total).toBe('30000.00')
    expect(c.ventas.operaciones).toBe(1)
    expect(c.ventas.anuladas).toBe(1)
    expect(c.caja.deberiaHaber).toBe('30000.00')
  })

  it('con dos turnos en el dia, la caja es la suma y el detalle esta por turno', async () => {
    await vender([{ method: 'CASH', amount: '30000.00' }])
    await cerrarCaja('30000.00')
    const segundo = await call<{ turno: { id: number } }>(ABRIR, '/api/cash/shift', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { openingAmount: '5000.00' },
    })
    expect(segundo.status).toBe(201)
    await vender([{ method: 'CASH', amount: '30000.00' }])

    const c = (await cierre()).body
    expect(c.caja.estado).toBe('varias')
    expect(c.turnos).toHaveLength(2)
    expect(c.caja.cajaInicial).toBe('5000.00')
    expect(c.caja.ventasEnEfectivo).toBe('60000.00')
    expect(c.caja.deberiaHaber).toBe('65000.00')
    expect(c.caja.contado, 'uno sigue abierto: no hay contado total').toBeNull()
    expect(c.avisos.map((a) => a.codigo)).toEqual(
      expect.arrayContaining(['varios_turnos', 'caja_abierta']),
    )
  })

  it('una caja abierta desde otro dia se avisa, y un dia sin caja tambien', async () => {
    await prisma.cashShift.update({
      where: { id: fx.turnoA },
      data: { openedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) },
    })
    const hoy = (await cierre()).body
    expect(hoy.caja.estado).toBe('abierta')
    expect(hoy.turnos[0]?.deOtroDia).toBe(true)
    expect(hoy.avisos.map((a) => a.codigo)).toContain('caja_de_otro_dia')

    const ayer = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const otro = (await cierre(ayer)).body
    expect(otro.esHoy).toBe(false)
    // El turno abierto de otro dia aparece en cualquier consulta: es la caja
    // que sigue abierta. Pero las ventas son cero.
    expect(otro.ventas.operaciones).toBe(0)
  })

  it('el cajero no ve el cierre del dia; el encargado si', async () => {
    expect((await cierre(undefined, fx.cajero)).status).toBe(403)
    const encargado = fx.porRol.encargado
    expect(encargado, 'la fixture trae un usuario por rol').toBeDefined()
    expect((await cierre(undefined, encargado)).status).toBe(200)
  })

  it('rechaza una fecha mal escrita', async () => {
    expect((await cierre('30-09-2026')).status).toBe(400)
  })
})
