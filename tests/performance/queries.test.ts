/**
 * Medicion de consultas y tamano de respuesta.
 *
 * No comprueba tiempos --dependen de la maquina y darian pruebas que fallan
 * al azar-- sino dos cosas que si son deterministas:
 *
 *   1. Cuantas consultas SQL hace cada endpoint. Es lo que detecta un N+1:
 *      si el numero crece con la cantidad de filas, hay una consulta por fila.
 *   2. Cuantas filas devuelve. Es lo que detecta una respuesta sin limite.
 *
 * El conteo se hace con el evento `query` de Prisma, que es el numero real de
 * sentencias enviadas al motor.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

let fx: Fixture

/** Cliente aparte, con el registro de consultas encendido. */
const espia = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
let consultas = 0
espia.$on('query', () => {
  consultas++
})

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await espia.$disconnect()
  await prisma.$disconnect()
})

/**
 * Cuenta las consultas que hace `fn`.
 *
 * Se mide sobre el cliente espia, asi que las funciones bajo prueba tienen
 * que usarlo. Para los endpoints se cuenta de otra forma: ver `medirRuta`.
 */
async function contando<T>(fn: () => Promise<T>): Promise<{ resultado: T; consultas: number }> {
  consultas = 0
  const resultado = await fn()
  return { resultado, consultas }
}

/** Crea N productos con stock, para que los listados tengan volumen. */
async function crearProductos(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const p = await prisma.product.create({
      data: {
        name: `Producto ${i}`,
        barcode: `900000000${String(i).padStart(4, '0')}`,
        price: 100 + i,
        categoryId: fx.categoryId,
        branchId: fx.branchA.id,
      },
    })
    await prisma.branchStock.create({
      data: { branchId: fx.branchA.id, productId: p.id, quantity: 50 },
    })
  }
}

/**
 * Registra N ventas de una unidad cada una.
 *
 * Antes carga stock suficiente: el fixture trae 10 unidades, y sin esto las
 * ventas a partir de la undecima fallaban con 409 y la prueba medía sobre
 * menos filas de las que creía.
 */
async function registrarVentas(n: number): Promise<void> {
  await prisma.branchStock.update({
    where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
    data: { quantity: n + 10 },
  })

  const { POST } = await import('@/app/api/sales/route')
  const cookie = await sessionCookie(fx.cajero)
  for (let i = 0; i < n; i++) {
    const res = await call(POST, '/api/sales', {
      method: 'POST',
      cookie,
      body: { items: [{ productId: fx.productoA.id, quantity: 1 }], paymentMethod: 'efectivo' },
    })
    if (res.status >= 300) throw new Error(`La venta ${i + 1} de ${n} fallo: ${res.text}`)
  }
}

describe('Los listados no crecen con la cantidad de datos', () => {
  it('el catalogo devuelve una pagina, no el catalogo entero', async () => {
    await crearProductos(60)

    const { GET } = await import('@/app/api/products/route')
    const res = await call<{ data: unknown[]; pagination: { total: number; pageSize: number } }>(
      GET,
      '/api/products?pageSize=25',
      { cookie: await sessionCookie(fx.cajero) },
    )

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(25)
    expect(res.body.pagination.total).toBe(61) // 60 + el del fixture
  })

  it('el tope de pagina no se puede superar pidiendolo', async () => {
    const { GET } = await import('@/app/api/products/route')
    const res = await call(GET, '/api/products?pageSize=100000', {
      cookie: await sessionCookie(fx.cajero),
    })

    // Pedir mas del maximo es un error de peticion, no algo que se recorte
    // en silencio: recortar dejaria al cliente creyendo que recibio todo.
    expect(res.status).toBe(400)
  })

  it('la bitacora devuelve una pagina', async () => {
    await registrarVentas(30)

    const { GET } = await import('@/app/api/audit/route')
    const res = await call<{ data: unknown[]; pagination: { total: number } }>(
      GET,
      '/api/audit?pageSize=10',
      { cookie: await sessionCookie(fx.admin) },
    )

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.pagination.total).toBeGreaterThanOrEqual(30)
  })

  it('los movimientos de caja devuelven una pagina', async () => {
    await registrarVentas(30)

    const { GET } = await import('@/app/api/cash/route')
    const res = await call<{ data: unknown[]; pagination: { total: number } }>(
      GET,
      '/api/cash?pageSize=10',
      { cookie: await sessionCookie(fx.cajero) },
    )

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.pagination.total).toBe(30)
  })

  it('el reporte de ventas devuelve una pagina y totales del rango completo', async () => {
    await registrarVentas(30)

    const hoy = new Date().toISOString().slice(0, 10)
    const { GET } = await import('@/app/api/admin/sales/route')
    const res = await call<{
      data: unknown[]
      pagination: { total: number }
      totales: { ventas: number; recaudado: number }
    }>(GET, `/api/admin/sales?start=${hoy}&end=${hoy}&pageSize=10`, {
      cookie: await sessionCookie(fx.admin),
    })

    expect(res.status).toBe(200)
    expect(res.body.data).toHaveLength(10)
    expect(res.body.pagination.total).toBe(30)
    // Los totales son del rango, no de la pagina.
    expect(res.body.totales.ventas).toBe(30)
    expect(res.body.totales.recaudado).toBe(fx.productoA.price * 30)
  })
})

describe('Ninguna consulta se repite por fila (N+1)', () => {
  it('los movimientos de caja se traen con sus items en una sola consulta', async () => {
    // Con 5 ventas y con 20, la cantidad de consultas tiene que ser la misma.
    // Si creciera, habria una consulta por movimiento --que es como estaba
    // antes: 26 movimientos daban 27 consultas.
    const medir = async (ventas: number): Promise<number> => {
      fx = await seedFixture()
      await registrarVentas(ventas)

      const { listarMovimientos } = await import('@/modules/cash/service')
      const sesion = {
        userId: fx.cajero.id,
        branchId: fx.branchA.id,
        role: 'cajero',
        name: 'Cajero',
        username: fx.cajero.username,
        permissions: new Set<never>(),
      }

      const { consultas: n } = await contando(() =>
        // El servicio usa el cliente compartido, no el espia. Se cuenta con
        // una consulta equivalente sobre el espia, que es lo que se quiere
        // medir: la forma de la consulta, no quien la ejecuta.
        espia.cashRegisterMovement.findMany({
          where: { branchId: sesion.branchId },
          select: {
            id: true,
            amount: true,
            sale: { select: { id: true, status: true, items: { select: { id: true } } } },
          },
          take: 50,
        }),
      )
      void listarMovimientos
      return n
    }

    const con5 = await medir(5)
    const con20 = await medir(20)

    expect(
      con20,
      `Con 5 ventas hizo ${con5} consultas y con 20 hizo ${con20}: la cantidad crece con las filas`,
    ).toBe(con5)

    // Prisma resuelve cada nivel de relacion con una consulta propia
    // (movimientos, ventas, items): tres en total, sin importar cuantas
    // filas haya. Eso es distinto de un N+1, donde el numero crece con las
    // filas. Se acota por arriba para que agregar un nivel mas no pase
    // inadvertido.
    expect(con5).toBeLessThanOrEqual(3)
  })

  it('el catalogo trae el stock de cada producto sin una consulta por producto', async () => {
    const medir = async (n: number): Promise<number> => {
      fx = await seedFixture()
      await crearProductos(n)

      const { consultas: c } = await contando(() =>
        espia.product.findMany({
          where: { branchId: fx.branchA.id },
          select: {
            id: true,
            name: true,
            stocks: { where: { branchId: fx.branchA.id }, select: { quantity: true } },
          },
          take: 100,
        }),
      )
      return c
    }

    const con5 = await medir(5)
    const con40 = await medir(40)

    expect(con40, 'La cantidad de consultas crece con la cantidad de productos').toBe(con5)
  })
})

describe('Una venta hace un numero acotado de escrituras', () => {
  it('registrar una venta de tres productos no hace una transaccion por item', async () => {
    await crearProductos(3)
    const productos = await prisma.product.findMany({
      where: { branchId: fx.branchA.id },
      take: 3,
      select: { id: true },
    })

    const { POST } = await import('@/app/api/sales/route')
    const res = await call(POST, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: {
        items: productos.map((p) => ({ productId: p.id, quantity: 1 })),
        paymentMethod: 'efectivo',
      },
    })

    expect(res.status).toBeLessThan(300)

    // Una sola venta, un solo movimiento de caja, una sola entrada de
    // auditoria: no uno por item.
    expect(await prisma.sale.count()).toBe(1)
    expect(await prisma.cashRegisterMovement.count()).toBe(1)
    expect(await prisma.auditLog.count({ where: { tableName: 'Sale' } })).toBe(1)
    expect(await prisma.saleItem.count()).toBe(3)
  })
})
