/**
 * Fase 4C contra la base: devoluciones a proveedor.
 *
 * Recorre el segundo ejemplo del pedido, con sus números:
 *
 *   Recepción  $100.000  ->  saldo  100.000
 *   Pago       $100.000  ->  saldo        0
 *   Devolución  $20.000  ->  saldo  -20.000, y tenemos crédito a favor
 *
 * Nueve bloques que son nueve reglas:
 *
 *   1. un borrador NO mueve nada;
 *   2. el costo es el CONGELADO en la recepción, no el de hoy;
 *   3. no se devuelve más de lo que llegó;
 *   4. no se devuelve lo que ya no está en el depósito;
 *   5. confirmar saca stock por el libro, con tipo propio;
 *   6. confirmar acredita al proveedor, con la devolución como origen;
 *   7. sobre deuda pagada, el saldo queda a favor;
 *   8. las imputaciones históricas NO se mueven;
 *   9. una devolución confirmada es inmutable, incluso por SQL directo.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture, type TestUser } from '../helpers/db'
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

interface RecepcionRes {
  receiptId: number
  total: string
  saldoProveedor: string
}

/**
 * Una orden confirmada y recibida entera, del producto que se compra por caja.
 *
 * La fixture lo define con `unitsPerPurchaseUnit = 8`: 10 cajas son 80 unidades
 * de stock, y ese factor es el que hace interesante la conversión al devolver.
 */
async function recibir(cajas: string, costo: string): Promise<RecepcionRes> {
  const cookie = await sessionCookie(fx.admin)

  const { POST: crear } = await import('@/app/api/purchases/route')
  const orden = await call<{ id: number }>(crear, '/api/purchases', {
    method: 'POST',
    cookie,
    body: {
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoCaja.id, quantity: cajas, unitCost: costo }],
    },
  })

  const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
  const confirmada = await call<{ items: Array<{ id: number }> }>(
    confirmar,
    `/api/purchases/${String(orden.body.id)}/confirm`,
    { method: 'POST', cookie, params: { id: String(orden.body.id) } },
  )

  const { POST: recibirRuta } = await import('@/app/api/purchases/[id]/receive/route')
  const res = await call<RecepcionRes>(
    recibirRuta,
    `/api/purchases/${String(orden.body.id)}/receive`,
    {
      method: 'POST',
      cookie,
      params: { id: String(orden.body.id) },
      body: {
        items: [{ orderItemId: confirmada.body.items[0]?.id, quantity: cajas, unitCost: costo }],
      },
    },
  )
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

async function retornables(receiptId: number, usuario = fx.admin) {
  const { GET } = await import('@/app/api/purchases/recepciones/[id]/retornables/route')
  return call<{
    lineas: Array<{
      receiptItemId: number
      recibido: string
      devuelto: string
      disponible: string
      stockActual: string
      unitCost: string
    }>
  }>(GET, `/api/purchases/recepciones/${String(receiptId)}/retornables`, {
    cookie: await sessionCookie(usuario),
    params: { id: String(receiptId) },
  })
}

interface DevolucionRes {
  id: number
  number: string
  status: string
  total: string
  lineas: Array<{ productId: number; quantity: string; unitCost: string; amount: string }>
}

async function crearDevolucion(
  receiptId: number,
  cajas: string,
  usuario = fx.admin,
  extra: Record<string, unknown> = {},
) {
  const r = await retornables(receiptId)
  const linea = r.body.lineas[0]
  if (!linea) throw new Error('la entrega no tiene renglones')

  const { POST } = await import('@/app/api/devoluciones/route')
  return call<DevolucionRes>(POST, '/api/devoluciones', {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    body: {
      purchaseReceiptId: receiptId,
      reason: 'DAMAGED',
      notes: 'Dos cajas abiertas.',
      items: [{ receiptItemId: linea.receiptItemId, quantity: cajas }],
      ...extra,
    },
  })
}

async function confirmarDevolucion(id: number, usuario = fx.admin) {
  const { POST } = await import('@/app/api/devoluciones/[id]/confirmar/route')
  return call<{
    number: string
    status: string
    total: string
    saldoProveedor: string
    saldoAFavor: string
    movimientos: Array<{ productId: number; salio: string; stockResultante: string }>
  }>(POST, `/api/devoluciones/${String(id)}/confirmar`, {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    params: { id: String(id) },
  })
}

async function pagar(importe: string, extra: Record<string, unknown> = {}) {
  const { POST } = await import('@/app/api/suppliers/[id]/pagos/route')
  return call<{ id: number; number: string }>(
    POST,
    `/api/suppliers/${String(fx.proveedor.id)}/pagos`,
    {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
      body: { imputacion: 'automatica', amount: importe, method: 'TRANSFER', ...extra },
    },
  )
}

async function saldo(): Promise<string> {
  const p = await prisma.supplier.findUniqueOrThrow({
    where: { id: fx.proveedor.id },
    select: { balance: true },
  })
  return p.balance.toFixed(2)
}

async function stock(): Promise<string> {
  const s = await prisma.branchStock.findUniqueOrThrow({
    where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoCaja.id } },
    select: { quantity: true },
  })
  return s.quantity.toFixed(3)
}

function rol(nombre: string): TestUser {
  const u = fx.porRol[nombre]
  if (!u) throw new Error(`La fixture no tiene un usuario con rol ${nombre}`)
  return u
}

// ===========================================================================
// 1. El borrador no mueve nada
// ===========================================================================

describe('Un borrador es un papel', () => {
  it('crea la devolución con número, en DRAFT, y no toca stock ni saldo', async () => {
    const r = await recibir('10', '10000')
    const stockAntes = await stock()
    const saldoAntes = await saldo()

    const res = await crearDevolucion(r.receiptId, '2')

    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.status).toBe('DRAFT')
    expect(res.body.number).toMatch(/^DV-\d{8}$/)

    expect(await stock(), 'la mercadería sigue en el depósito').toBe(stockAntes)
    expect(await saldo(), 'el proveedor no acreditó nada').toBe(saldoAntes)
    expect(await prisma.stockMovement.count({ where: { type: 'PURCHASE_RETURN' } })).toBe(0)
    expect(await prisma.supplierAccountMovement.count({ where: { type: 'PURCHASE_CREDIT' } })).toBe(
      0,
    )
  })

  it('el número sale de una secuencia: dos devoluciones no lo repiten', async () => {
    const r = await recibir('10', '10000')
    const a = await crearDevolucion(r.receiptId, '1')
    const b = await crearDevolucion(r.receiptId, '1')
    expect(a.body.number).not.toBe(b.body.number)
  })

  it('dos borradores sobre la misma mercadería conviven: el tope se consume al confirmar', async () => {
    const r = await recibir('10', '10000')
    const a = await crearDevolucion(r.receiptId, '10')
    const b = await crearDevolucion(r.receiptId, '10')

    expect(a.status).toBe(201)
    expect(b.status, 'reservar en el borrador dejaría mercadería bloqueada').toBe(201)
  })

  it('se puede descartar, y descartada no confirma', async () => {
    const r = await recibir('10', '10000')
    const d = await crearDevolucion(r.receiptId, '2')

    const { POST: cancelar } = await import('@/app/api/devoluciones/[id]/cancelar/route')
    const res = await call(cancelar, `/api/devoluciones/${String(d.body.id)}/cancelar`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(d.body.id) },
      body: { reason: 'Al final el proveedor las acepta acá.' },
    })
    expect(res.status).toBe(200)

    const intento = await confirmarDevolucion(d.body.id)
    expect(intento.status).toBe(409)
    expect(errorDe(intento).code).toBe('RETURN_NOT_EDITABLE')
  })

  it('una devolución sin renglones no se puede crear', async () => {
    const r = await recibir('10', '10000')
    const { POST } = await import('@/app/api/devoluciones/route')
    const res = await call(POST, '/api/devoluciones', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { purchaseReceiptId: r.receiptId, reason: 'DAMAGED', items: [] },
    })
    expect(res.status).toBe(400)
  })

  it('el motivo OTHER exige nota', async () => {
    const r = await recibir('10', '10000')
    const res = await crearDevolucion(r.receiptId, '1', fx.admin, {
      reason: 'OTHER',
      notes: '',
    })
    expect(res.status).toBe(400)
  })
})

// ===========================================================================
// 2. El costo es el de la recepción
// ===========================================================================

describe('El costo congelado', () => {
  it('usa el de la entrega, aunque el producto valga otra cosa hoy', async () => {
    const r = await recibir('10', '1100')

    // El costo de hoy sube por otro camino: una entrega posterior más cara.
    await recibir('1', '1350')
    const producto = await prisma.product.findUniqueOrThrow({
      where: { id: fx.productoCaja.id },
      select: { cost: true },
    })
    // El costo de stock es el de compra dividido por 8 unidades por caja.
    expect(producto.cost?.toFixed(2)).toBe((1350 / 8).toFixed(2))

    const d = await crearDevolucion(r.receiptId, '8')

    expect(d.body.lineas[0]?.unitCost).toBe('1100.0000')
    expect(d.body.total, '8 x 1.100, no 8 x 1.350').toBe('8800.00')
  })

  it('el importe es la suma de sus renglones, calculada por el servidor', async () => {
    const r = await recibir('10', '1100')
    const d = await crearDevolucion(r.receiptId, '3')

    expect(d.body.total).toBe('3300.00')
    const fila = await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: d.body.id } })
    expect(fila.total.toFixed(2)).toBe('3300.00')
  })
})

// ===========================================================================
// 3. El tope histórico
// ===========================================================================

describe('No se devuelve más de lo que llegó', () => {
  it('la pantalla informa recibido, devuelto y disponible', async () => {
    const r = await recibir('40', '1000')
    const antes = await retornables(r.receiptId)

    expect(antes.body.lineas[0]?.recibido).toBe('40.000')
    expect(antes.body.lineas[0]?.devuelto).toBe('0.000')
    expect(antes.body.lineas[0]?.disponible).toBe('40.000')

    const d = await crearDevolucion(r.receiptId, '10')
    await confirmarDevolucion(d.body.id)

    const despues = await retornables(r.receiptId)
    expect(despues.body.lineas[0]?.devuelto).toBe('10.000')
    expect(despues.body.lineas[0]?.disponible, '40 recibidas, 10 devueltas').toBe('30.000')
  })

  it('rechaza pedir más de lo disponible', async () => {
    const r = await recibir('40', '1000')
    const d = await crearDevolucion(r.receiptId, '10')
    await confirmarDevolucion(d.body.id)

    const exceso = await crearDevolucion(r.receiptId, '31')
    expect(exceso.status).toBe(409)
    expect(errorDe(exceso).code).toBe('RETURN_EXCEEDS_RECEIVED')
  })

  it('solo cuentan las CONFIRMADAS: un borrador no consume el tope', async () => {
    const r = await recibir('40', '1000')
    await crearDevolucion(r.receiptId, '40')

    const otra = await retornables(r.receiptId)
    expect(otra.body.lineas[0]?.disponible, 'el borrador no sacó nada').toBe('40.000')
  })

  it('un renglón de otra entrega no entra', async () => {
    const a = await recibir('10', '1000')
    const b = await recibir('10', '1000')
    const ajena = await retornables(b.receiptId)

    const { POST } = await import('@/app/api/devoluciones/route')
    const res = await call(POST, '/api/devoluciones', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        purchaseReceiptId: a.receiptId,
        reason: 'DAMAGED',
        items: [{ receiptItemId: ajena.body.lineas[0]?.receiptItemId, quantity: '1' }],
      },
    })
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('RETURN_ITEM_MISMATCH')
  })
})

// ===========================================================================
// 4. El tope físico
// ===========================================================================

describe('No se devuelve lo que ya no está', () => {
  it('el caso del objetivo 13: entraron 10, se vendieron 8, devolver 5 se rechaza', async () => {
    // La fixture arranca con 100 unidades y NO se pueden borrar: el libro de
    // inventario es inmutable, y eso también vale para una prueba. Se llega al
    // escenario del ejemplo como se llega de verdad --vendiendo-- y las cuentas
    // se hacen contra el saldo real.
    const cookie = await sessionCookie(fx.admin)
    const inicial = Number(await stock())
    const { POST: crear } = await import('@/app/api/purchases/route')
    const orden = await call<{ id: number }>(crear, '/api/purchases', {
      method: 'POST',
      cookie,
      body: {
        supplierId: fx.proveedor.id,
        items: [
          {
            productId: fx.productoCaja.id,
            quantity: '10',
            unitCost: '1000',
            purchaseUnit: 'UNIT',
            unitsPerPurchaseUnit: '1',
          },
        ],
      },
    })
    const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
    const confirmada = await call<{ items: Array<{ id: number }> }>(
      confirmar,
      `/api/purchases/${String(orden.body.id)}/confirm`,
      { method: 'POST', cookie, params: { id: String(orden.body.id) } },
    )
    const { POST: recibirRuta } = await import('@/app/api/purchases/[id]/receive/route')
    const rec = await call<RecepcionRes>(
      recibirRuta,
      `/api/purchases/${String(orden.body.id)}/receive`,
      {
        method: 'POST',
        cookie,
        params: { id: String(orden.body.id) },
        body: { items: [{ orderItemId: confirmada.body.items[0]?.id, quantity: '10' }] },
      },
    )
    expect(await stock()).toBe((inicial + 10).toFixed(3))

    // Se vende hasta dejar 2, que es el número del ejemplo.
    const { POST: vender } = await import('@/app/api/sales/route')
    const cuantas = inicial + 8
    const aCobrar = (Number(fx.productoCaja.price) * cuantas).toFixed(2)
    const venta = await call(vender, '/api/sales', {
      method: 'POST',
      cookie,
      body: {
        items: [{ productId: fx.productoCaja.id, quantity: String(cuantas) }],
        payments: [{ method: 'CASH', amount: aCobrar }],
      },
    })
    expect(venta.status, JSON.stringify(venta.body)).toBe(201)
    expect(await stock(), 'entraron 10, se vendieron 8 de ellas').toBe('2.000')

    // Y el proveedor quiere 5 de vuelta.
    const d = await crearDevolucion(rec.body.receiptId, '5')
    expect(d.status, 'históricamente entraron 10: el borrador se puede armar').toBe(201)

    const res = await confirmarDevolucion(d.body.id)
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('INSUFFICIENT_STOCK')

    // Y nada quedó a medias: ni stock, ni crédito, ni estado.
    expect(await stock()).toBe('2.000')
    const fila = await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: d.body.id } })
    expect(fila.status).toBe('DRAFT')
    expect(await prisma.supplierAccountMovement.count({ where: { type: 'PURCHASE_CREDIT' } })).toBe(
      0,
    )
  })

  it('la pantalla muestra el stock actual junto al tope histórico', async () => {
    const r = await recibir('1', '1000')
    const datos = await retornables(r.receiptId)
    // Son dos números distintos: uno es de la entrega, el otro del depósito.
    expect(datos.body.lineas[0]?.disponible).toBe('1.000')
    expect(datos.body.lineas[0]?.stockActual).toBe(await stock())
  })
})

// ===========================================================================
// 5 y 6. Confirmar: stock y crédito
// ===========================================================================

describe('Confirmar saca la mercadería y acredita', () => {
  it('emite un PURCHASE_RETURN negativo por la única puerta', async () => {
    const r = await recibir('10', '1000')
    const antes = await stock()

    const d = await crearDevolucion(r.receiptId, '2')
    const res = await confirmarDevolucion(d.body.id)

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    // 2 cajas de 8 son 16 unidades de stock.
    expect(res.body.movimientos[0]?.salio).toBe('16.000')
    expect(await stock()).toBe((Number(antes) - 16).toFixed(3))

    const movimiento = await prisma.stockMovement.findFirstOrThrow({
      where: { type: 'PURCHASE_RETURN' },
    })
    expect(movimiento.quantity.toFixed(3)).toBe('-16.000')
    expect(movimiento.referenceType).toBe('PurchaseReturn')
    expect(movimiento.referenceId).toBe(d.body.id)
  })

  it('emite el PURCHASE_CREDIT con la devolución como origen', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    const credito = await prisma.supplierAccountMovement.findFirstOrThrow({
      where: { type: 'PURCHASE_CREDIT' },
    })
    expect(credito.amount.toFixed(2)).toBe('-2000.00')
    expect(credito.returnId, 'una clave foránea, no un texto').toBe(d.body.id)
    expect(credito.reference).toBe(d.body.number)
  })

  it('la base impide dos créditos de la misma devolución', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    await expect(
      prisma.$executeRaw`
        INSERT INTO "SupplierAccountMovement"
          ("branchId","supplierId","type","amount","previousBalance","resultingBalance",
           "returnId","userId","reason","createdAt")
        VALUES (${fx.branchA.id}, ${fx.proveedor.id}, 'PURCHASE_CREDIT', -1, 0, -1,
                ${d.body.id}, ${fx.admin.id}, 'duplicado', now())
      `,
      'el índice único parcial lo rechaza',
    ).rejects.toThrow()
  })

  it('confirmar dos veces no duplica nada', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    const segunda = await confirmarDevolucion(d.body.id)
    expect(segunda.status).toBe(409)
    expect(errorDe(segunda).code).toBe('RETURN_NOT_EDITABLE')
    expect(await prisma.stockMovement.count({ where: { type: 'PURCHASE_RETURN' } })).toBe(1)
  })
})

// ===========================================================================
// 7 y 8. El efecto financiero
// ===========================================================================

describe('El ejemplo del pedido: devolver lo ya pagado', () => {
  it('recepción 100.000, pago 100.000, devolución 20.000 → saldo -20.000', async () => {
    const r = await recibir('10', '10000')
    expect(await saldo()).toBe('100000.00')

    await pagar('100000')
    expect(await saldo()).toBe('0.00')

    const d = await crearDevolucion(r.receiptId, '2')
    const res = await confirmarDevolucion(d.body.id)

    expect(res.body.total).toBe('20000.00')
    expect(res.body.saldoProveedor).toBe('-20000.00')
    expect(res.body.saldoAFavor).toBe('20000.00')
    expect(await saldo(), 'tenemos crédito a favor').toBe('-20000.00')
  })

  it('NO modifica ni borra el pago anterior', async () => {
    const r = await recibir('10', '10000')
    const pago = await pagar('100000')
    const antes = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: pago.body.id } })

    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    const despues = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: pago.body.id } })
    expect(despues.amount.toFixed(2)).toBe(antes.amount.toFixed(2))
    expect(despues.paidAt.getTime()).toBe(antes.paidAt.getTime())
  })

  it('NO mueve las imputaciones históricas: la entrega queda pagada en exceso', async () => {
    const r = await recibir('10', '10000')
    await pagar('100000')

    const imputadoAntes = await prisma.supplierPaymentAllocation.aggregate({
      where: { receiptId: r.receiptId },
      _sum: { amount: true },
    })
    expect(imputadoAntes._sum.amount?.toFixed(2)).toBe('100000.00')

    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    const imputadoDespues = await prisma.supplierPaymentAllocation.aggregate({
      where: { receiptId: r.receiptId },
      _sum: { amount: true },
    })
    expect(imputadoDespues._sum.amount?.toFixed(2), 'una imputación no se reescribe').toBe(
      '100000.00',
    )
  })

  it('la vista de deudas muestra el exceso como crédito, no como pendiente negativo', async () => {
    const r = await recibir('10', '10000')
    await pagar('100000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    const { GET } = await import('@/app/api/suppliers/[id]/deudas/route')
    const res = await call<{
      data: Array<{
        receiptId: number
        total: string
        devuelto: string
        neto: string
        pagado: string
        pendiente: string
        exceso: string
        estado: string
      }>
    }>(GET, `/api/suppliers/${String(fx.proveedor.id)}/deudas?abiertas=false`, {
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
    })

    const fila = res.body.data.find((d) => d.receiptId === r.receiptId)
    expect(fila?.total, 'el importe original no se pisa').toBe('100000.00')
    expect(fila?.devuelto).toBe('20000.00')
    expect(fila?.neto).toBe('80000.00')
    expect(fila?.pagado).toBe('100000.00')
    expect(fila?.pendiente, 'nunca negativo').toBe('0.00')
    expect(fila?.exceso).toBe('20000.00')
    expect(fila?.estado).toBe('PAGADA')
  })

  it('sobre deuda parcialmente paga: 100.000 − 40.000 pagados − 20.000 devueltos = 40.000', async () => {
    const r = await recibir('10', '10000')
    await pagar('40000')
    expect(await saldo()).toBe('60000.00')

    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    expect(await saldo()).toBe('40000.00')

    // Y la historia son tres movimientos, en ese orden.
    const historia = await prisma.supplierAccountMovement.findMany({
      where: { supplierId: fx.proveedor.id },
      orderBy: { id: 'asc' },
      select: { type: true, amount: true },
    })
    expect(historia.map((m) => `${m.type} ${m.amount.toFixed(2)}`)).toEqual([
      'PURCHASE_CHARGE 100000.00',
      'PAYMENT -40000.00',
      'PURCHASE_CREDIT -20000.00',
    ])
  })

  it('la obligación neta baja: ya no se puede imputar contra lo devuelto', async () => {
    const r = await recibir('10', '10000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    // Quedan $80.000 netos. Un pago de $100.000 solo puede imputar 80.000.
    const pago = await pagar('100000', { acceptCredit: true })
    expect(pago.status, JSON.stringify(pago.body)).toBe(201)

    const imputado = await prisma.supplierPaymentAllocation.aggregate({
      where: { receiptId: r.receiptId },
      _sum: { amount: true },
    })
    expect(imputado._sum.amount?.toFixed(2)).toBe('80000.00')
  })
})

// ===========================================================================
// 9. Inmutabilidad
// ===========================================================================

describe('Una devolución confirmada es inmutable', () => {
  it('la base rechaza un UPDATE, aunque venga por SQL directo', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    await expect(
      prisma.$executeRaw`UPDATE "PurchaseReturn" SET "total" = 1 WHERE "id" = ${d.body.id}`,
    ).rejects.toThrow(/inmutable/i)
  })

  it('y un DELETE', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    await expect(
      prisma.$executeRaw`DELETE FROM "PurchaseReturn" WHERE "id" = ${d.body.id}`,
    ).rejects.toThrow(/inmutable/i)
  })

  it('y sus renglones tampoco: sería la puerta de atrás', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    await expect(
      prisma.$executeRaw`
        UPDATE "PurchaseReturnItem" SET "quantity" = 99 WHERE "purchaseReturnId" = ${d.body.id}
      `,
    ).rejects.toThrow(/inmutable/i)
  })

  it('un BORRADOR sí se edita: todavía no ocurrió nada', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')

    const linea = (await retornables(r.receiptId)).body.lineas[0]
    const { PATCH } = await import('@/app/api/devoluciones/[id]/route')
    const res = await call<DevolucionRes>(PATCH, `/api/devoluciones/${String(d.body.id)}`, {
      method: 'PATCH',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(d.body.id) },
      body: {
        reason: 'QUALITY',
        notes: 'Vinieron mal de fábrica.',
        items: [{ receiptItemId: linea?.receiptItemId, quantity: '3' }],
      },
    })

    expect(res.status, JSON.stringify(res.body)).toBe(200)
    expect(res.body.total, '3 cajas a 1.000').toBe('3000.00')
  })

  it('una confirmada no se edita por la API', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    const linea = (await retornables(r.receiptId)).body.lineas[0]
    const { PATCH } = await import('@/app/api/devoluciones/[id]/route')
    const res = await call(PATCH, `/api/devoluciones/${String(d.body.id)}`, {
      method: 'PATCH',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(d.body.id) },
      body: { reason: 'QUALITY', items: [{ receiptItemId: linea?.receiptItemId, quantity: '1' }] },
    })
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('RETURN_NOT_EDITABLE')
  })
})

// ===========================================================================
// Permisos
// ===========================================================================

describe('Permisos de devolución', () => {
  it('compras arma y confirma', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2', rol('compras'))
    expect(d.status, JSON.stringify(d.body)).toBe(201)

    const res = await confirmarDevolucion(d.body.id, rol('compras'))
    expect(res.status, JSON.stringify(res.body)).toBe(200)
  })

  it('el repositor mira y no arma', async () => {
    const r = await recibir('10', '1000')

    const lista = await retornables(r.receiptId, rol('repositor'))
    expect(lista.status, 'necesita saber qué apartar').toBe(200)

    const d = await crearDevolucion(r.receiptId, '2', rol('repositor'))
    expect(d.status, 'armarla es elegir renglones Y ver su costo').toBe(403)
  })

  it('el auditor mira y no confirma', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')

    const res = await confirmarDevolucion(d.body.id, rol('auditor'))
    expect(res.status).toBe(403)
  })

  it('el cajero no ve las devoluciones', async () => {
    const { GET } = await import('@/app/api/devoluciones/route')
    const res = await call(GET, '/api/devoluciones', { cookie: await sessionCookie(fx.cajero) })
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
// Auditoría
// ===========================================================================

describe('La bitácora', () => {
  it('registra la creación y la confirmación, con el crédito adentro', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    const eventos = await prisma.auditLog.findMany({
      where: { tableName: 'PurchaseReturn', recordId: d.body.id },
      orderBy: { id: 'asc' },
    })
    expect(eventos.map((e) => e.actionType)).toEqual(['create', 'update'])

    const cambios = eventos[1]?.changes as { after?: Record<string, unknown> } | null
    const confirmacion = cambios?.after ?? null
    expect(confirmacion?.estado).toBe('CONFIRMED')
    // 10 cajas a $1.000 dejaron $10.000 de deuda; el crédito de $2.000 la baja
    // a $8.000. El movimiento es de -2.000 y el SALDO queda en 8.000: son dos
    // números distintos y la bitácora guarda los dos.
    expect(confirmacion?.importe).toBe('2000.00')
    expect(confirmacion?.saldoProveedorAnterior).toBe('10000.00')
    expect(confirmacion?.saldoProveedorNuevo).toBe('8000.00')
  })

  it('no duplica el libro de inventario ni el de la cuenta', async () => {
    const r = await recibir('10', '1000')
    const d = await crearDevolucion(r.receiptId, '2')
    await confirmarDevolucion(d.body.id)

    expect(
      await prisma.auditLog.count({ where: { tableName: 'StockMovement' } }),
      'el libro de inventario guarda ese hecho mejor',
    ).toBe(0)
    expect(
      await prisma.auditLog.count({
        where: { tableName: 'SupplierAccountMovement', recordId: { gt: 0 } },
      }),
    ).toBe(0)
  })
})
