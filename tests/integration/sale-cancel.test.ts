/**
 * Caso critico 12 — una anulacion valida restaura stock y registra auditoria.
 *
 * Y la contraparte que hoy no se cumple: una venta anulada NO se borra.
 * Sigue existiendo, con estado, fecha, responsable y motivo.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, stockOf, cashOf, type Fixture } from '../helpers/db'
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
    expect(await cashOf(fx.branchA.id)).toBe(fx.productoA.price * 2)

    await anular(saleId, { reason: 'Error de cobro' })

    expect(await cashOf(fx.branchA.id)).toBe(0)
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
    expect(entrada?.amount).toBe(fx.productoA.price * 2)
    expect(contramovimiento?.amount).toBe(-fx.productoA.price * 2)
    expect(contramovimiento?.type).toBe('sale_cancel')
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
    expect(await cashOf(fx.branchA.id)).toBe(0)
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
    expect(await cashOf(fx.branchA.id)).toBe(0)
  })

  it('anular una venta inexistente devuelve 404', async () => {
    const res = await anular(999_999, { reason: 'No existe' })
    expect(res.status).toBe(404)
  })
})

describe('Una venta anulada sigue apareciendo en los reportes', () => {
  it('el reporte administrativo la incluye con su estado', async () => {
    const saleId = await venderDosUnidades()
    await anular(saleId, { reason: 'Anulada pero visible' })

    const hoy = new Date().toISOString().slice(0, 10)
    const { GET } = await import('@/app/api/admin/sales/route')
    const res = await call<{ sales: Array<{ id: number; status: string }> }>(
      GET,
      `/api/admin/sales?start=${hoy}&end=${hoy}`,
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(res.status).toBe(200)
    const venta = res.body.sales.find((s) => s.id === saleId)
    expect(venta, 'La venta anulada desaparecio del reporte').toBeDefined()
    expect(venta?.status).toBe('canceled')
  })
})
