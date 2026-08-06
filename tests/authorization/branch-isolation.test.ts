/**
 * Caso critico 5 — un usuario no puede actuar sobre otra sucursal.
 *
 * El branchId sale SIEMPRE de la sesion verificada contra la base, nunca del
 * cuerpo de la peticion. Esta suite comprueba las dos mitades: que no se
 * pueda leer y que no se pueda escribir.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, stockOf, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('Lectura entre sucursales', () => {
  it('el catalogo solo muestra productos de la sucursal propia', async () => {
    const { GET } = await import('@/app/api/products/route')
    const res = await call<Array<{ id: number }>>(GET, '/api/products', {
      cookie: await sessionCookie(fx.cajero),
    })

    expect(res.status).toBe(200)
    const ids = res.body.map((p) => p.id)
    expect(ids).toContain(fx.productoA.id)
    expect(ids).not.toContain(fx.productoB.id)
  })

  it('no se puede leer un producto de otra sucursal por id', async () => {
    const { GET } = await import('@/app/api/products/[id]/route')
    const res = await call(GET, `/api/products/${fx.productoB.id}`, {
      cookie: await sessionCookie(fx.cajero),
      params: { id: String(fx.productoB.id) },
    })

    expect([403, 404]).toContain(res.status)
  })

  it('la caja de una sucursal no incluye movimientos de la otra', async () => {
    await prisma.cashRegisterMovement.create({
      data: {
        branchId: fx.branchB.id,
        userId: fx.cajeroB.id,
        amount: 99999,
        paymentMethod: 'efectivo',
        type: 'manual',
        description: 'Movimiento de la sucursal B',
      },
    })

    const { GET } = await import('@/app/api/cash/route')
    const res = await call(GET, '/api/cash', {
      cookie: await sessionCookie(fx.cajero),
    })

    expect(res.status).toBe(200)
    expect(res.text).not.toContain('Movimiento de la sucursal B')
    expect(res.text).not.toContain('99999')
  })
})

describe('Escritura entre sucursales', () => {
  it('no se puede ajustar el stock de un producto de otra sucursal', async () => {
    const { PUT } = await import('@/app/api/stock/[id]/route')
    const res = await call(PUT, `/api/stock/${fx.productoB.id}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin), // admin de la sucursal A
      params: { id: String(fx.productoB.id) },
      body: { quantity: 0, reason: 'Intento de ajuste cruzado' },
    })

    expect([403, 404]).toContain(res.status)
    expect(await stockOf(fx.branchB.id, fx.productoB.id)).toBe(10)
  })

  it('no existe un endpoint que acepte branchId desde el cuerpo', async () => {
    // Especificador en variable a proposito: si fuera literal, TypeScript
    // fallaria al compilar el test porque el modulo ya no existe, que es
    // justamente lo que se quiere comprobar en tiempo de ejecucion.
    const ruta = '@/app/api/stock/route'
    const mod: unknown = await import(/* @vite-ignore */ ruta).catch(() => null)

    if (mod && typeof mod === 'object' && 'POST' in mod) {
      throw new Error(
        'POST /api/stock sigue existiendo: acepta branchId del cliente y ' +
          'permite modificar el inventario de cualquier sucursal sin autenticacion',
      )
    }
  })

  it('vender un producto de otra sucursal es rechazado', async () => {
    const { POST } = await import('@/app/api/sales/route')
    const res = await call(POST, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero), // sucursal A
      body: {
        items: [{ productId: fx.productoB.id, quantity: 1 }],
        paymentMethod: 'efectivo',
      },
    })

    expect([400, 403, 404]).toContain(res.status)
    expect(await prisma.sale.count()).toBe(0)
    expect(await stockOf(fx.branchB.id, fx.productoB.id)).toBe(10)
  })

  it('no se puede anular una venta de otra sucursal', async () => {
    const ventaB = await prisma.sale.create({
      data: {
        userId: fx.cajeroB.id,
        branchId: fx.branchB.id,
        items: { create: [{ productId: fx.productoB.id, quantity: 1, price: 4800 }] },
      },
    })

    const { POST } = await import('@/app/api/sales/[id]/cancel/route')
    const res = await call(POST, `/api/sales/${ventaB.id}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin), // admin de la sucursal A
      params: { id: String(ventaB.id) },
      body: { reason: 'Intento de anulacion cruzada' },
    })

    expect([403, 404]).toContain(res.status)
    const despues = await prisma.sale.findUniqueOrThrow({ where: { id: ventaB.id } })
    expect(despues.status).toBe('completed')
  })
})
