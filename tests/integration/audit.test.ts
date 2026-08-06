/**
 * La bitacora es la unica via de registro, y registra lo que tiene que
 * registrar.
 *
 * Dos mitades:
 *
 *   1. Cada operacion relevante deja una entrada, con sucursal, requestId,
 *      motivo y resultado.
 *   2. Ninguna entrada contiene una contrasena, un hash ni un token.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture, type TestUser } from '../helpers/db'
import { call, sessionCookie, type RouteHandler } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  const { __resetLoginAttempts } = await import('@/server/auth/loginAttempts')
  __resetLoginAttempts()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function invocar(
  modulo: string,
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  ruta: string,
  usuario: TestUser | null,
  extra: { body?: unknown; params?: Record<string, string> } = {},
) {
  const mod = (await import(/* @vite-ignore */ modulo)) as Record<string, RouteHandler>
  const handler = mod[metodo]
  if (!handler) throw new Error(`El modulo ${modulo} no exporta ${metodo}`)
  return call(handler, ruta, {
    method: metodo,
    ...(usuario ? { cookie: await sessionCookie(usuario) } : {}),
    ...extra,
  })
}

describe('Eventos que deben quedar registrados', () => {
  it('login exitoso', async () => {
    await invocar('@/app/api/auth/login/route', 'POST', '/api/auth/login', null, {
      body: { username: fx.cajero.username, password: fx.cajero.password },
    })

    const log = await prisma.auditLog.findFirst({ where: { actionType: 'login' } })
    expect(log).not.toBeNull()
    expect(log?.userId).toBe(fx.cajero.id)
    expect(log?.branchId).toBe(fx.branchA.id)
    expect(log?.result).toBe('success')
  })

  it('login fallido, con el motivo y marcado como fallo', async () => {
    await invocar('@/app/api/auth/login/route', 'POST', '/api/auth/login', null, {
      body: { username: fx.cajero.username, password: 'clave-incorrecta' },
    })

    const log = await prisma.auditLog.findFirst({ where: { actionType: 'login_failed' } })
    expect(log).not.toBeNull()
    expect(log?.result).toBe('failure')
    expect(log?.reason).toContain('contrasena')
    expect(log?.branchId).toBe(fx.branchA.id)
  })

  it('logout', async () => {
    await invocar('@/app/api/auth/logout/route', 'POST', '/api/auth/logout', fx.cajero)

    const log = await prisma.auditLog.findFirst({ where: { actionType: 'logout' } })
    expect(log).not.toBeNull()
    expect(log?.branchId).toBe(fx.branchA.id)
  })

  it('alta de usuario', async () => {
    const rol = await prisma.role.findFirstOrThrow({ where: { name: 'cajero' } })
    await invocar('@/app/api/users/route', 'POST', '/api/users', fx.admin, {
      body: {
        username: 'auditado',
        name: 'Auditado',
        password: 'Clave-Larga-1234',
        roleId: rol.id,
      },
    })

    const log = await prisma.auditLog.findFirst({
      where: { tableName: 'User', actionType: 'create' },
    })
    expect(log).not.toBeNull()
    expect(log?.branchId).toBe(fx.branchA.id)
  })

  it('alta de producto', async () => {
    await invocar('@/app/api/products/route', 'POST', '/api/products', fx.admin, {
      body: { name: 'Nuevo', price: 500, categoryId: fx.categoryId },
    })

    const log = await prisma.auditLog.findFirst({
      where: { tableName: 'Product', actionType: 'create' },
    })
    expect(log).not.toBeNull()
    expect(log?.branchId).toBe(fx.branchA.id)
  })

  it('cambio de precio, con el valor anterior y el nuevo', async () => {
    await invocar(
      '@/app/api/products/[id]/route',
      'PUT',
      `/api/products/${fx.productoA.id}`,
      fx.admin,
      {
        params: { id: String(fx.productoA.id) },
        body: { price: 20000 },
      },
    )

    const log = await prisma.auditLog.findFirst({
      where: { tableName: 'Product', actionType: 'update' },
    })
    expect(log).not.toBeNull()

    const cambios = log?.changes as { before?: { price?: number }; after?: { price?: number } }
    expect(cambios.before?.price).toBe(fx.productoA.price)
    expect(cambios.after?.price).toBe(20000)
  })

  it('ajuste de stock, con motivo y diferencia', async () => {
    await invocar(
      '@/app/api/stock/[id]/route',
      'PATCH',
      `/api/stock/${fx.productoA.id}`,
      fx.admin,
      {
        params: { id: String(fx.productoA.id) },
        body: { delta: 5, reason: 'Entrada de mercaderia' },
      },
    )

    const log = await prisma.auditLog.findFirst({
      where: { tableName: 'BranchStock' },
      orderBy: { id: 'desc' },
    })
    expect(log).not.toBeNull()
    expect(log?.reason).toBe('Entrada de mercaderia')
    expect(log?.branchId).toBe(fx.branchA.id)

    const cambios = log?.changes as {
      before?: { quantity?: number }
      after?: { quantity?: number }
    }
    expect(cambios.before?.quantity).toBe(10)
    expect(cambios.after?.quantity).toBe(15)
  })

  it('venta', async () => {
    await invocar('@/app/api/sales/route', 'POST', '/api/sales', fx.cajero, {
      body: { items: [{ productId: fx.productoA.id, quantity: 1 }], paymentMethod: 'efectivo' },
    })

    const log = await prisma.auditLog.findFirst({ where: { tableName: 'Sale' } })
    expect(log).not.toBeNull()
    expect(log?.branchId).toBe(fx.branchA.id)
  })

  it('anulacion, con el motivo declarado', async () => {
    await invocar('@/app/api/sales/route', 'POST', '/api/sales', fx.cajero, {
      body: { items: [{ productId: fx.productoA.id, quantity: 1 }], paymentMethod: 'efectivo' },
    })
    const venta = await prisma.sale.findFirstOrThrow()

    await invocar(
      '@/app/api/sales/[id]/cancel/route',
      'POST',
      `/api/sales/${venta.id}/cancel`,
      fx.admin,
      { params: { id: String(venta.id) }, body: { reason: 'El cliente se arrepintio' } },
    )

    const log = await prisma.auditLog.findFirst({ where: { actionType: 'cancel' } })
    expect(log).not.toBeNull()
    expect(log?.reason).toBe('El cliente se arrepintio')
  })

  it('movimiento manual de caja', async () => {
    await invocar('@/app/api/cash/route', 'POST', '/api/cash', fx.admin, {
      body: {
        amount: 500,
        paymentMethod: 'efectivo',
        movementType: 'ingreso',
        description: 'Fondo inicial',
      },
    })

    const log = await prisma.auditLog.findFirst({
      where: { tableName: 'CashRegisterMovement' },
    })
    expect(log).not.toBeNull()
    expect(log?.reason).toBe('Fondo inicial')
  })

  it('arqueo', async () => {
    await invocar('@/app/api/cash/count/route', 'POST', '/api/cash/count', fx.admin, {
      body: { amount: 0, notes: 'Cierre del dia' },
    })

    const log = await prisma.auditLog.findFirst({ where: { tableName: 'CashCount' } })
    expect(log).not.toBeNull()
    expect(log?.reason).toBe('Cierre del dia')
  })

  it('cambio de configuracion: alta de categoria', async () => {
    await invocar('@/app/api/categories/route', 'POST', '/api/categories', fx.admin, {
      body: { name: 'Bebidas' },
    })

    const log = await prisma.auditLog.findFirst({ where: { tableName: 'Category' } })
    expect(log).not.toBeNull()
  })
})

describe('Contexto de la peticion', () => {
  it('cada entrada lleva el requestId de la peticion que la genero', async () => {
    const res = await invocar('@/app/api/sales/route', 'POST', '/api/sales', fx.cajero, {
      body: { items: [{ productId: fx.productoA.id, quantity: 1 }], paymentMethod: 'efectivo' },
    })

    const requestId = res.headers.get('x-request-id')
    expect(requestId, 'La respuesta no trae x-request-id').toBeTruthy()

    const log = await prisma.auditLog.findFirst({ where: { tableName: 'Sale' } })
    expect(
      log?.requestId,
      'La entrada de auditoria no quedo unida a la peticion que la genero',
    ).toBe(requestId)
  })

  it('dos peticiones distintas dejan requestId distintos', async () => {
    for (let i = 0; i < 2; i++) {
      await invocar('@/app/api/sales/route', 'POST', '/api/sales', fx.cajero, {
        body: { items: [{ productId: fx.productoA.id, quantity: 1 }], paymentMethod: 'efectivo' },
      })
    }

    const logs = await prisma.auditLog.findMany({ where: { tableName: 'Sale' } })
    expect(logs).toHaveLength(2)
    expect(logs[0]?.requestId).not.toBe(logs[1]?.requestId)
  })
})

describe('La bitacora nunca guarda secretos', () => {
  const HASH_BCRYPT = /\$2[aby]\$\d{2}\$/

  it('el alta de usuario no deja la contrasena ni su hash', async () => {
    const rol = await prisma.role.findFirstOrThrow({ where: { name: 'cajero' } })
    const clave = 'Clave-Secretisima-9876'

    await invocar('@/app/api/users/route', 'POST', '/api/users', fx.admin, {
      body: { username: 'sin_secretos', name: 'Sin Secretos', password: clave, roleId: rol.id },
    })

    const todo = JSON.stringify(await prisma.auditLog.findMany())
    expect(todo).not.toContain(clave)
    expect(todo).not.toMatch(HASH_BCRYPT)
    expect(todo).not.toContain('"password"')
  })

  it('el login no deja la contrasena aunque sea incorrecta', async () => {
    const intento = 'intento-fallido-visible'
    await invocar('@/app/api/auth/login/route', 'POST', '/api/auth/login', null, {
      body: { username: fx.cajero.username, password: intento },
    })

    const todo = JSON.stringify(await prisma.auditLog.findMany())
    expect(todo).not.toContain(intento)
    expect(todo).not.toMatch(HASH_BCRYPT)
  })

  it('un objeto con campos sensibles se guarda con esos campos ocultos', async () => {
    const { audit } = await import('@/server/audit/audit')

    await audit(prisma, {
      userId: fx.admin.id,
      branchId: fx.branchA.id,
      table: 'User',
      action: 'update',
      // Se pasa un objeto entero a proposito: es el error que hay que atajar.
      after: {
        id: 1,
        username: 'alguien',
        password: '$2b$12$hashqueNoDeberiaEstar',
        token: 'eyJhbGciOiJIUzI1NiJ9.secreto',
        sessionVersion: 3,
      },
      origin: 'test',
    })

    const log = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'desc' } })
    const texto = JSON.stringify(log.changes)

    expect(texto).not.toContain('hashqueNoDeberiaEstar')
    expect(texto).not.toContain('eyJhbGciOiJIUzI1NiJ9')
    expect(texto).toContain('[oculto]')
    // Lo que no es sensible se conserva.
    expect(texto).toContain('alguien')
  })
})

describe('El tamano de los snapshots esta acotado', () => {
  it('un objeto enorme se recorta en vez de guardarse entero', async () => {
    const { audit } = await import('@/server/audit/audit')

    await audit(prisma, {
      userId: fx.admin.id,
      branchId: fx.branchA.id,
      table: 'Sale',
      action: 'create',
      after: { items: Array.from({ length: 500 }, (_, i) => ({ id: i, nombre: 'x'.repeat(50) })) },
      origin: 'test',
    })

    const log = await prisma.auditLog.findFirstOrThrow({ orderBy: { id: 'desc' } })
    const texto = JSON.stringify(log.changes)

    expect(texto).toContain('_truncated')
    expect(texto.length).toBeLessThan(2000)
  })
})
