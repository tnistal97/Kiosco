/**
 * Cada perfil operativo puede exactamente lo suyo.
 *
 * Las pruebas de la Fase 0 cubrian los dos extremos: administrador y cajero.
 * Aca se recorre el catalogo completo y, para cada rol, se comprueba contra
 * endpoints reales que el permiso declarado en la matriz se cumple de verdad.
 *
 * La tabla de abajo no repite ROLE_PRESETS: se consulta `permissionsForRole`
 * y se deduce si la respuesta esperada es "pasa" o "403". Asi, cambiar los
 * permisos de un rol cambia automaticamente lo que exige esta suite.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture, type TestUser, hoyLocal } from '../helpers/db'
import { call, sessionCookie, errorDe, type RouteHandler } from '../helpers/http'
import { knownRoles, permissionsForRole, type Permission } from '@/server/authz/permissions'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Una operacion concreta, con el permiso que deberia exigir. */
interface Caso {
  nombre: string
  permiso: Permission
  ejecutar: (usuario: TestUser) => Promise<{ status: number }>
}

async function invocar(
  modulo: string,
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  ruta: string,
  usuario: TestUser,
  extra: { body?: unknown; params?: Record<string, string> } = {},
) {
  const mod = (await import(/* @vite-ignore */ modulo)) as Record<string, RouteHandler>
  const handler = mod[metodo]
  if (!handler) throw new Error(`El modulo ${modulo} no exporta ${metodo}`)
  return call(handler, ruta, {
    method: metodo,
    cookie: await sessionCookie(usuario),
    ...extra,
  })
}

const CASOS: Caso[] = [
  {
    nombre: 'ver el catalogo',
    permiso: 'products.view',
    ejecutar: (u) => invocar('@/app/api/products/route', 'GET', '/api/products', u),
  },
  {
    nombre: 'crear un producto',
    permiso: 'products.create',
    ejecutar: (u) =>
      invocar('@/app/api/products/route', 'POST', '/api/products', u, {
        body: { name: 'Producto de prueba', price: 100, categoryId: fx.categoryId },
      }),
  },
  {
    // Editar la ficha y cambiar el precio son dos permisos distintos desde
    // la Fase 2. Quien repone mercaderia corrige un nombre mal escrito; el
    // precio de venta lo decide quien maneja el local.
    nombre: 'editar la ficha de un producto',
    permiso: 'products.update',
    ejecutar: (u) =>
      invocar('@/app/api/products/[id]/route', 'PUT', `/api/products/${fx.productoA.id}`, u, {
        params: { id: String(fx.productoA.id) },
        body: { name: 'Nombre corregido' },
      }),
  },
  {
    nombre: 'cambiar el precio de un producto',
    permiso: 'products.price.update',
    ejecutar: (u) =>
      invocar('@/app/api/products/[id]/route', 'PUT', `/api/products/${fx.productoA.id}`, u, {
        params: { id: String(fx.productoA.id) },
        body: { price: 999 },
      }),
  },
  {
    nombre: 'borrar un producto',
    permiso: 'products.delete',
    ejecutar: (u) =>
      invocar('@/app/api/products/[id]/route', 'DELETE', `/api/products/${fx.productoA.id}`, u, {
        params: { id: String(fx.productoA.id) },
      }),
  },
  {
    nombre: 'ajustar el stock',
    permiso: 'stock.adjust',
    ejecutar: (u) =>
      invocar('@/app/api/stock/[id]/route', 'PATCH', `/api/stock/${fx.productoA.id}`, u, {
        params: { id: String(fx.productoA.id) },
        body: { delta: 1, reason: 'Prueba de permisos' },
      }),
  },
  {
    nombre: 'registrar una venta',
    permiso: 'sales.create',
    ejecutar: (u) =>
      invocar('@/app/api/sales/route', 'POST', '/api/sales', u, {
        body: {
          items: [{ productId: fx.productoA.id, quantity: 1 }],
          paymentMethod: 'efectivo',
        },
      }),
  },
  {
    nombre: 'ver la caja',
    permiso: 'cash.view',
    ejecutar: (u) => invocar('@/app/api/cash/route', 'GET', '/api/cash', u),
  },
  {
    nombre: 'retirar dinero de la caja',
    permiso: 'cash.movement.create',
    ejecutar: (u) =>
      invocar('@/app/api/cash/route', 'POST', '/api/cash', u, {
        body: {
          amount: 1,
          paymentMethod: 'efectivo',
          movementType: 'ingreso',
          description: 'Prueba',
        },
      }),
  },
  {
    nombre: 'hacer un arqueo',
    permiso: 'cash.count.create',
    ejecutar: (u) =>
      invocar('@/app/api/cash/count/route', 'POST', '/api/cash/count', u, {
        body: { amount: 0, notes: 'Prueba' },
      }),
  },
  {
    nombre: 'leer la bitacora',
    permiso: 'audit.view',
    ejecutar: (u) => invocar('@/app/api/audit/route', 'GET', '/api/audit', u),
  },
  {
    nombre: 'listar el personal',
    permiso: 'users.view',
    ejecutar: (u) => invocar('@/app/api/users/route', 'GET', '/api/users', u),
  },
  {
    nombre: 'dar de alta personal',
    permiso: 'users.manage',
    ejecutar: (u) =>
      invocar('@/app/api/users/route', 'POST', '/api/users', u, {
        body: {
          username: 'nuevo_de_prueba',
          name: 'Nuevo',
          password: 'Clave-Larga-1234',
          roleId: 1,
        },
      }),
  },
  {
    nombre: 'ver el historial de ventas',
    // `sales.view` y no el permiso de reportes: la pantalla de ventas es el
    // historial, y hasta la Fase 3D el cajero veia el enlace del menu y
    // recibia un 403 al entrar. La RECAUDACION del rango si sigue protegida
    // por `reports.sales.view`, y eso lo comprueba tests/integration.
    permiso: 'sales.view',
    ejecutar: (u) => {
      const hoy = hoyLocal()
      return invocar(
        '@/app/api/admin/sales/route',
        'GET',
        `/api/admin/sales?start=${hoy}&end=${hoy}`,
        u,
      )
    },
  },
  {
    nombre: 'ver el reporte de rentabilidad',
    permiso: 'reports.costs.view',
    ejecutar: (u) => {
      const hoy = hoyLocal()
      return invocar(
        '@/app/api/reports/rentabilidad/route',
        'GET',
        `/api/reports/rentabilidad?desde=${hoy}&hasta=${hoy}`,
        u,
      )
    },
  },
  {
    nombre: 'ver el reporte de caja',
    permiso: 'reports.cash.view',
    ejecutar: (u) => {
      const hoy = hoyLocal()
      return invocar(
        '@/app/api/reports/caja/route',
        'GET',
        `/api/reports/caja?desde=${hoy}&hasta=${hoy}`,
        u,
      )
    },
  },
  {
    nombre: 'ver el reporte de compras',
    permiso: 'reports.purchases.view',
    ejecutar: (u) => {
      const hoy = hoyLocal()
      return invocar(
        '@/app/api/reports/compras/route',
        'GET',
        `/api/reports/compras?desde=${hoy}&hasta=${hoy}`,
        u,
      )
    },
  },
]

describe.each(knownRoles())('Rol %s', (rol) => {
  for (const caso of CASOS) {
    const deberiaPoder = permissionsForRole(rol).has(caso.permiso)

    it(`${deberiaPoder ? 'puede' : 'NO puede'} ${caso.nombre}`, async () => {
      const usuario = fx.porRol[rol]
      expect(usuario, `Falta el usuario de prueba del rol ${rol}`).toBeDefined()
      if (!usuario) return

      const res = await caso.ejecutar(usuario)

      // Una sola asercion: si el rol tiene el permiso la respuesta no puede
      // ser 403 (aunque si puede fallar por datos o por conflicto), y si no
      // lo tiene, tiene que ser exactamente 403.
      expect(
        res.status === 403,
        deberiaPoder
          ? `El rol ${rol} tiene "${caso.permiso}" pero recibio 403 al intentar ${caso.nombre}`
          : `El rol ${rol} NO tiene "${caso.permiso}" y pudo ${caso.nombre} (status ${res.status})`,
      ).toBe(!deberiaPoder)
    })
  }
})

describe('El auditor no puede escribir nada', () => {
  const ESCRITURAS = CASOS.filter(
    (c) =>
      ![
        'products.view',
        'stock.view',
        'cash.view',
        'audit.view',
        'users.view',
        'sales.view',
        'reports.sales.view',
        'reports.costs.view',
        'reports.inventory.view',
        'reports.cash.view',
        'reports.purchases.view',
      ].includes(c.permiso),
  )

  for (const caso of ESCRITURAS) {
    it(`rechaza: ${caso.nombre}`, async () => {
      const auditor = fx.porRol.auditor
      expect(auditor).toBeDefined()
      if (!auditor) return

      const res = await caso.ejecutar(auditor)
      expect(res.status, `El auditor pudo ${caso.nombre}`).toBe(403)
    })
  }
})

describe('Un rechazo por permiso es informativo pero no revelador', () => {
  it('devuelve 403 con codigo FORBIDDEN y requestId', async () => {
    const repositor = fx.porRol.repositor
    expect(repositor).toBeDefined()
    if (!repositor) return

    const res = await invocar('@/app/api/users/route', 'GET', '/api/users', repositor)
    expect(res.status).toBe(403)

    const error = errorDe(res)
    expect(error.code).toBe('FORBIDDEN')
    expect(error.requestId).not.toBe('')
    // El mensaje nombra el permiso que falta, no la estructura interna.
    expect(error.message).not.toMatch(/prisma|select|from |table/i)
  })

  it('el intento rechazado queda registrado en la bitacora', async () => {
    const repositor = fx.porRol.repositor
    expect(repositor).toBeDefined()
    if (!repositor) return

    await invocar('@/app/api/users/route', 'GET', '/api/users', repositor)

    const registro = await prisma.auditLog.findFirst({
      where: { userId: repositor.id, actionType: 'deny' },
    })

    expect(
      registro,
      'Un intento rechazado por falta de permiso deberia dejar rastro: es el que interesa mirar despues',
    ).not.toBeNull()
    expect(registro?.result).toBe('failure')
    expect(registro?.branchId).toBe(repositor.branchId)
  })
})
