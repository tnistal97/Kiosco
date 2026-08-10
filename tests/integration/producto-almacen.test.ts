/**
 * Fase 3B contra la base: peso, costo y codigos.
 *
 * Tres bloques que son tres reglas:
 *
 *   1. una venta por peso guarda EXACTAMENTE lo que se peso, y su anulacion
 *      devuelve exactamente eso mismo;
 *   2. el costo NO SALE hacia quien no lo puede ver --no se esconde en la
 *      pantalla, no viaja--;
 *   3. para el lector, el codigo principal y un alternativo son lo mismo.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, stockExacto, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Venta por peso
// ---------------------------------------------------------------------------

async function vender(productId: number, quantity: string) {
  const { POST } = await import('@/app/api/sales/route')
  return call<{ id: number; total: string; items: Array<{ quantity: string; subtotal: string }> }>(
    POST,
    '/api/sales',
    {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { items: [{ productId, quantity }], paymentMethod: 'efectivo' },
    },
  )
}

describe('Venta por peso', () => {
  it('vender 0,425 kg guarda 0,425 y cobra $4.165', async () => {
    const res = await vender(fx.productoPeso.id, '0.425')

    expect(res.status).toBe(201)
    expect(res.body.items[0]?.quantity, 'la cantidad viaja como cadena decimal').toBe('0.425')
    // $9.800/kg x 0,425 kg. En punto flotante daria 4164.999999999999.
    expect(res.body.items[0]?.subtotal).toBe('4165.00')
    expect(res.body.total).toBe('4165.00')

    const item = await prisma.saleItem.findFirstOrThrow({ where: { saleId: res.body.id } })
    expect(item.quantity.toFixed(3), 'lo guardado es lo pesado').toBe('0.425')
  })

  it('el libro descuenta la fraccion exacta y el saldo cierra', async () => {
    await vender(fx.productoPeso.id, '0.425')

    const mov = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: fx.productoPeso.id, type: 'SALE' },
    })
    expect(mov.quantity.toFixed(3)).toBe('-0.425')
    expect(mov.previousQuantity.toFixed(3)).toBe('5.000')
    expect(mov.resultingQuantity.toFixed(3)).toBe('4.575')

    expect(await stockExacto(fx.branchA.id, fx.productoPeso.id)).toBe('4.575')
  })

  it('tres cortes seguidos no acumulan residuo', async () => {
    // 5,000 − 0,1 − 0,2 − 0,333 = 4,367. Sumando en punto flotante da
    // 4.366999999999999, y la restriccion de la base rechazaria la tercera
    // fila antes de que nadie pudiera verlo.
    await vender(fx.productoPeso.id, '0.100')
    await vender(fx.productoPeso.id, '0.200')
    await vender(fx.productoPeso.id, '0.333')

    expect(await stockExacto(fx.branchA.id, fx.productoPeso.id)).toBe('4.367')
  })

  it('anular devuelve exactamente lo que se vendio', async () => {
    const venta = await vender(fx.productoPeso.id, '0.425')

    const { POST: anular } = await import('@/app/api/sales/[id]/cancel/route')
    const res = await call(anular, `/api/sales/${String(venta.body.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(venta.body.id) },
      body: { reason: 'El cliente devolvio el queso' },
    })
    expect(res.status).toBe(200)

    // No "aproximadamente 5": exactamente el saldo de antes.
    expect(await stockExacto(fx.branchA.id, fx.productoPeso.id)).toBe('5.000')

    const suma = await prisma.stockMovement.aggregate({
      where: { productId: fx.productoPeso.id, referenceType: 'Sale' },
      _sum: { quantity: true },
    })
    expect(suma._sum.quantity?.toFixed(3), 'venta y anulacion suman cero').toBe('0.000')
  })

  it('no se puede vender mas peso del que hay, y el mensaje lo dice en kilos', async () => {
    const res = await vender(fx.productoPeso.id, '9.000')
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('INSUFFICIENT_STOCK')
    expect(errorDe(res).message).toMatch(/5,000 kg/)
  })

  it('un producto por unidad RECHAZA una fraccion', async () => {
    // `1.235` es una cantidad bien formada; que no exista para este producto lo
    // decide el servicio, que es quien conoce la unidad.
    const res = await vender(fx.productoA.id, '1.235')
    expect(res.status).toBe(400)
    expect(errorDe(res).code).toBe('INVALID_QUANTITY_FOR_UNIT')
    expect(errorDe(res).message).toMatch(/entero/i)

    expect(await stockExacto(fx.branchA.id, fx.productoA.id), 'no toco el stock').toBe('10.000')
  })

  it('un ajuste fraccionado tambien respeta la unidad', async () => {
    const { PATCH } = await import('@/app/api/stock/[id]/route')

    const bueno = await call(PATCH, `/api/stock/${String(fx.productoPeso.id)}`, {
      method: 'PATCH',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoPeso.id) },
      body: { delta: '-0.750', type: 'BREAKAGE', reason: 'Se cayo el corte' },
    })
    expect(bueno.status).toBe(200)
    expect(await stockExacto(fx.branchA.id, fx.productoPeso.id)).toBe('4.250')

    const malo = await call(PATCH, `/api/stock/${String(fx.productoA.id)}`, {
      method: 'PATCH',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
      body: { delta: '0.500', reason: 'Media botella' },
    })
    expect(malo.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// Costo
// ---------------------------------------------------------------------------

describe('El costo no viaja hacia quien no lo puede ver', () => {
  beforeEach(async () => {
    await prisma.product.update({
      where: { id: fx.productoA.id },
      data: { cost: '7500.0000' },
    })
  })

  async function catalogo(usuario: Parameters<typeof sessionCookie>[0]) {
    const { GET } = await import('@/app/api/products/route')
    return call<{ data: Array<Record<string, unknown>> }>(GET, '/api/products', {
      cookie: await sessionCookie(usuario),
    })
  }

  it('el administrador lo recibe, con su rentabilidad calculada', async () => {
    const res = await catalogo(fx.admin)
    const producto = res.body.data.find((p) => p.id === fx.productoA.id)

    expect(producto?.cost).toBe('7500.0000')
    expect(producto?.rentabilidad).toMatchObject({ margen: '40.00', markup: '66.67' })
  })

  it('el cajero NO recibe la clave: no esta, no viene en null', async () => {
    // La diferencia importa. Un `cost: null` seria indistinguible de "no hay
    // costo cargado", y ademas el valor no tiene que viajar: una respuesta de
    // la API se lee con las herramientas del navegador sin saber programar.
    const res = await catalogo(fx.cajero)
    const producto = res.body.data.find((p) => p.id === fx.productoA.id)

    expect(producto).toBeDefined()
    expect('cost' in (producto ?? {}), 'el costo llego al cajero').toBe(false)
    expect('rentabilidad' in (producto ?? {})).toBe(false)
  })

  it('el JSON crudo del cajero no contiene el numero por ningun lado', async () => {
    const res = await catalogo(fx.cajero)
    expect(JSON.stringify(res.body)).not.toContain('7500')
  })

  it('la busqueda por codigo de la caja tampoco lo lleva', async () => {
    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    const res = await call<Record<string, unknown>>(
      GET,
      `/api/products/barcode/${fx.productoA.barcode}`,
      { cookie: await sessionCookie(fx.cajero), params: { code: fx.productoA.barcode } },
    )

    expect(res.status).toBe(200)
    expect('cost' in res.body, 'para cobrar no hace falta saber cuanto costo').toBe(false)
  })

  it('el detalle del producto respeta la misma regla', async () => {
    const { GET } = await import('@/app/api/products/[id]/route')
    const res = await call<Record<string, unknown>>(
      GET,
      `/api/products/${String(fx.productoA.id)}`,
      { cookie: await sessionCookie(fx.cajero), params: { id: String(fx.productoA.id) } },
    )
    expect('cost' in res.body).toBe(false)
  })
})

describe('Cambio de costo', () => {
  async function cambiar(usuario: Parameters<typeof sessionCookie>[0], body: unknown) {
    const { PUT } = await import('@/app/api/products/[id]/cost/route')
    return call(PUT, `/api/products/${String(fx.productoA.id)}/cost`, {
      method: 'PUT',
      cookie: await sessionCookie(usuario),
      params: { id: String(fx.productoA.id) },
      body,
    })
  }

  it('exige el permiso, que NO es el del precio', async () => {
    // El cajero tampoco puede, pero lo interesante es el supervisor: tiene
    // permisos de mostrador y sigue sin poder tocar el costo.
    const res = await cambiar(fx.cajero, { cost: '8000.00', reason: 'Aumento' })
    expect(res.status).toBe(403)
  })

  it('exige motivo', async () => {
    const res = await cambiar(fx.admin, { cost: '8000.00', reason: '' })
    expect(res.status).toBe(400)
  })

  it('deja fila en el historial con el anterior y el nuevo', async () => {
    const res = await cambiar(fx.admin, { cost: '8000.00', reason: 'Lista de mayo' })
    expect(res.status).toBe(200)

    const historial = await prisma.productCostHistory.findMany({
      where: { productId: fx.productoA.id },
    })
    expect(historial).toHaveLength(1)
    expect(historial[0]?.previousCost, 'el catalogo migrado parte de "no sabemos"').toBeNull()
    expect(historial[0]?.newCost?.toFixed(4)).toBe('8000.0000')
    expect(historial[0]?.reason).toBe('Lista de mayo')
    expect(historial[0]?.userId).toBe(fx.admin.id)
    // Un cambio MANUAL desde la ficha no viene de ninguna compra: los dos
    // vinculos quedan vacios. Los llena la recepcion de mercaderia.
    expect(historial[0]?.supplierId).toBeNull()
    expect(historial[0]?.receiptId).toBeNull()
  })

  it('el segundo cambio encadena con el primero', async () => {
    await cambiar(fx.admin, { cost: '8000.00', reason: 'Lista de mayo' })
    await cambiar(fx.admin, { cost: '8600.00', reason: 'Lista de junio' })

    const historial = await prisma.productCostHistory.findMany({
      where: { productId: fx.productoA.id },
      orderBy: { id: 'asc' },
    })
    expect(historial).toHaveLength(2)
    expect(historial[1]?.previousCost?.toFixed(4)).toBe('8000.0000')
    expect(historial[1]?.newCost?.toFixed(4)).toBe('8600.0000')
  })

  it('un cambio que no cambia nada se rechaza', async () => {
    await cambiar(fx.admin, { cost: '8000.00', reason: 'Lista de mayo' })
    const res = await cambiar(fx.admin, { cost: '8000.00', reason: 'De nuevo' })
    expect(res.status).toBe(400)
    expect(await prisma.productCostHistory.count()).toBe(1)
  })

  it('el historial es INMUTABLE, incluso con SQL directo', async () => {
    await cambiar(fx.admin, { cost: '8000.00', reason: 'Lista de mayo' })
    const fila = await prisma.productCostHistory.findFirstOrThrow()

    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE "ProductCostHistory" SET "newCost" = 1 WHERE "id" = ${String(fila.id)}`,
      ),
    ).rejects.toThrow(/inmutable/i)

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "ProductCostHistory" WHERE "id" = ${String(fila.id)}`),
    ).rejects.toThrow(/inmutable/i)
  })

  it('dar de baja el producto NO borra su historial de costos', async () => {
    await cambiar(fx.admin, { cost: '8000.00', reason: 'Lista de mayo' })

    const { PUT } = await import('@/app/api/products/[id]/route')
    await call(PUT, `/api/products/${String(fx.productoA.id)}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoA.id) },
      body: { isActive: false },
    })

    expect(await prisma.productCostHistory.count()).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Codigos de barras
// ---------------------------------------------------------------------------

describe('Codigos de barras multiples', () => {
  async function buscar(codigo: string) {
    const { GET } = await import('@/app/api/products/barcode/[code]/route')
    return call<{ id: number; name: string }>(GET, `/api/products/barcode/${codigo}`, {
      cookie: await sessionCookie(fx.cajero),
      params: { code: codigo },
    })
  }

  it('el codigo migrado quedo como principal', async () => {
    const codigos = await prisma.productBarcode.findMany({ where: { productId: fx.productoA.id } })
    expect(codigos).toHaveLength(1)
    expect(codigos[0]?.code).toBe(fx.productoA.barcode)
    expect(codigos[0]?.isPrimary).toBe(true)
  })

  it('un alternativo encuentra el MISMO producto, igual que el principal', async () => {
    await prisma.productBarcode.create({
      data: { productId: fx.productoA.id, code: '7790895099999', isPrimary: false },
    })

    const porPrincipal = await buscar(fx.productoA.barcode)
    const porAlternativo = await buscar('7790895099999')

    expect(porPrincipal.status).toBe(200)
    expect(porAlternativo.status).toBe(200)
    expect(porAlternativo.body.id, 'los dos codigos son el mismo producto').toBe(porPrincipal.body.id) // prettier-ignore
    expect(porAlternativo.body.name).toBe(porPrincipal.body.name)
  })

  it('un codigo que no existe da 404, no un producto cualquiera', async () => {
    const res = await buscar('0000000000000')
    expect(res.status).toBe(404)
  })

  it('un codigo de OTRA sucursal se comporta como uno que no existe', async () => {
    const res = await buscar(fx.productoB.barcode)
    expect(res.status).toBe(404)
  })

  it('el mismo codigo NUNCA apunta a dos productos', async () => {
    const { PUT } = await import('@/app/api/products/[id]/route')
    const res = await call(PUT, `/api/products/${String(fx.productoPeso.id)}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoPeso.id) },
      body: { barcode: fx.productoA.barcode },
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('DUPLICATE_BARCODE')
    // Y el mensaje dice DE QUE producto es, que es lo unico que sirve.
    expect(errorDe(res).message).toContain(fx.productoA.name)
  })

  it('la base lo impide aunque el servicio no llegue a comprobarlo', async () => {
    await expect(
      prisma.productBarcode.create({
        data: { productId: fx.productoPeso.id, code: fx.productoA.barcode, isPrimary: false },
      }),
    ).rejects.toThrow()
  })

  it('un producto tiene UN solo codigo principal', async () => {
    await expect(
      prisma.productBarcode.create({
        data: { productId: fx.productoA.id, code: '7790895088888', isPrimary: true },
      }),
    ).rejects.toThrow()
  })

  it('se cargan y se quitan alternativos desde la ficha', async () => {
    const { PUT, GET } = await import('@/app/api/products/[id]/route')
    const cookie = await sessionCookie(fx.admin)

    await call(PUT, `/api/products/${String(fx.productoA.id)}`, {
      method: 'PUT',
      cookie,
      params: { id: String(fx.productoA.id) },
      body: { alternateBarcodes: ['ALT001', 'ALT002'] },
    })

    const conDos = await call<{ barcode: string; alternateBarcodes: string[] }>(
      GET,
      `/api/products/${String(fx.productoA.id)}`,
      { cookie, params: { id: String(fx.productoA.id) } },
    )
    expect(conDos.body.barcode, 'el principal no se toco').toBe(fx.productoA.barcode)
    expect(conDos.body.alternateBarcodes.sort()).toEqual(['ALT001', 'ALT002'])

    await call(PUT, `/api/products/${String(fx.productoA.id)}`, {
      method: 'PUT',
      cookie,
      params: { id: String(fx.productoA.id) },
      body: { alternateBarcodes: ['ALT001'] },
    })

    const conUno = await call<{ alternateBarcodes: string[] }>(
      GET,
      `/api/products/${String(fx.productoA.id)}`,
      { cookie, params: { id: String(fx.productoA.id) } },
    )
    expect(conUno.body.alternateBarcodes).toEqual(['ALT001'])
    expect(await buscar('ALT002'), 'el que se quito ya no encuentra nada').toMatchObject({
      status: 404,
    })
  })

  it('buscar por texto encuentra por cualquiera de los codigos', async () => {
    await prisma.productBarcode.create({
      data: { productId: fx.productoA.id, code: 'ALT4242', isPrimary: false },
    })

    const { GET } = await import('@/app/api/products/route')
    const res = await call<{ data: Array<{ id: number }> }>(GET, '/api/products?q=ALT4242', {
      cookie: await sessionCookie(fx.cajero),
    })
    expect(res.body.data).toHaveLength(1)
    expect(res.body.data[0]?.id).toBe(fx.productoA.id)
  })
})

// ---------------------------------------------------------------------------
// La unidad de venta se congela con el historial
// ---------------------------------------------------------------------------

describe('La unidad de venta no se cambia si hay historial', () => {
  async function cambiarUnidad(productId: number, saleUnit: string) {
    const { PUT } = await import('@/app/api/products/[id]/route')
    return call(PUT, `/api/products/${String(productId)}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(productId) },
      body: { saleUnit },
    })
  }

  it('un producto SIN historial si se corrige', async () => {
    const { POST } = await import('@/app/api/products/route')
    const alta = await call<{ id: number }>(POST, '/api/products', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        name: 'Aceituna suelta',
        price: '5600.00',
        categoryId: fx.categoryId,
        saleUnit: 'UNIT',
        totalStock: '0',
      },
    })

    const res = await cambiarUnidad(alta.body.id, 'KG')
    expect(res.status).toBe(200)
  })

  it('uno CON movimientos no: su pasado esta escrito en la unidad anterior', async () => {
    const res = await cambiarUnidad(fx.productoA.id, 'KG')
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('PRODUCT_UNIT_LOCKED')
    expect(errorDe(res).message).toMatch(/movimiento/i)
  })

  it('la base lo impide aunque alguien lo intente por fuera', async () => {
    await expect(
      prisma.product.update({ where: { id: fx.productoA.id }, data: { saleUnit: 'KG' } }),
    ).rejects.toThrow(/unidad de venta/i)
  })
})
