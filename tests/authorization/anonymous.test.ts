/**
 * Caso critico 1, 2 y 14 — un visitante sin sesion no accede a ninguna API
 * privada.
 *
 * Los handlers se invocan DIRECTAMENTE, sin pasar por el middleware. Es
 * deliberado: el middleware de Next puede no ejecutarse (de hecho no se
 * ejecutaba en produccion), asi que cada ruta tiene que defenderse sola.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, rawCookie, type RouteHandler } from '../helpers/http'

let fx: Fixture

beforeAll(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface Target {
  nombre: string
  cargar: () => Promise<Record<string, unknown>>
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  ruta: string
  cuerpo?: () => unknown
  params?: () => Record<string, string>
}

const RUTAS_PRIVADAS: Target[] = [
  {
    nombre: 'GET /api/users',
    cargar: () => import('@/app/api/users/route'),
    metodo: 'GET',
    ruta: '/api/users',
  },
  {
    nombre: 'POST /api/users',
    cargar: () => import('@/app/api/users/route'),
    metodo: 'POST',
    ruta: '/api/users',
    cuerpo: () => ({
      username: 'intruso',
      password: 'Intruso-1234',
      name: 'Intruso',
      roleId: 1,
      branchId: 1,
    }),
  },
  {
    nombre: 'GET /api/roles',
    cargar: () => import('@/app/api/roles/route'),
    metodo: 'GET',
    ruta: '/api/roles',
  },
  {
    nombre: 'POST /api/roles',
    cargar: () => import('@/app/api/roles/route'),
    metodo: 'POST',
    ruta: '/api/roles',
    cuerpo: () => ({ name: 'superusuario' }),
  },
  {
    nombre: 'GET /api/categories',
    cargar: () => import('@/app/api/categories/route'),
    metodo: 'GET',
    ruta: '/api/categories',
  },
  {
    nombre: 'POST /api/categories',
    cargar: () => import('@/app/api/categories/route'),
    metodo: 'POST',
    ruta: '/api/categories',
    cuerpo: () => ({ name: 'Categoria intrusa' }),
  },
  {
    nombre: 'GET /api/suppliers',
    cargar: () => import('@/app/api/suppliers/route'),
    metodo: 'GET',
    ruta: '/api/suppliers',
  },
  {
    nombre: 'POST /api/suppliers',
    cargar: () => import('@/app/api/suppliers/route'),
    metodo: 'POST',
    ruta: '/api/suppliers',
    cuerpo: () => ({ name: 'Proveedor intruso' }),
  },
  {
    nombre: 'GET /api/products',
    cargar: () => import('@/app/api/products/route'),
    metodo: 'GET',
    ruta: '/api/products',
  },
  {
    nombre: 'GET /api/branches',
    cargar: () => import('@/app/api/branches/route'),
    metodo: 'GET',
    ruta: '/api/branches',
  },
  {
    nombre: 'GET /api/audit',
    cargar: () => import('@/app/api/audit/route'),
    metodo: 'GET',
    ruta: '/api/audit',
  },
  {
    nombre: 'GET /api/cash',
    cargar: () => import('@/app/api/cash/route'),
    metodo: 'GET',
    ruta: '/api/cash',
  },
  {
    nombre: 'GET /api/cash/balance',
    cargar: () => import('@/app/api/cash/balance/route'),
    metodo: 'GET',
    ruta: '/api/cash/balance',
  },
  {
    nombre: 'POST /api/cash/count',
    cargar: () => import('@/app/api/cash/count/route'),
    metodo: 'POST',
    ruta: '/api/cash/count',
    cuerpo: () => ({ amount: 1000 }),
  },
  {
    nombre: 'POST /api/sales',
    cargar: () => import('@/app/api/sales/route'),
    metodo: 'POST',
    ruta: '/api/sales',
    cuerpo: () => ({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      paymentMethod: 'efectivo',
    }),
  },
  {
    nombre: 'GET /api/admin/sales',
    cargar: () => import('@/app/api/admin/sales/route'),
    metodo: 'GET',
    ruta: '/api/admin/sales?start=2026-01-01&end=2026-12-31',
  },
]

describe('Un visitante sin sesion no accede a ninguna API privada', () => {
  for (const target of RUTAS_PRIVADAS) {
    it(`${target.nombre} rechaza al visitante`, async () => {
      const mod = await target.cargar()
      const route = mod[target.metodo] as RouteHandler | undefined

      // Si el metodo no existe, la ruta no expone esa operacion: correcto.
      if (!route) return

      const res = await call(route, target.ruta, {
        method: target.metodo,
        body: target.cuerpo?.(),
        params: target.params?.(),
      })

      expect(
        res.status,
        `${target.nombre} respondio ${res.status} a un visitante anonimo`,
      ).toBe(401)
    })
  }

  it('no filtra informacion en el cuerpo del rechazo', async () => {
    const { GET } = await import('@/app/api/users/route')
    const res = await call(GET as RouteHandler, '/api/users')

    expect(res.status).toBe(401)
    expect(res.text).not.toMatch(/\$2[aby]\$/) // hash bcrypt
    expect(res.text.toLowerCase()).not.toContain('prisma')
  })
})

describe('Tokens invalidos, vencidos o revocados', () => {
  it('un token con firma invalida es rechazado', async () => {
    const { GET } = await import('@/app/api/products/route')
    const cookie = await rawCookie(
      'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjEsImJyYW5jaElkIjoxLCJyb2xlIjoiYWRtaW4iLCJzdiI6MH0.firma-inventada',
    )
    const res = await call(GET as RouteHandler, '/api/products', { cookie })
    expect(res.status).toBe(401)
  })

  it('un token vencido es rechazado', async () => {
    const { SignJWT } = await import('jose')
    const secret = new TextEncoder().encode(process.env.JWT_SECRET)
    const vencido = await new SignJWT({
      userId: fx.cajero.id,
      branchId: fx.cajero.branchId,
      role: fx.cajero.role,
      sv: 0,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(secret)

    const { GET } = await import('@/app/api/products/route')
    const res = await call(GET as RouteHandler, '/api/products', {
      cookie: await rawCookie(vencido),
    })
    expect(res.status).toBe(401)
  })

  it('un usuario dado de baja no accede aunque su token siga vigente', async () => {
    const { sessionCookie } = await import('../helpers/http')
    const cookie = await sessionCookie(fx.inactivo)

    const { GET } = await import('@/app/api/products/route')
    const res = await call(GET as RouteHandler, '/api/products', { cookie })
    expect(res.status).toBe(401)
  })

  it('una sesion revocada deja de servir de inmediato', async () => {
    const { sessionCookie } = await import('../helpers/http')
    const cookie = await sessionCookie(fx.cajero)

    const { GET } = await import('@/app/api/products/route')
    const antes = await call(GET as RouteHandler, '/api/products', { cookie })
    expect(antes.status).toBe(200)

    // Revocacion: se incrementa la version de sesion del usuario.
    await prisma.user.update({
      where: { id: fx.cajero.id },
      data: { sessionVersion: { increment: 1 } },
    })

    const despues = await call(GET as RouteHandler, '/api/products', { cookie })
    expect(despues.status).toBe(401)

    // Se restaura para no afectar a los tests siguientes del archivo.
    await prisma.user.update({
      where: { id: fx.cajero.id },
      data: { sessionVersion: fx.cajero.sessionVersion },
    })
  })
})
