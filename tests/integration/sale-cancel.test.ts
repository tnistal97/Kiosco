/**
 * Caso critico 12 — una anulacion valida restaura stock y registra auditoria.
 *
 * Y la contraparte que hoy no se cumple: una venta anulada NO se borra.
 * Sigue existiendo, con estado, fecha, responsable y motivo.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  seedFixture,
  prisma,
  stockOf,
  cashOf,
  hoyLocal,
  diaLocal,
  type Fixture,
} from '../helpers/db'
import { inicioDelDia, ZONA_POR_DEFECTO } from '@/lib/tiempo'
import { multiplicarMonto, negarMonto } from '@/lib/money'
import { aMonto } from '@/server/money'
import { call, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Registra una venta real usando el endpoint, para partir de un estado valido. */
async function venderDosUnidades(): Promise<number> {
  const { POST } = await import('@/app/api/sales/route')
  const res = await call<{ id: number }>(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body: {
      items: [{ productId: fx.productoA.id, quantity: 2 }],
      paymentMethod: 'efectivo',
    },
  })
  if (res.status >= 300) throw new Error(`No se pudo registrar la venta base: ${res.text}`)
  const venta = await prisma.sale.findFirstOrThrow()
  return venta.id
}

async function anular(saleId: number, body: unknown, user = () => fx.admin) {
  const { POST } = await import('@/app/api/sales/[id]/cancel/route')
  return call(POST, `/api/sales/${saleId}/cancel`, {
    method: 'POST',
    cookie: await sessionCookie(user()),
    params: { id: String(saleId) },
    body,
  })
}

describe('Caso 12 — anulacion valida', () => {
  it('restaura el stock exactamente', async () => {
    const saleId = await venderDosUnidades()
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(8)

    const res = await anular(saleId, { reason: 'El cliente devolvio la mercaderia' })
    expect(res.status).toBeLessThan(300)

    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
  })

  it('revierte el efectivo de la caja', async () => {
    const saleId = await venderDosUnidades()
    expect(await cashOf(fx.branchA.id)).toBe(multiplicarMonto(fx.productoA.price, 2))

    await anular(saleId, { reason: 'Error de cobro' })

    expect(await cashOf(fx.branchA.id)).toBe('0.00')
  })

  it('no borra la venta: la marca como anulada', async () => {
    const saleId = await venderDosUnidades()
    await anular(saleId, { reason: 'Producto en mal estado' })

    const venta = await prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true },
    })

    expect(venta, 'La venta fue borrada fisicamente').not.toBeNull()
    expect(venta?.status).toBe('canceled')
    expect(venta?.canceledAt).not.toBeNull()
    expect(venta?.canceledById).toBe(fx.admin.id)
    expect(venta?.cancelReason).toBe('Producto en mal estado')
    expect(venta?.items, 'Los items de la venta fueron borrados').toHaveLength(1)
  })

  it('no borra el movimiento de caja: agrega un contramovimiento', async () => {
    const saleId = await venderDosUnidades()
    await anular(saleId, { reason: 'Anulacion de prueba' })

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { saleId },
      orderBy: { id: 'asc' },
    })

    expect(movimientos).toHaveLength(2)
    const [entrada, contramovimiento] = movimientos
    if (!entrada || !contramovimiento) throw new Error('Faltan movimientos')

    const esperado = multiplicarMonto(fx.productoA.price, 2)
    expect(aMonto(entrada.amount)).toBe(esperado)
    // El contramovimiento es el opuesto EXACTO: los dos suman cero sin residuo.
    expect(aMonto(contramovimiento.amount)).toBe(negarMonto(esperado))
    expect(contramovimiento.type).toBe('sale_cancel')
  })

  it('registra la anulacion en la bitacora con antes y despues', async () => {
    const saleId = await venderDosUnidades()
    await anular(saleId, { reason: 'Motivo auditado' })

    const log = await prisma.auditLog.findFirst({
      where: { tableName: 'Sale', actionType: 'cancel', recordId: saleId },
    })

    expect(log, 'La anulacion no quedo registrada en la bitacora').not.toBeNull()
    expect(log?.userId).toBe(fx.admin.id)

    const cambios = log?.changes as { before?: { status?: string }; after?: { status?: string } }
    expect(cambios.before?.status).toBe('completed')
    expect(cambios.after?.status).toBe('canceled')
  })
})

describe('Proteccion de la anulacion', () => {
  it('exige un motivo', async () => {
    const saleId = await venderDosUnidades()

    const sinMotivo = await anular(saleId, {})
    expect(sinMotivo.status).toBe(400)

    const motivoVacio = await anular(saleId, { reason: '   ' })
    expect(motivoVacio.status).toBe(400)

    const venta = await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })
    expect(venta.status).toBe('completed')
  })

  it('no se puede anular dos veces', async () => {
    const saleId = await venderDosUnidades()

    const primera = await anular(saleId, { reason: 'Primera anulacion' })
    expect(primera.status).toBeLessThan(300)

    const segunda = await anular(saleId, { reason: 'Segunda anulacion' })
    expect(segunda.status).toBe(409)

    // El stock no se restauro dos veces.
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
    expect(await cashOf(fx.branchA.id)).toBe('0.00')
  })

  it('dos anulaciones simultaneas restauran el stock una sola vez', async () => {
    const saleId = await venderDosUnidades()

    const [a, b] = await Promise.all([
      anular(saleId, { reason: 'Simultanea A' }),
      anular(saleId, { reason: 'Simultanea B' }),
    ])

    const exitosas = [a, b].filter((r) => r.status < 300)
    expect(exitosas).toHaveLength(1)

    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
    expect(await cashOf(fx.branchA.id)).toBe('0.00')
  })

  it('anular una venta inexistente devuelve 404', async () => {
    const res = await anular(999_999, { reason: 'No existe' })
    expect(res.status).toBe(404)
  })
})

describe('El dia del reporte es el dia del LOCAL, no el de UTC', () => {
  it('una venta de las once de la noche cuenta en el dia en que se hizo', async () => {
    const saleId = await venderDosUnidades()

    // Se la fecha a las 23:30 de HOY, hora local. En UTC eso ya es manana --en
    // Argentina son las 02:30-- y con el rango en UTC la venta desaparecia del
    // dia: un almacen que cierra a las 22 perdia de vista su ultima hora.
    const alCierre = new Date()
    alCierre.setHours(23, 30, 0, 0)
    await prisma.sale.update({ where: { id: saleId }, data: { date: alCierre } })

    const { GET } = await import('@/app/api/admin/sales/route')
    const hoy = hoyLocal()
    const res = await call<{ data: Array<{ id: number }>; totales: { ventas: number } }>(
      GET,
      `/api/admin/sales?start=${hoy}&end=${hoy}`,
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(res.status).toBe(200)
    expect(
      res.body.data.find((s) => s.id === saleId),
      'la venta del cierre desaparecio del dia en que se hizo',
    ).toBeDefined()
  })

  it('una venta de las 00:30 NO cuenta en el dia anterior', async () => {
    const saleId = await venderDosUnidades()

    // Las 00:30 EN LA ZONA DE LA SUCURSAL, y el dia anterior en la misma zona.
    //
    // FASE 5A.2: esto usaba `new Date(); setHours(0, 30)` y `getDate() - 1`,
    // que trabajan en la zona de LA MAQUINA. En una computadora argentina
    // coincide con la del negocio y la prueba pasa; en CI, que corre en UTC,
    // las 00:30 UTC son las 21:30 de AYER en Buenos Aires --y entonces la venta
    // SI cae en el dia anterior y la prueba afirma lo contrario de lo que
    // deberia--. Es la misma clase de defecto que la Fase 5A.1 corrigio en las
    // pruebas de reportes; esta sobrevivio porque no usaba `hoyLocal()`.
    const alaMadrugada = new Date(
      inicioDelDia(hoyLocal(), ZONA_POR_DEFECTO).getTime() + 30 * 60 * 1000,
    )
    await prisma.sale.update({ where: { id: saleId }, data: { date: alaMadrugada } })

    const dia = diaLocal(-1)

    const { GET } = await import('@/app/api/admin/sales/route')
    const res = await call<{ data: Array<{ id: number }> }>(
      GET,
      `/api/admin/sales?start=${dia}&end=${dia}`,
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(res.status).toBe(200)
    expect(
      res.body.data.find((s) => s.id === saleId),
      'una venta de la madrugada se colo en el dia anterior',
    ).toBeUndefined()
  })
})

describe('Una venta anulada sigue apareciendo en los reportes', () => {
  it('el reporte administrativo la incluye con su estado', async () => {
    const saleId = await venderDosUnidades()
    await anular(saleId, { reason: 'Anulada pero visible' })

    const hoy = hoyLocal()
    const { GET } = await import('@/app/api/admin/sales/route')
    const res = await call<{
      data: Array<{ id: number; status: string }>
      totales: { ventas: number; anuladas: number; recaudado: number }
    }>(GET, `/api/admin/sales?start=${hoy}&end=${hoy}`, {
      cookie: await sessionCookie(fx.admin),
    })

    expect(res.status).toBe(200)
    const venta = res.body.data.find((s) => s.id === saleId)
    expect(venta, 'La venta anulada desaparecio del reporte').toBeDefined()
    expect(venta?.status).toBe('canceled')
  })

  it('la venta anulada no suma a la recaudacion del reporte', async () => {
    const saleId = await venderDosUnidades()
    const hoy = hoyLocal()
    const { GET } = await import('@/app/api/admin/sales/route')

    const cookie = await sessionCookie(fx.admin)
    const consultar = () =>
      call<{ totales: { ventas: number; anuladas: number; recaudado: number } }>(
        GET,
        `/api/admin/sales?start=${hoy}&end=${hoy}`,
        { cookie },
      )

    const antes = await consultar()
    expect(antes.body.totales.ventas).toBe(1)
    expect(antes.body.totales.anuladas).toBe(0)
    expect(antes.body.totales.recaudado).toBe(multiplicarMonto(fx.productoA.price, 2))

    await anular(saleId, { reason: 'No suma' })

    const despues = await consultar()
    expect(despues.body.totales.ventas).toBe(0)
    expect(despues.body.totales.anuladas).toBe(1)
    expect(
      despues.body.totales.recaudado,
      'Una venta anulada seguia sumando a la recaudacion del reporte',
    ).toBe('0.00')
  })
})
