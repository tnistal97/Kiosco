/**
 * Fase 4B contra la base: cuentas por pagar a proveedores.
 *
 * Recorre el ejemplo del pedido de punta a punta, con sus numeros:
 *
 *   Recepcion #1  $120.000  ->  saldo  120.000
 *   Pago transf.   $40.000  ->  saldo   80.000
 *   Recepcion #2   $50.000  ->  saldo  130.000
 *   Pago efectivo  $30.000  ->  saldo  100.000, y la caja baja 30.000
 *
 * Ocho bloques que son ocho reglas:
 *
 *   1. la deuda nace de la RECEPCION, no de la orden;
 *   2. el importe es el REAL de la factura, no el esperado;
 *   3. una recepcion genera exactamente UN cargo;
 *   4. el efectivo sale del cajon; la transferencia no;
 *   5. el sobrepago se rechaza sin confirmacion Y sin permiso;
 *   6. la nota de credito baja la deuda sin tocar la recepcion;
 *   7. el ajuste manual exige motivo;
 *   8. el libro es inmutable, incluso por SQL directo.
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
  dueDate: string | null
  saldoProveedor: string
  pago: { id: number; number: string; amount: string } | null
}

/**
 * Una orden confirmada y recibida entera, por el importe que se pida.
 *
 * `cajas x costo` da el total: 10 cajas a $12.000 son los $120.000 del ejemplo.
 * Se usa el producto que se compra por caja, que es el de la fixture.
 */
async function recibir(
  cajas: string,
  costo: string,
  extra: Record<string, unknown> = {},
): Promise<RecepcionRes> {
  const { POST: crear } = await import('@/app/api/purchases/route')
  const cookie = await sessionCookie(fx.admin)

  const orden = await call<{ id: number; items: Array<{ id: number }> }>(crear, '/api/purchases', {
    method: 'POST',
    cookie,
    body: {
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoCaja.id, quantity: cajas, unitCost: costo }],
    },
  })

  const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
  const confirmada = await call<{ id: number; items: Array<{ id: number }> }>(
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
        ...extra,
      },
    },
  )

  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

async function pagar(body: Record<string, unknown>, usuario = fx.admin) {
  const { POST } = await import('@/app/api/suppliers/[id]/pagos/route')
  return call<{
    id: number
    number: string
    amount: string
    previousBalance: string
    resultingBalance: string
    saldoAFavor: string
    sinImputar: string
    salioDeCaja: boolean
    imputaciones: Array<{ receiptId: number; amount: string }>
  }>(POST, `/api/suppliers/${String(fx.proveedor.id)}/pagos`, {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    params: { id: String(fx.proveedor.id) },
    body: { imputacion: 'automatica', ...body },
  })
}

/**
 * Un usuario de la fixture por su rol.
 *
 * `fx.porRol` es un `Record<string, TestUser>` y el acceso puede dar
 * `undefined`: se comprueba en vez de confiar en el tipo, para que un rol que
 * desaparezca del catalogo falle diciendo cual y no con un `undefined` tres
 * lineas mas abajo.
 */
function rol(nombre: string): TestUser {
  const u = fx.porRol[nombre]
  if (!u) throw new Error(`La fixture no tiene un usuario con rol ${nombre}`)
  return u
}

async function saldo(): Promise<string> {
  const p = await prisma.supplier.findUniqueOrThrow({
    where: { id: fx.proveedor.id },
    select: { balance: true },
  })
  return p.balance.toFixed(2)
}

async function efectivo(): Promise<string> {
  const b = await prisma.branch.findUniqueOrThrow({
    where: { id: fx.branchA.id },
    select: { currentCash: true },
  })
  return b.currentCash.toFixed(2)
}

/** Reconstruye el saldo sumando el libro. Por otro camino que el servicio. */
async function saldoSegunElLibro(): Promise<string> {
  const filas = await prisma.$queryRaw<Array<{ total: string }>>`
    SELECT COALESCE(sum("amount"), 0)::numeric(14,2)::text AS total
      FROM "SupplierAccountMovement" WHERE "supplierId" = ${fx.proveedor.id}
  `
  return filas[0]?.total ?? '0.00'
}

// ===========================================================================
// 1. La deuda nace de la recepcion
// ===========================================================================

describe('La deuda nace de la recepción', () => {
  it('crear y confirmar una orden NO mueve el saldo del proveedor', async () => {
    const cookie = await sessionCookie(fx.admin)
    const { POST: crear } = await import('@/app/api/purchases/route')
    const orden = await call<{ id: number }>(crear, '/api/purchases', {
      method: 'POST',
      cookie,
      body: {
        supplierId: fx.proveedor.id,
        items: [{ productId: fx.productoCaja.id, quantity: '10', unitCost: '12000' }],
      },
    })

    const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
    await call(confirmar, `/api/purchases/${String(orden.body.id)}/confirm`, {
      method: 'POST',
      cookie,
      params: { id: String(orden.body.id) },
    })

    expect(await saldo(), 'una orden es un pedido, no una obligacion').toBe('0.00')
    expect(await prisma.supplierAccountMovement.count()).toBe(0)
  })

  it('recibir genera el cargo, y el saldo queda en el importe de la entrega', async () => {
    const r = await recibir('10', '12000')

    expect(r.total).toBe('120000.00')
    expect(r.saldoProveedor).toBe('120000.00')
    expect(await saldo()).toBe('120000.00')

    const movs = await prisma.supplierAccountMovement.findMany({
      where: { supplierId: fx.proveedor.id },
    })
    expect(movs).toHaveLength(1)
    expect(movs[0]?.type).toBe('PURCHASE_CHARGE')
    expect(movs[0]?.amount.toFixed(2)).toBe('120000.00')
    expect(movs[0]?.previousBalance.toFixed(2)).toBe('0.00')
    expect(movs[0]?.receiptId).toBe(r.receiptId)
  })

  it('dos entregas de la misma orden son dos obligaciones', async () => {
    const cookie = await sessionCookie(fx.admin)
    const { POST: crear } = await import('@/app/api/purchases/route')
    const orden = await call<{ id: number }>(crear, '/api/purchases', {
      method: 'POST',
      cookie,
      body: {
        supplierId: fx.proveedor.id,
        items: [{ productId: fx.productoCaja.id, quantity: '5', unitCost: '8800' }],
      },
    })

    const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
    const c = await call<{ items: Array<{ id: number }> }>(
      confirmar,
      `/api/purchases/${String(orden.body.id)}/confirm`,
      { method: 'POST', cookie, params: { id: String(orden.body.id) } },
    )
    const lineaId = c.body.items[0]?.id

    const { POST: recibirRuta } = await import('@/app/api/purchases/[id]/receive/route')
    const primera = await call<RecepcionRes>(
      recibirRuta,
      `/api/purchases/${String(orden.body.id)}/receive`,
      {
        method: 'POST',
        cookie,
        params: { id: String(orden.body.id) },
        body: { items: [{ orderItemId: lineaId, quantity: '3' }] },
      },
    )
    const segunda = await call<RecepcionRes>(
      recibirRuta,
      `/api/purchases/${String(orden.body.id)}/receive`,
      {
        method: 'POST',
        cookie,
        params: { id: String(orden.body.id) },
        body: { items: [{ orderItemId: lineaId, quantity: '2' }] },
      },
    )

    // 3 cajas x 8.800 = 26.400; 2 x 8.800 = 17.600. Los numeros del objetivo 4.
    expect(primera.body.total).toBe('26400.00')
    expect(segunda.body.total).toBe('17600.00')
    expect(await saldo()).toBe('44000.00')
    expect(await prisma.supplierAccountMovement.count()).toBe(2)
  })

  it('el importe es el REAL recibido, no el esperado de la orden', async () => {
    const cookie = await sessionCookie(fx.admin)
    const { POST: crear } = await import('@/app/api/purchases/route')
    const orden = await call<{ id: number }>(crear, '/api/purchases', {
      method: 'POST',
      cookie,
      body: {
        supplierId: fx.proveedor.id,
        items: [{ productId: fx.productoCaja.id, quantity: '10', unitCost: '10000' }],
      },
    })
    const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
    const c = await call<{ items: Array<{ id: number }> }>(
      confirmar,
      `/api/purchases/${String(orden.body.id)}/confirm`,
      { method: 'POST', cookie, params: { id: String(orden.body.id) } },
    )

    // Se pidio a 100.000 y la factura vino 104.500.
    const { POST: recibirRuta } = await import('@/app/api/purchases/[id]/receive/route')
    const res = await call<RecepcionRes>(
      recibirRuta,
      `/api/purchases/${String(orden.body.id)}/receive`,
      {
        method: 'POST',
        cookie,
        params: { id: String(orden.body.id) },
        body: { items: [{ orderItemId: c.body.items[0]?.id, quantity: '10', unitCost: '10450' }] },
      },
    )

    expect(res.body.total, 'se debe lo que hay que pagar, no lo que se pidio').toBe('104500.00')
    expect(await saldo()).toBe('104500.00')
  })

  it('una recepcion no puede generar el cargo dos veces', async () => {
    const r = await recibir('10', '12000')

    // Por SQL directo, que es la unica forma de intentarlo: el servicio crea
    // una recepcion nueva en cada llamada.
    await expect(
      prisma.$executeRaw`
        INSERT INTO "SupplierAccountMovement"
          ("branchId", "supplierId", "type", "amount", "previousBalance", "resultingBalance",
           "receiptId", "userId")
        VALUES (${fx.branchA.id}, ${fx.proveedor.id}, 'PURCHASE_CHARGE', 120000, 120000, 240000,
                ${r.receiptId}, ${fx.admin.id})
      `,
    ).rejects.toThrow()
  })
})

// ===========================================================================
// 2. Vencimiento
// ===========================================================================

describe('Vencimiento', () => {
  it('sin plazo configurado no se inventa una fecha', async () => {
    const r = await recibir('10', '12000')
    expect(r.dueDate, 'NULL es "nadie lo cargo", no "vence hoy"').toBeNull()
  })

  it('con plazo del proveedor se sugiere, y queda congelado', async () => {
    await prisma.supplier.update({
      where: { id: fx.proveedor.id },
      data: { defaultPaymentTermDays: 30 },
    })

    const r = await recibir('10', '12000')
    expect(r.dueDate).not.toBeNull()

    // Cambiar el plazo del proveedor NO mueve la deuda que ya nacio.
    const antes = r.dueDate
    await prisma.supplier.update({
      where: { id: fx.proveedor.id },
      data: { defaultPaymentTermDays: 15 },
    })
    const recepcion = await prisma.purchaseReceipt.findUniqueOrThrow({
      where: { id: r.receiptId },
      select: { dueDate: true },
    })
    expect(recepcion.dueDate?.toISOString()).toBe(antes)
  })

  it('se puede recibir SIN vencimiento aunque el proveedor tenga plazo', async () => {
    await prisma.supplier.update({
      where: { id: fx.proveedor.id },
      data: { defaultPaymentTermDays: 30 },
    })
    const r = await recibir('10', '12000', { dueDate: null })
    expect(r.dueDate, '`null` es "que no tenga"; ausente es "decidilo vos"').toBeNull()
  })

  it('el vencimiento se corrige; el resto de la recepcion no', async () => {
    const r = await recibir('10', '12000')

    const { PATCH } = await import('@/app/api/purchases/recepciones/[id]/vencimiento/route')
    const res = await call(PATCH, `/api/purchases/recepciones/${String(r.receiptId)}/vencimiento`, {
      method: 'PATCH',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(r.receiptId) },
      body: { dueDate: '2026-09-09', reason: 'El proveedor concedió dos semanas más' },
    })
    expect(res.status).toBe(200)

    // Y el importe sigue congelado: el disparador compara la fila entera.
    await expect(
      prisma.$executeRaw`UPDATE "PurchaseReceipt" SET "total" = 1 WHERE "id" = ${r.receiptId}`,
    ).rejects.toThrow(/inmutable/i)
  })
})

// ===========================================================================
// 3. Pagos
// ===========================================================================

describe('Pagos', () => {
  it('pago parcial por transferencia: baja la deuda y NO toca la caja', async () => {
    await recibir('10', '12000')
    const cajaAntes = await efectivo()

    const res = await pagar({ amount: '40000', method: 'TRANSFER' })

    expect(res.status).toBe(201)
    expect(res.body.previousBalance).toBe('120000.00')
    expect(res.body.resultingBalance).toBe('80000.00')
    expect(res.body.salioDeCaja).toBe(false)
    expect(await saldo()).toBe('80000.00')
    expect(await efectivo(), 'una transferencia no sale del cajon').toBe(cajaAntes)
    expect(res.body.number).toMatch(/^PP-\d{8}$/)
  })

  it('pago en efectivo: baja la deuda Y saca plata del cajon', async () => {
    await recibir('10', '12000')
    const cajaAntes = Number(await efectivo())

    const res = await pagar({ amount: '30000', method: 'CASH' })

    expect(res.status).toBe(201)
    expect(res.body.salioDeCaja).toBe(true)
    expect(Number(await efectivo())).toBe(cajaAntes - 30000)

    const caja = await prisma.cashRegisterMovement.findFirst({
      where: { supplierPaymentId: res.body.id },
    })
    expect(caja?.type).toBe('supplier_payment')
    expect(caja?.amount.toFixed(2), 'la plata sale: el importe va negativo').toBe('-30000.00')
  })

  it('el pago total deja el saldo en cero', async () => {
    await recibir('10', '12000')
    const res = await pagar({ amount: '120000', method: 'TRANSFER' })
    expect(res.body.resultingBalance).toBe('0.00')
    expect(await saldo()).toBe('0.00')
  })

  it('el ejemplo completo del pedido, de punta a punta', async () => {
    const r1 = await recibir('10', '12000')
    expect(await saldo()).toBe('120000.00')

    await pagar({ amount: '40000', method: 'TRANSFER' })
    expect(await saldo()).toBe('80000.00')

    const r2 = await recibir('5', '10000')
    expect(r2.total).toBe('50000.00')
    expect(await saldo()).toBe('130000.00')

    const cajaAntes = Number(await efectivo())
    await pagar({ amount: '30000', method: 'CASH' })

    expect(await saldo()).toBe('100000.00')
    expect(Number(await efectivo())).toBe(cajaAntes - 30000)
    expect(await saldoSegunElLibro(), 'el saldo es la suma del libro').toBe('100000.00')

    // Las dos entregas siguen siendo dos obligaciones distintas.
    const { GET } = await import('@/app/api/suppliers/[id]/deudas/route')
    const deudas = await call<{ data: Array<{ receiptId: number; pendiente: string }> }>(
      GET,
      `/api/suppliers/${String(fx.proveedor.id)}/deudas`,
      { cookie: await sessionCookie(fx.admin), params: { id: String(fx.proveedor.id) } },
    )
    const porId = new Map(deudas.body.data.map((d) => [d.receiptId, d.pendiente]))
    // FIFO: los $70.000 pagados cubrieron la primera entera y $0 de la segunda.
    expect(porId.get(r1.receiptId)).toBe('50000.00')
    expect(porId.get(r2.receiptId)).toBe('50000.00')
  })
})

// ===========================================================================
// 4. Sobrepago
// ===========================================================================

describe('Sobrepago', () => {
  it('sin confirmar se rechaza, y el mensaje dice cuanto sobra', async () => {
    await recibir('10', '12000')
    const res = await pagar({ amount: '130000', method: 'TRANSFER' })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('SUPPLIER_PAYMENT_LEAVES_CREDIT')
    expect(errorDe(res).message).toContain('10000.00')
    expect(await saldo(), 'no se movio nada').toBe('120000.00')
  })

  it('confirmado y con permiso, deja credito a favor nuestro', async () => {
    await recibir('10', '12000')
    const res = await pagar({ amount: '130000', method: 'TRANSFER', acceptCredit: true })

    expect(res.status).toBe(201)
    expect(res.body.resultingBalance).toBe('-10000.00')
    expect(res.body.saldoAFavor).toBe('10000.00')
    expect(res.body.sinImputar, 'lo que sobra no se imputa contra nada').toBe('10000.00')
  })

  it('confirmado pero SIN permiso, se rechaza con 403', async () => {
    await recibir('10', '12000')
    // `compras` tiene view y payment, y no tiene overpay: es el reparto del
    // objetivo 32.
    const res = await pagar(
      { amount: '130000', method: 'TRANSFER', acceptCredit: true },
      rol('compras'),
    )

    expect(res.status).toBe(403)
    expect(await saldo()).toBe('120000.00')
  })

  it('el credito a favor lo consume la proxima entrega', async () => {
    await recibir('10', '12000')
    await pagar({ amount: '130000', method: 'TRANSFER', acceptCredit: true })
    expect(await saldo()).toBe('-10000.00')

    await recibir('5', '10000')
    expect(await saldo(), '50.000 de entrega menos 10.000 a favor').toBe('40000.00')
  })
})

// ===========================================================================
// 5. Nota de credito y ajuste
// ===========================================================================

describe('Nota de crédito y ajuste', () => {
  it('la nota de credito baja la deuda sin tocar la recepcion', async () => {
    const r = await recibir('10', '12000')

    const { POST } = await import('@/app/api/suppliers/[id]/nota-credito/route')
    const res = await call<{ resultingBalance: string }>(
      POST,
      `/api/suppliers/${String(fx.proveedor.id)}/nota-credito`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.proveedor.id) },
        body: { amount: '10000', reason: 'Faltaron 2 cajas en la entrega', reference: 'NC-4471' },
      },
    )

    expect(res.status).toBe(201)
    expect(res.body.resultingBalance).toBe('110000.00')

    const recepcion = await prisma.purchaseReceipt.findUniqueOrThrow({
      where: { id: r.receiptId },
      select: { total: true },
    })
    expect(recepcion.total.toFixed(2), 'la recepcion historica no se toca').toBe('120000.00')
  })

  it('la nota de credito exige motivo', async () => {
    await recibir('10', '12000')
    const { POST } = await import('@/app/api/suppliers/[id]/nota-credito/route')
    const res = await call(POST, `/api/suppliers/${String(fx.proveedor.id)}/nota-credito`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
      body: { amount: '10000', reason: '' },
    })
    expect(res.status).toBe(400)
  })

  it('el ajuste declara el DELTA y exige motivo', async () => {
    const { POST } = await import('@/app/api/suppliers/[id]/ajuste/route')
    const cookie = await sessionCookie(fx.admin)

    const sinMotivo = await call(POST, `/api/suppliers/${String(fx.proveedor.id)}/ajuste`, {
      method: 'POST',
      cookie,
      params: { id: String(fx.proveedor.id) },
      body: { delta: '80000' },
    })
    expect(sinMotivo.status).toBe(400)

    const conMotivo = await call<{ resultingBalance: string }>(
      POST,
      `/api/suppliers/${String(fx.proveedor.id)}/ajuste`,
      {
        method: 'POST',
        cookie,
        params: { id: String(fx.proveedor.id) },
        body: { delta: '80000', reason: 'Deuda anterior a la migración' },
      },
    )
    expect(conMotivo.status).toBe(201)
    expect(conMotivo.body.resultingBalance).toBe('80000.00')
  })
})

// ===========================================================================
// 6. Inmutabilidad
// ===========================================================================

describe('Inmutabilidad', () => {
  it('un movimiento del libro no se edita ni se borra, ni por SQL', async () => {
    await recibir('10', '12000')
    const mov = await prisma.supplierAccountMovement.findFirstOrThrow()

    await expect(
      prisma.$executeRaw`UPDATE "SupplierAccountMovement" SET "amount" = 1 WHERE "id" = ${mov.id}`,
    ).rejects.toThrow(/inmutable/i)

    await expect(
      prisma.$executeRaw`DELETE FROM "SupplierAccountMovement" WHERE "id" = ${mov.id}`,
    ).rejects.toThrow(/inmutable/i)
  })

  it('un pago tampoco', async () => {
    await recibir('10', '12000')
    const res = await pagar({ amount: '40000', method: 'TRANSFER' })

    await expect(
      prisma.$executeRaw`UPDATE "SupplierPayment" SET "amount" = 1 WHERE "id" = ${res.body.id}`,
    ).rejects.toThrow(/inmutable/i)
  })

  it('una imputacion tampoco: seria la puerta de atras', async () => {
    await recibir('10', '12000')
    const res = await pagar({ amount: '40000', method: 'TRANSFER' })
    const alloc = await prisma.supplierPaymentAllocation.findFirstOrThrow({
      where: { paymentId: res.body.id },
    })

    await expect(
      prisma.$executeRaw`UPDATE "SupplierPaymentAllocation" SET "amount" = 1 WHERE "id" = ${alloc.id}`,
    ).rejects.toThrow(/inmutable/i)
  })

  it('la base rechaza un pago que aumente la deuda', async () => {
    await recibir('10', '12000')
    await expect(
      prisma.$executeRaw`
        INSERT INTO "SupplierAccountMovement"
          ("branchId", "supplierId", "type", "amount", "previousBalance", "resultingBalance",
           "paymentId", "userId")
        VALUES (${fx.branchA.id}, ${fx.proveedor.id}, 'PAYMENT', 5000, 120000, 125000, NULL,
                ${fx.admin.id})
      `,
    ).rejects.toThrow()
  })

  it('la base rechaza tres numeros que no concuerdan', async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "SupplierAccountMovement"
          ("branchId", "supplierId", "type", "amount", "previousBalance", "resultingBalance",
           "reason", "userId")
        VALUES (${fx.branchA.id}, ${fx.proveedor.id}, 'MANUAL_ADJUSTMENT', 1000, 0, 9999,
                'no cierra', ${fx.admin.id})
      `,
    ).rejects.toThrow()
  })
})

// ===========================================================================
// 7. Permisos
// ===========================================================================

describe('Permisos', () => {
  it('el cajero no ve la cuenta de un proveedor', async () => {
    const { GET } = await import('@/app/api/suppliers/[id]/cuenta/route')
    const res = await call(GET, `/api/suppliers/${String(fx.proveedor.id)}/cuenta`, {
      cookie: await sessionCookie(fx.cajero),
      params: { id: String(fx.proveedor.id) },
    })
    expect(res.status, 'la deuda con proveedores no es informacion de mostrador').toBe(403)
  })

  it('el auditor lee y no escribe', async () => {
    await recibir('10', '12000')
    const auditor = rol('auditor')

    const { GET } = await import('@/app/api/suppliers/[id]/cuenta/route')
    const lectura = await call(GET, `/api/suppliers/${String(fx.proveedor.id)}/cuenta`, {
      cookie: await sessionCookie(auditor),
      params: { id: String(fx.proveedor.id) },
    })
    expect(lectura.status).toBe(200)

    const pago = await pagar({ amount: '1000', method: 'TRANSFER' }, auditor)
    expect(pago.status, 'quien revisa no modifica lo que revisa').toBe(403)
  })

  it('compras paga pero no ajusta', async () => {
    await recibir('10', '12000')
    const compras = rol('compras')

    const pago = await pagar({ amount: '1000', method: 'TRANSFER' }, compras)
    expect(pago.status).toBe(201)

    const { POST } = await import('@/app/api/suppliers/[id]/ajuste/route')
    const ajuste = await call(POST, `/api/suppliers/${String(fx.proveedor.id)}/ajuste`, {
      method: 'POST',
      cookie: await sessionCookie(compras),
      params: { id: String(fx.proveedor.id) },
      body: { delta: '-119000', reason: 'me la debía' },
    })
    expect(ajuste.status, 'quien negocia no borra la deuda a mano').toBe(403)
  })
})

// ===========================================================================
// 8. Pago al recibir
// ===========================================================================

describe('Pago al recibir', () => {
  it('primero nace el cargo y despues se paga: las dos cosas quedan', async () => {
    const r = await recibir('10', '12000', {
      pago: { amount: '20000', method: 'CASH' },
    })

    expect(r.pago).not.toBeNull()
    expect(r.pago?.amount).toBe('20000.00')
    expect(await saldo()).toBe('100000.00')

    const movs = await prisma.supplierAccountMovement.findMany({
      where: { supplierId: fx.proveedor.id },
      orderBy: { id: 'asc' },
    })
    expect(
      movs.map((m) => m.type),
      '"pagado al contado" no evita la deuda',
    ).toEqual(['PURCHASE_CHARGE', 'PAYMENT'])
  })
})
