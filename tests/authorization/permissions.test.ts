/**
 * Casos criticos 3, 4, 10, 13 — permisos por operacion.
 *
 * Un cajero puede vender. No puede administrar usuarios, ni borrar el
 * catalogo, ni anular ventas, ni ver la bitacora de auditoria.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie, type RouteHandler } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('Caso 4 — un usuario comun no puede administrar usuarios', () => {
  it('el cajero no puede listar usuarios', async () => {
    const { GET } = await import('@/app/api/users/route')
    const res = await call(GET, '/api/users', {
      cookie: await sessionCookie(fx.cajero),
    })
    expect(res.status).toBe(403)
  })

  it('el cajero no puede crear usuarios', async () => {
    const { POST } = await import('@/app/api/users/route')
    const antes = await prisma.user.count()

    const res = await call(POST, '/api/users', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: {
        username: 'nuevo_admin',
        password: 'Intento-1234',
        name: 'Intento',
        roleId: 1,
        branchId: fx.branchA.id,
      },
    })

    expect(res.status).toBe(403)
    expect(await prisma.user.count()).toBe(antes)
  })

  it('el administrador si puede listar usuarios', async () => {
    const { GET } = await import('@/app/api/users/route')
    const res = await call(GET, '/api/users', {
      cookie: await sessionCookie(fx.admin),
    })
    expect(res.status).toBe(200)
  })
})

describe('Caso 3 — ningun endpoint devuelve hashes de contrasena', () => {
  const HASH_BCRYPT = /\$2[aby]\$\d{2}\$/

  it('GET /api/users no incluye el campo password', async () => {
    const { GET } = await import('@/app/api/users/route')
    const res = await call(GET, '/api/users', {
      cookie: await sessionCookie(fx.admin),
    })

    expect(res.status).toBe(200)
    expect(res.text).not.toMatch(HASH_BCRYPT)
    expect(res.text).not.toContain('"password"')
  })

  it('POST /api/users devuelve el usuario creado sin su hash', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'cajero' } })
    const { POST } = await import('@/app/api/users/route')

    const res = await call(POST, '/api/users', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        username: 'cajero_nuevo',
        password: 'Nueva-Clave-1234',
        name: 'Cajero Nuevo',
        roleId: role.id,
      },
    })

    expect(res.status).toBe(201)
    expect(res.text).not.toMatch(HASH_BCRYPT)
    expect(res.text).not.toContain('"password"')
  })

  it('la sucursal del usuario nuevo la fija el servidor, no el cuerpo', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { name: 'cajero' } })
    const { POST } = await import('@/app/api/users/route')

    // El administrador es de la sucursal A e intenta crear personal en la B.
    const res = await call(POST, '/api/users', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        username: 'infiltrado',
        password: 'Nueva-Clave-1234',
        name: 'Infiltrado',
        roleId: role.id,
        branchId: fx.branchB.id,
      },
    })

    // Campo no declarado: la peticion se rechaza entera en vez de ignorarlo
    // en silencio.
    expect(res.status).toBe(400)
    expect(await prisma.user.count({ where: { username: 'infiltrado' } })).toBe(0)
  })

  it('ninguna respuesta de las rutas de lectura contiene un hash', async () => {
    const cookie = await sessionCookie(fx.admin)
    const rutas: Array<[string, () => Promise<Record<string, unknown>>, string]> = [
      ['GET /api/users', () => import('@/app/api/users/route'), '/api/users'],
      ['GET /api/branches', () => import('@/app/api/branches/route'), '/api/branches'],
      ['GET /api/audit', () => import('@/app/api/audit/route'), '/api/audit'],
      ['GET /api/cash', () => import('@/app/api/cash/route'), '/api/cash'],
      ['GET /api/products', () => import('@/app/api/products/route'), '/api/products'],
    ]

    for (const [nombre, cargar, ruta] of rutas) {
      const mod = await cargar()
      const route = mod.GET as RouteHandler
      const res = await call(route, ruta, { cookie })
      expect(res.text, `${nombre} devolvio un hash bcrypt`).not.toMatch(HASH_BCRYPT)
      expect(res.text, `${nombre} devolvio el campo password`).not.toContain('"password"')
    }
  })
})

describe('Caso 10 — no puede eliminarse fisicamente todo el catalogo', () => {
  it('no existe una operacion de borrado masivo de productos', async () => {
    const mod: Record<string, unknown> = await import('@/app/api/products/route')
    expect(
      'DELETE' in mod,
      'DELETE /api/products sigue existiendo: borra el catalogo completo de una sucursal',
    ).toBe(false)
  })

  it('el cajero no puede borrar un producto individual', async () => {
    const { DELETE } = await import('@/app/api/products/[id]/route')
    const res = await call(DELETE, `/api/products/${fx.productoA.id}`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.cajero),
      params: { id: String(fx.productoA.id) },
    })

    expect(res.status).toBe(403)
    expect(await prisma.product.count({ where: { id: fx.productoA.id } })).toBe(1)
  })

  it('el cajero no puede cambiar el precio de un producto', async () => {
    const { PUT } = await import('@/app/api/products/[id]/route')
    const res = await call(PUT, `/api/products/${fx.productoA.id}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.cajero),
      params: { id: String(fx.productoA.id) },
      body: { price: 1 },
    })

    expect(res.status).toBe(403)
    const p = await prisma.product.findUniqueOrThrow({ where: { id: fx.productoA.id } })
    expect(p.price).toBe(fx.productoA.price)
  })
})

describe('Caso 13 — una anulacion sin permiso es rechazada', () => {
  it('el cajero no puede anular una venta', async () => {
    const venta = await prisma.sale.create({
      data: {
        userId: fx.cajero.id,
        branchId: fx.branchA.id,
        items: { create: [{ productId: fx.productoA.id, quantity: 1, price: 12500 }] },
      },
    })

    const { POST } = await import('@/app/api/sales/[id]/cancel/route')
    const res = await call(POST, `/api/sales/${venta.id}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      params: { id: String(venta.id) },
      body: { reason: 'El cliente se arrepintio' },
    })

    expect(res.status).toBe(403)

    const despues = await prisma.sale.findUniqueOrThrow({ where: { id: venta.id } })
    expect(despues.status).toBe('completed')
  })
})

describe('La bitacora de auditoria es informacion administrativa', () => {
  it('el cajero no puede consultarla', async () => {
    const { GET } = await import('@/app/api/audit/route')
    const res = await call(GET, '/api/audit', {
      cookie: await sessionCookie(fx.cajero),
    })
    expect(res.status).toBe(403)
  })

  it('el administrador si puede', async () => {
    const { GET } = await import('@/app/api/audit/route')
    const res = await call(GET, '/api/audit', {
      cookie: await sessionCookie(fx.admin),
    })
    expect(res.status).toBe(200)
  })
})
