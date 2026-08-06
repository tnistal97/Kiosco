/**
 * Casos criticos 6, 7 y 8 — registro de ventas.
 *
 *   6. El navegador no puede decidir el precio registrado.
 *   7. No se puede vender mas stock del disponible.
 *   8. Una venta fallida no modifica venta, items, stock ni caja.
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

async function vender(body: unknown, user = () => fx.cajero) {
  const { POST } = await import('@/app/api/sales/route')
  return call(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(user()),
    body,
  })
}

describe('Caso 6 — el precio lo decide el servidor', () => {
  // Estas dos pruebas se escribieron antes de la correccion, cuando todavia
  // no estaba decidido si mandar `price` se ignoraba o se rechazaba. Ahora
  // que el esquema es estricto, la respuesta correcta es una sola: 400.
  it('mandar un precio hace fallar la peticion entera', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1, price: 1 }],
      paymentMethod: 'efectivo',
    })

    expect(
      res.status,
      'El esquema debe rechazar `price`: aceptarlo abre la puerta a fijar el precio desde el navegador',
    ).toBe(400)

    expect(await prisma.saleItem.count()).toBe(0)
    expect(await prisma.sale.count()).toBe(0)
    expect(await cashOf(fx.branchA.id)).toBe(0)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
  })

  it('el total en caja corresponde al precio del catalogo', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 3 }],
      paymentMethod: 'efectivo',
    })

    expect(res.status).toBeLessThan(300)
    expect(await cashOf(fx.branchA.id)).toBe(fx.productoA.price * 3)
  })

  it('un descuento arbitrario del cliente no se aplica', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      paymentMethod: 'efectivo',
      total: 1,
      discount: 12499,
    })

    // Campo desconocido: la peticion se rechaza en vez de aceptarlo en silencio.
    expect(res.status).toBe(400)
    expect(await prisma.sale.count()).toBe(0)
  })
})

describe('Caso 7 — no se vende mas stock del disponible', () => {
  it('vender 999 unidades con 10 en stock es rechazado', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 999 }],
      paymentMethod: 'efectivo',
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await stockOf(fx.branchA.id, fx.productoA.id), 'El stock quedo en negativo').toBe(10)
    expect(await prisma.sale.count()).toBe(0)
  })

  it('vender exactamente el stock disponible se acepta y lo deja en cero', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 10 }],
      paymentMethod: 'efectivo',
    })

    expect(res.status).toBeLessThan(300)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(0)
  })

  it('el stock nunca queda negativo, sea cual sea la respuesta', async () => {
    await vender({
      items: [{ productId: fx.productoA.id, quantity: 11 }],
      paymentMethod: 'efectivo',
    })

    const stock = await stockOf(fx.branchA.id, fx.productoA.id)
    expect(stock).toBeGreaterThanOrEqual(0)
  })
})

describe('Caso 8 — una venta fallida no deja cambios parciales', () => {
  it('un item invalido en el medio no descuenta el stock de los demas', async () => {
    const inexistente = 999_999

    const res = await vender({
      items: [
        { productId: fx.productoA.id, quantity: 2 },
        { productId: inexistente, quantity: 1 },
      ],
      paymentMethod: 'efectivo',
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
    expect(await prisma.sale.count()).toBe(0)
    expect(await prisma.saleItem.count()).toBe(0)
    expect(await prisma.cashRegisterMovement.count()).toBe(0)
    expect(await cashOf(fx.branchA.id)).toBe(0)
  })

  it('si un item excede el stock, no se registra nada de la venta', async () => {
    const otro = await prisma.product.create({
      data: {
        name: 'Arroz Gallo 1kg',
        price: 2200,
        categoryId: fx.categoryId,
        branchId: fx.branchA.id,
      },
    })
    await prisma.branchStock.create({
      data: { branchId: fx.branchA.id, productId: otro.id, quantity: 1 },
    })

    const res = await vender({
      items: [
        { productId: fx.productoA.id, quantity: 1 },
        { productId: otro.id, quantity: 5 }, // solo hay 1
      ],
      paymentMethod: 'efectivo',
    })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
    expect(await stockOf(fx.branchA.id, otro.id)).toBe(1)
    expect(await prisma.sale.count()).toBe(0)
    expect(await cashOf(fx.branchA.id)).toBe(0)
  })
})

describe('Validacion de la entrada de la venta', () => {
  const invalidos: Array<[string, unknown]> = [
    ['sin items', { items: [], paymentMethod: 'efectivo' }],
    ['items no es una lista', { items: 'todo', paymentMethod: 'efectivo' }],
    ['cantidad cero', { items: [{ productId: 1, quantity: 0 }], paymentMethod: 'efectivo' }],
    ['cantidad negativa', { items: [{ productId: 1, quantity: -5 }], paymentMethod: 'efectivo' }],
    ['cantidad decimal', { items: [{ productId: 1, quantity: 1.5 }], paymentMethod: 'efectivo' }],
    [
      'cantidad no numerica',
      { items: [{ productId: 1, quantity: 'dos' }], paymentMethod: 'efectivo' },
    ],
    ['cantidad nula', { items: [{ productId: 1, quantity: null }], paymentMethod: 'efectivo' }],
    [
      'id de producto negativo',
      { items: [{ productId: -1, quantity: 1 }], paymentMethod: 'efectivo' },
    ],
    [
      'medio de pago inventado',
      { items: [{ productId: 1, quantity: 1 }], paymentMethod: 'trueque' },
    ],
    ['sin medio de pago', { items: [{ productId: 1, quantity: 1 }] }],
  ]

  for (const [nombre, body] of invalidos) {
    it(`rechaza: ${nombre}`, async () => {
      const res = await vender(body)
      expect(res.status).toBe(400)
      expect(await prisma.sale.count()).toBe(0)
    })
  }

  it('rechaza una cantidad infinita', async () => {
    // Se manda como texto crudo a proposito: escrito como literal de
    // JavaScript, `1e400` vale Infinity y JSON.stringify lo convierte en
    // `null`, de modo que la peticion nunca llegaba a llevar un infinito.
    // Con el texto tal cual, JSON.parse si produce Infinity.
    const { POST } = await import('@/app/api/sales/route')
    const res = await call(POST, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      rawBody: `{"items":[{"productId":${fx.productoA.id},"quantity":1e400}],"paymentMethod":"efectivo"}`,
    })

    expect(res.status).toBe(400)
    expect(await prisma.sale.count()).toBe(0)
    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(10)
  })

  it('rechaza un cuerpo que no es JSON', async () => {
    const { POST } = await import('@/app/api/sales/route')
    const res = await call(POST, '/api/sales', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      rawBody: 'esto no es json',
    })
    expect(res.status).toBe(400)
  })
})

describe('Una venta correcta deja todo consistente', () => {
  it('crea venta, items, movimiento de caja, descuenta stock y audita', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 2 }],
      paymentMethod: 'efectivo',
    })

    expect(res.status).toBeLessThan(300)

    const venta = await prisma.sale.findFirstOrThrow({ include: { items: true } })
    expect(venta.branchId).toBe(fx.branchA.id)
    expect(venta.userId).toBe(fx.cajero.id)
    expect(venta.status).toBe('completed')
    expect(venta.items).toHaveLength(1)
    expect(venta.items[0]?.price).toBe(fx.productoA.price)

    expect(await stockOf(fx.branchA.id, fx.productoA.id)).toBe(8)
    expect(await cashOf(fx.branchA.id)).toBe(fx.productoA.price * 2)

    const mov = await prisma.cashRegisterMovement.findFirstOrThrow()
    expect(mov.type).toBe('sale')
    expect(mov.amount).toBe(fx.productoA.price * 2)
    expect(mov.saleId, 'El movimiento de caja no quedo vinculado a la venta').toBe(venta.id)

    const logs = await prisma.auditLog.findMany({ where: { tableName: 'Sale' } })
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.userId).toBe(fx.cajero.id)
  })

  it('un pago con tarjeta no suma al efectivo de la caja', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      paymentMethod: 'tarjeta',
    })

    expect(res.status).toBeLessThan(300)
    expect(await cashOf(fx.branchA.id)).toBe(0)
    expect(await prisma.cashRegisterMovement.count()).toBe(1)
  })
})
