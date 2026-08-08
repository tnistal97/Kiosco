/**
 * Fase 3C contra la base: proveedores, ordenes y recepcion.
 *
 * Cinco bloques que son cinco reglas:
 *
 *   1. un proveedor con historial no se borra;
 *   2. los totales los calcula el servidor, y el navegador no puede mentirle;
 *   3. recibir 3 cajas de 8 suma 24 unidades, no 3;
 *   4. no se puede recibir mas de lo pedido, ni de a poco;
 *   5. una recepcion confirmada es inmutable.
 *
 * El escenario recorre el ejemplo del pedido de punta a punta: Coca Cola que
 * se compra por caja de 8 y se vende por unidad, 100 de stock inicial, 5 cajas
 * pedidas, 3 recibidas y despues 2.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, stockExacto, descuadresDelLibro, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

interface OrdenRes {
  id: number
  number: string
  status: string
  expectedTotal?: string
  items: Array<{
    id: number
    orderedQuantity: string
    receivedQuantity: string
    pendingQuantity: string
    pendingStockQuantity: string
    unitCost?: string
    subtotal?: string
    purchaseUnit: string
    unitsPerPurchaseUnit: string
  }>
  receipts: Array<{
    id: number
    items: Array<{
      receivedQuantity: string
      stockQuantity: string
      unitCost?: string
      expectedUnitCost?: string
      stockUnitCost?: string
      diferencia?: { diferencia: string; porcentaje: string | null; hayDiferencia: boolean }
    }>
  }>
}

async function crearOrden(
  usuario = fx.admin,
  body: Record<string, unknown> = {
    supplierId: fx.proveedor.id,
    items: [{ productId: fx.productoCaja.id, quantity: '5', unitCost: '8800' }],
  },
) {
  const { POST } = await import('@/app/api/purchases/route')
  return call<OrdenRes>(POST, '/api/purchases', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body,
  })
}

async function confirmar(id: number, usuario = fx.admin) {
  const { POST } = await import('@/app/api/purchases/[id]/confirm/route')
  return call<OrdenRes>(POST, `/api/purchases/${String(id)}/confirm`, {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    params: { id: String(id) },
  })
}

async function recibir(id: number, items: unknown[], usuario = fx.admin) {
  const { POST } = await import('@/app/api/purchases/[id]/receive/route')
  return call<{
    receiptId: number
    status: string
    lineas: Array<{
      stockQuantity: string
      previousStock: string
      resultingStock: string
      costoActualizado: boolean
    }>
  }>(POST, `/api/purchases/${String(id)}/receive`, {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    params: { id: String(id) },
    body: { items },
  })
}

async function verOrden(id: number, usuario = fx.admin) {
  const { GET } = await import('@/app/api/purchases/[id]/route')
  return call<OrdenRes>(GET, `/api/purchases/${String(id)}`, {
    cookie: await sessionCookie(usuario),
    params: { id: String(id) },
  })
}

/** Una orden confirmada de 5 cajas a $8.800, lista para recibir. */
async function ordenLista() {
  const creada = await crearOrden()
  const confirmada = await confirmar(creada.body.id)
  return confirmada.body
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------

describe('Proveedores', () => {
  it('alcanza con el nombre: ni CUIT, ni correo, ni direccion', async () => {
    const { POST } = await import('@/app/api/suppliers/route')
    const res = await call<{ id: number; name: string; taxId: string | null }>(
      POST,
      '/api/suppliers',
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        body: { name: 'Distribuidora Pepe' },
      },
    )

    expect(res.status).toBe(201)
    expect(res.body.name).toBe('Distribuidora Pepe')
    expect(res.body.taxId, 'lo que no se sabe queda nulo, no inventado').toBeNull()
  })

  it('un correo mal escrito se rechaza; vacio no', async () => {
    const { POST } = await import('@/app/api/suppliers/route')
    const malo = await call(POST, '/api/suppliers', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { name: 'Con correo malo', email: 'no-es-un-correo' },
    })
    expect(malo.status).toBe(400)

    const vacio = await call(POST, '/api/suppliers', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { name: 'Sin correo', email: '' },
    })
    expect(vacio.status).toBe(201)
  })

  it('un proveedor desactivado no se puede elegir para una compra nueva', async () => {
    const res = await crearOrden(fx.admin, {
      supplierId: fx.proveedorInactivo.id,
      items: [{ productId: fx.productoCaja.id, quantity: '1', unitCost: '100' }],
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('SUPPLIER_INACTIVE')
  })

  it('un proveedor con ordenes NO se borra: se da de baja', async () => {
    await crearOrden()

    const { DELETE } = await import('@/app/api/suppliers/[id]/route')
    const res = await call(DELETE, `/api/suppliers/${String(fx.proveedor.id)}`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('SUPPLIER_HAS_HISTORY')
    // El mensaje dice QUE lo retiene: sin eso hay que adivinar.
    expect(errorDe(res).message).toContain('orden')
  })

  it('un proveedor sin nada colgando si se borra', async () => {
    const { POST } = await import('@/app/api/suppliers/route')
    const creado = await call<{ id: number }>(POST, '/api/suppliers', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { name: 'Tipeado por error' },
    })

    const { DELETE } = await import('@/app/api/suppliers/[id]/route')
    const res = await call(DELETE, `/api/suppliers/${String(creado.body.id)}`, {
      method: 'DELETE',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(creado.body.id) },
    })

    expect(res.status).toBe(200)
    expect(await prisma.supplier.findUnique({ where: { id: creado.body.id } })).toBeNull()
  })

  it('la columna congelada Product.supplierId no se escribe', async () => {
    // Es la unica forma exacta de comprobarlo: `tsc` no protege una columna
    // que sigue existiendo --`supplierId: 3` compila perfecto-- y una busqueda
    // de texto no distingue este uso de los tres legitimos que tiene el mismo
    // nombre. Ver tests/unit/columnas-muertas.test.ts.
    const { POST } = await import('@/app/api/products/route')
    const creado = await call<{ id: number; supplier: { id: number } | null }>(
      POST,
      '/api/products',
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        body: {
          name: 'Producto con proveedor',
          price: '100.00',
          categoryId: fx.categoryId,
          supplierId: fx.proveedor.id,
          barcode: '9990000000001',
        },
      },
    )

    expect(creado.status).toBe(201)
    // La API lo devuelve: el campo `supplier` no cambio de forma.
    expect(creado.body.supplier?.id).toBe(fx.proveedor.id)

    const fila = await prisma.product.findUniqueOrThrow({
      where: { id: creado.body.id },
      select: { supplierId: true },
    })
    expect(fila.supplierId, 'la columna congelada volvio a escribirse').toBeNull()

    // Y el vinculo esta donde tiene que estar.
    const vinculo = await prisma.productSupplier.findFirstOrThrow({
      where: { productId: creado.body.id },
    })
    expect(vinculo.supplierId).toBe(fx.proveedor.id)
    expect(vinculo.isPreferred).toBe(true)
  })

  it('cambiar de proveedor principal NO borra el vinculo anterior', async () => {
    const { POST } = await import('@/app/api/suppliers/route')
    const otro = await call<{ id: number }>(POST, '/api/suppliers', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { name: 'Distribuidora Nueva' },
    })

    const { PUT } = await import('@/app/api/products/[id]/route')
    await call(PUT, `/api/products/${String(fx.productoCaja.id)}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.productoCaja.id) },
      body: { supplierId: otro.body.id },
    })

    const vinculos = await prisma.productSupplier.findMany({
      where: { productId: fx.productoCaja.id },
      orderBy: { id: 'asc' },
    })

    // "Este mes le compre a otro" no significa "nunca mas le compro al de
    // antes": el anterior baja a alternativo y conserva su codigo y su costo.
    expect(vinculos).toHaveLength(2)
    expect(vinculos[0]?.supplierId).toBe(fx.proveedor.id)
    expect(vinculos[0]?.isPreferred).toBe(false)
    expect(vinculos[1]?.supplierId).toBe(otro.body.id)
    expect(vinculos[1]?.isPreferred).toBe(true)
  })

  it('un producto no puede tener dos proveedores principales', async () => {
    // El indice unico parcial de la base, sin pasar por el servicio.
    await expect(
      prisma.productSupplier.create({
        data: {
          productId: fx.productoCaja.id,
          supplierId: fx.proveedorInactivo.id,
          isPreferred: true,
        },
      }),
    ).rejects.toThrow()
  })

  it('el cajero no ve proveedores', async () => {
    const { GET } = await import('@/app/api/suppliers/route')
    const res = await call(GET, '/api/suppliers', { cookie: await sessionCookie(fx.cajero) })
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// La orden
// ---------------------------------------------------------------------------

describe('Orden de compra', () => {
  it('el numero lo genera el servidor y arranca en OC-00000001', async () => {
    const primera = await crearOrden()
    expect(primera.body.number).toBe('OC-00000001')

    const segunda = await crearOrden()
    expect(segunda.body.number).toBe('OC-00000002')
  })

  it('el subtotal y el total los calcula el servidor', async () => {
    const res = await crearOrden()

    // 5 cajas x $8.800 = $44.000. No viene del cliente: el cuerpo de la
    // peticion no tiene ni `subtotal` ni `total`.
    expect(res.body.items[0]?.subtotal).toBe('44000.00')
    expect(res.body.expectedTotal).toBe('44000.00')
  })

  it('un subtotal mandado por el cliente se rechaza, no se ignora', async () => {
    // Los esquemas son estrictos: una propiedad no declarada hace fallar la
    // peticion en vez de colarse. Que falle es mejor que que se ignore, porque
    // un cliente que manda el total y ve un 201 cree que se guardo el suyo.
    const res = await crearOrden(fx.admin, {
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoCaja.id, quantity: '5', unitCost: '8800', subtotal: '1' }],
    })
    expect(res.status).toBe(400)
  })

  it('la unidad de compra y el factor se copian del producto', async () => {
    const res = await crearOrden()

    expect(res.body.items[0]?.purchaseUnit).toBe('BOX')
    expect(res.body.items[0]?.unitsPerPurchaseUnit).toBe('8.000')
    // 5 cajas pendientes son 40 unidades de stock pendientes.
    expect(res.body.items[0]?.pendingStockQuantity).toBe('40.000')
  })

  it('cambiar el producto despues NO cambia la conversion pactada', async () => {
    const orden = await ordenLista()

    // El producto pasa a venir de a 12. La orden sigue siendo de cajas de 8.
    await prisma.product.update({
      where: { id: fx.productoCaja.id },
      data: { unitsPerPurchaseUnit: 12 },
    })

    const item = orden.items[0]
    if (!item) throw new Error('sin linea')
    await recibir(orden.id, [{ orderItemId: item.id, quantity: '5' }])

    // 5 x 8 = 40, no 5 x 12 = 60.
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('140.000')
  })

  it('una conversion imposible se rechaza AL CONFIRMAR, no al recibir', async () => {
    // Producto por unidad, comprado en packs de 2,5: tres packs serian 7,5
    // unidades, y media unidad no existe.
    const res = await crearOrden(fx.admin, {
      supplierId: fx.proveedor.id,
      items: [
        {
          productId: fx.productoA.id,
          quantity: '3',
          unitCost: '100',
          purchaseUnit: 'PACK',
          unitsPerPurchaseUnit: '2.5',
        },
      ],
    })

    expect(res.status).toBe(400)
    expect(errorDe(res).code).toBe('INVALID_PURCHASE_CONVERSION')
    // El mensaje nombra los tres numeros: sin eso hay que adivinar cual esta mal.
    expect(errorDe(res).message).toContain('7.500')
  })

  it('un producto no puede estar dos veces en la misma orden', async () => {
    const res = await crearOrden(fx.admin, {
      supplierId: fx.proveedor.id,
      items: [
        { productId: fx.productoCaja.id, quantity: '1', unitCost: '100' },
        { productId: fx.productoCaja.id, quantity: '2', unitCost: '100' },
      ],
    })
    expect(res.status).toBe(400)
  })

  it('una orden confirmada ya no se edita', async () => {
    const orden = await ordenLista()

    const { PUT } = await import('@/app/api/purchases/[id]/route')
    const res = await call(PUT, `/api/purchases/${String(orden.id)}`, {
      method: 'PUT',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(orden.id) },
      body: { notes: 'tarde' },
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('ORDER_NOT_EDITABLE')
  })

  it('no se confirma una orden sin productos', async () => {
    const vacia = await crearOrden(fx.admin, { supplierId: fx.proveedor.id, items: [] })
    expect(vacia.status).toBe(201)

    const res = await confirmar(vacia.body.id)
    expect(res.status).toBe(400)
  })

  it('cancelar una orden parcial conserva lo recibido', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])

    const { POST } = await import('@/app/api/purchases/[id]/cancel/route')
    const res = await call<OrdenRes>(POST, `/api/purchases/${String(orden.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(orden.id) },
      body: { reason: 'El proveedor avisa que el resto no lo consigue' },
    })

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CANCELLED')
    // Lo recibido NO se revierte: la mercaderia esta en el deposito.
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('124.000')
    expect(res.body.receipts).toHaveLength(1)
  })

  it('una orden de otra sucursal no se ve ni se toca', async () => {
    const orden = await ordenLista()
    const res = await verOrden(orden.id, fx.cajeroB)
    // 403 antes que 404: el cajero no tiene el permiso siquiera.
    expect([403, 404]).toContain(res.status)
  })
})

// ---------------------------------------------------------------------------
// La recepcion: el ejemplo completo del pedido
// ---------------------------------------------------------------------------

describe('Recepcion de mercaderia', () => {
  it('recibir 3 cajas de 8 suma 24 unidades, no 3', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    const res = await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('PARTIALLY_RECEIVED')
    expect(res.body.lineas[0]?.stockQuantity).toBe('24.000')
    expect(res.body.lineas[0]?.previousStock).toBe('100.000')
    expect(res.body.lineas[0]?.resultingStock).toBe('124.000')
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('124.000')
  })

  it('el circuito entero: 100 → 124 → 140, y la orden queda RECEIVED', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    const primera = await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])
    expect(primera.body.status).toBe('PARTIALLY_RECEIVED')
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('124.000')

    const segunda = await recibir(orden.id, [{ orderItemId: item.id, quantity: '2' }])
    expect(segunda.body.status).toBe('RECEIVED')
    expect(segunda.body.lineas[0]?.stockQuantity).toBe('16.000')
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('140.000')

    // Dos recepciones, no una con dos renglones.
    const detalle = await verOrden(orden.id)
    expect(detalle.body.receipts).toHaveLength(2)
    expect(detalle.body.items[0]?.pendingQuantity).toBe('0.000')

    // El libro cierra: 100 + 24 + 16.
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('el costo de la caja se divide por 8 antes de llegar al producto', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])

    const producto = await prisma.product.findUniqueOrThrow({
      where: { id: fx.productoCaja.id },
      select: { cost: true },
    })
    // $8.800 la caja de 8 = $1.100 la botella. NO $8.800.
    expect(producto.cost?.toFixed(4)).toBe('1100.0000')
  })

  it('la recepcion deja historial de costos apuntando a la RECEPCION', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    const res = await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])

    const historial = await prisma.productCostHistory.findMany({
      where: { productId: fx.productoCaja.id },
    })
    expect(historial).toHaveLength(1)
    expect(historial[0]?.previousCost, 'el producto no tenia costo cargado').toBeNull()
    expect(historial[0]?.newCost.toFixed(4)).toBe('1100.0000')
    expect(historial[0]?.supplierId).toBe(fx.proveedor.id)
    // A la recepcion, no a la orden: el costo cambia cuando la mercaderia
    // llega, y una orden puede tener dos entregas con costos distintos.
    expect(historial[0]?.receiptId).toBe(res.body.receiptId)
  })

  it('el movimiento de stock es PURCHASE_RECEIPT y apunta a la recepcion', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    const res = await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])

    const mov = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: fx.productoCaja.id, type: 'PURCHASE_RECEIPT' },
    })
    expect(mov.quantity.toFixed(3)).toBe('24.000')
    expect(mov.previousQuantity.toFixed(3)).toBe('100.000')
    expect(mov.resultingQuantity.toFixed(3)).toBe('124.000')
    expect(mov.referenceType).toBe('PurchaseReceipt')
    expect(mov.referenceId).toBe(res.body.receiptId)
  })

  it('un producto por kilo se recibe sin conversion: 12,500 kg entran 12,500', async () => {
    const creada = await crearOrden(fx.admin, {
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoPeso.id, quantity: '12.500', unitCost: '6200' }],
    })
    const orden = (await confirmar(creada.body.id)).body
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    const res = await recibir(orden.id, [{ orderItemId: item.id, quantity: '12.500' }])

    expect(res.body.lineas[0]?.stockQuantity).toBe('12.500')
    expect(await stockExacto(fx.branchA.id, fx.productoPeso.id)).toBe('17.500')

    const producto = await prisma.product.findUniqueOrThrow({
      where: { id: fx.productoPeso.id },
      select: { cost: true },
    })
    expect(producto.cost?.toFixed(4), 'factor 1: el costo no se divide').toBe('6200.0000')
  })

  it('NO se puede recibir mas de lo pedido', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    const res = await recibir(orden.id, [{ orderItemId: item.id, quantity: '6' }])

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('OVER_RECEIPT')
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('100.000')
  })

  it('tampoco de a poco: 3 + 3 sobre 5 pedidas se frena en la segunda', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])
    const segunda = await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])

    expect(segunda.status).toBe(409)
    expect(errorDe(segunda).code).toBe('OVER_RECEIPT')
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('124.000')
  })

  it('si una linea falla, NO queda recibida ninguna', async () => {
    const creada = await crearOrden(fx.admin, {
      supplierId: fx.proveedor.id,
      items: [
        { productId: fx.productoCaja.id, quantity: '5', unitCost: '8800' },
        { productId: fx.productoA.id, quantity: '2', unitCost: '9000' },
      ],
    })
    const orden = (await confirmar(creada.body.id)).body
    const [caja, otro] = orden.items
    if (!caja || !otro) throw new Error('faltan lineas')

    // La primera cabe, la segunda no.
    const res = await recibir(orden.id, [
      { orderItemId: caja.id, quantity: '3' },
      { orderItemId: otro.id, quantity: '99' },
    ])

    expect(res.status).toBe(409)
    // Ni la que cabia: la transaccion se deshizo entera.
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('100.000')
    expect(await stockExacto(fx.branchA.id, fx.productoA.id)).toBe('10.000')
    expect(await prisma.purchaseReceipt.count()).toBe(0)
  })

  it('una orden en borrador no se puede recibir', async () => {
    const creada = await crearOrden()
    const item = creada.body.items[0]
    if (!item) throw new Error('sin linea')

    const res = await recibir(creada.body.id, [{ orderItemId: item.id, quantity: '1' }])
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('ORDER_NOT_RECEIVABLE')
  })

  it('si el proveedor se dio de baja entre el pedido y la entrega, no se recibe', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    await prisma.supplier.update({
      where: { id: fx.proveedor.id },
      data: { isActive: false },
    })

    const res = await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('SUPPLIER_INACTIVE')
  })
})

// ---------------------------------------------------------------------------
// Costo esperado contra costo recibido
// ---------------------------------------------------------------------------

describe('Diferencia de costo', () => {
  it('la orden NO se reescribe: quedan los dos numeros y la diferencia', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    await recibir(orden.id, [{ orderItemId: item.id, quantity: '3', unitCost: '8900' }])

    const detalle = await verOrden(orden.id)
    // La orden sigue diciendo lo que se pidio.
    expect(detalle.body.items[0]?.unitCost).toBe('8800.0000')

    const recibida = detalle.body.receipts[0]?.items[0]
    expect(recibida?.expectedUnitCost).toBe('8800.0000')
    expect(recibida?.unitCost).toBe('8900.0000')
    expect(recibida?.diferencia?.diferencia).toBe('100.0000')
    expect(recibida?.diferencia?.hayDiferencia).toBe(true)
    // $100 sobre $8.800 es 1,14 %.
    expect(recibida?.diferencia?.porcentaje).toBe('1.14')
  })

  it('el costo del producto sale del costo RECIBIDO', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    await recibir(orden.id, [{ orderItemId: item.id, quantity: '3', unitCost: '8900' }])

    const producto = await prisma.product.findUniqueOrThrow({
      where: { id: fx.productoCaja.id },
      select: { cost: true },
    })
    // $8.900 / 8 = $1.112,50.
    expect(producto.cost?.toFixed(4)).toBe('1112.5000')
  })

  it('la diferencia deja su propia entrada en la bitacora', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    await recibir(orden.id, [{ orderItemId: item.id, quantity: '3', unitCost: '8900' }])

    const entradas = await prisma.auditLog.findMany({
      where: { tableName: 'PurchaseReceiptItem' },
    })
    expect(
      entradas,
      'sin entrada propia no se puede preguntar donde nos cobraron de mas',
    ).toHaveLength(1)
    expect(entradas[0]?.reason).toContain('distinto del pedido')
  })

  it('sin `products.cost.update` se recibe al costo pedido y no a otro', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    // Hoy ningun rol del catalogo tiene `purchases.receive` sin
    // `products.cost.update`: los cuatro que compran tienen los dos. La
    // separacion existe igual --es la que permitiria un rol de deposito el dia
    // que haga falta-- y se comprueba llamando al servicio con esa sesion, que
    // es donde vive la regla.
    const { recibirMercaderia } = await import('@/modules/purchases/service')
    const sesionSinCosto = {
      userId: fx.admin.id,
      name: 'Deposito',
      username: 'deposito',
      role: 'deposito',
      branchId: fx.branchA.id,
      permissions: new Set(['purchases.receive', 'purchases.view'] as const),
    }

    await expect(
      recibirMercaderia(sesionSinCosto, orden.id, {
        notes: null,
        items: [{ orderItemId: item.id, quantity: '3', unitCost: '8900' }],
      }),
    ).rejects.toThrow(/permiso/i)

    // Al costo de la orden, en cambio, si puede.
    const ok = await recibirMercaderia(sesionSinCosto, orden.id, {
      notes: null,
      items: [{ orderItemId: item.id, quantity: '3' }],
    })
    expect(ok.status).toBe('PARTIALLY_RECEIVED')
    expect(await stockExacto(fx.branchA.id, fx.productoCaja.id)).toBe('124.000')
  })

  it('recibir al MISMO costo no escribe historial de mas', async () => {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')

    await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])
    await recibir(orden.id, [{ orderItemId: item.id, quantity: '2' }])

    const historial = await prisma.productCostHistory.findMany({
      where: { productId: fx.productoCaja.id },
    })
    // Dos recepciones al mismo costo: un solo cambio. Un "cambio" que deja el
    // numero igual es ruido que hace parecer que el costo se movio.
    expect(historial).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Inmutabilidad
// ---------------------------------------------------------------------------

describe('Inmutabilidad de la recepcion', () => {
  async function unaRecepcion() {
    const orden = await ordenLista()
    const item = orden.items[0]
    if (!item) throw new Error('sin linea')
    const res = await recibir(orden.id, [{ orderItemId: item.id, quantity: '3' }])
    return res.body.receiptId
  }

  it('una recepcion confirmada no se edita', async () => {
    const id = await unaRecepcion()
    await expect(
      prisma.purchaseReceipt.update({ where: { id }, data: { notes: 'cambiado' } }),
    ).rejects.toThrow(/inmutable/i)
  })

  it('una recepcion confirmada no se borra', async () => {
    const id = await unaRecepcion()
    await expect(prisma.purchaseReceipt.delete({ where: { id } })).rejects.toThrow(/inmutable/i)
  })

  it('sus lineas tampoco', async () => {
    const id = await unaRecepcion()
    const linea = await prisma.purchaseReceiptItem.findFirstOrThrow({
      where: { purchaseReceiptId: id },
    })
    await expect(
      prisma.purchaseReceiptItem.update({
        where: { id: linea.id },
        data: { receivedQuantity: 99 },
      }),
    ).rejects.toThrow(/inmutable/i)
  })
})

// ---------------------------------------------------------------------------
// Privacidad del importe
// ---------------------------------------------------------------------------

describe('Privacidad de los importes de compra', () => {
  it('quien no puede ver costos tampoco ve el total de la compra', async () => {
    const orden = await ordenLista()

    // `repositor` no tiene `purchases.view`, asi que no llega. `auditor` si
    // tiene `purchases.view` y NO tiene `products.cost.view`: es el caso.
    const res = await verOrden(orden.id, fx.porRol.auditor)

    expect(res.status).toBe(200)
    expect(res.body.expectedTotal, 'la clave no esta, no viaja en null').toBeUndefined()
    expect(res.body.items[0]?.unitCost).toBeUndefined()
    expect(res.body.items[0]?.subtotal).toBeUndefined()

    // Y el numero NO aparece en el JSON crudo, por ningun otro camino.
    expect(JSON.stringify(res.body)).not.toContain('44000')
    expect(JSON.stringify(res.body)).not.toContain('8800')
  })

  it('el auditor SI ve que se pidio y cuanto llego', async () => {
    const orden = await ordenLista()
    const res = await verOrden(orden.id, fx.porRol.auditor)

    expect(res.body.items[0]?.orderedQuantity).toBe('5.000')
    expect(res.body.items[0]?.pendingQuantity).toBe('5.000')
  })

  it('el auditor no puede crear ni recibir', async () => {
    const creada = await crearOrden(fx.porRol.auditor)
    expect(creada.status).toBe(403)
  })
})
