/**
 * Fase 4C contra la base: anticipos e imputación diferida.
 *
 * Recorre el ejemplo del pedido de punta a punta, con sus números:
 *
 *   Anticipo   $50.000  ->  saldo -50.000, sin imputar 50.000
 *   Recepción  $35.000  ->  saldo -15.000
 *   Imputación $35.000  ->  saldo -15.000 (NO se mueve), sin imputar 15.000
 *
 * Seis bloques que son seis reglas:
 *
 *   1. un anticipo se registra sin recepción y sin imputación ficticia;
 *   2. `allocatedAmount` y `unallocatedAmount` son derivados, no guardados;
 *   3. la imputación diferida NO vuelve a mover `Supplier.balance`;
 *   4. no se puede imputar más de lo disponible ni más de lo que falta;
 *   5. la aplicación automática al recibir consume FIFO de pagos y es opcional;
 *   6. imputar exige su propio permiso.
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
  anticipos: Array<{ paymentId: number; number: string; amount: string }>
}

/** Una orden confirmada y recibida entera. `cajas x costo` da el total. */
async function recibir(
  cajas: string,
  costo: string,
  extra: Record<string, unknown> = {},
): Promise<RecepcionRes> {
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
        ...extra,
      },
    },
  )

  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body
}

interface PagoRes {
  id: number
  number: string
  amount: string
  resultingBalance: string
  sinImputar: string
  imputaciones: Array<{ receiptId: number; amount: string }>
}

async function pagar(body: Record<string, unknown>, usuario = fx.admin) {
  const { POST } = await import('@/app/api/suppliers/[id]/pagos/route')
  return call<PagoRes>(POST, `/api/suppliers/${String(fx.proveedor.id)}/pagos`, {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    params: { id: String(fx.proveedor.id) },
    body,
  })
}

/** El anticipo del ejemplo: plata entregada sin aplicar a nada. */
async function anticipo(importe: string, usuario = fx.admin) {
  return pagar(
    {
      imputacion: 'ninguna',
      amount: importe,
      method: 'TRANSFER',
      // Un anticipo deja saldo a favor por definicion, asi que hay que
      // confirmarlo. Es la misma puerta que el sobrepago y a proposito: entregar
      // plata que no se debe es una decision, se llame como se llame.
      acceptCredit: true,
    },
    usuario,
  )
}

async function imputar(paymentId: number, allocations: unknown[], usuario = fx.admin) {
  const { POST } = await import('@/app/api/suppliers/[id]/pagos/[pagoId]/imputar/route')
  return call<{
    number: string
    amount: string
    allocatedAmount: string
    unallocatedAmount: string
    imputaciones: Array<{ receiptId: number; amount: string }>
  }>(POST, `/api/suppliers/${String(fx.proveedor.id)}/pagos/${String(paymentId)}/imputar`, {
    method: 'POST',
    cookie: await sessionCookie(usuario),
    params: { id: String(fx.proveedor.id), pagoId: String(paymentId) },
    body: { allocations },
  })
}

async function saldo(): Promise<string> {
  const p = await prisma.supplier.findUniqueOrThrow({
    where: { id: fx.proveedor.id },
    select: { balance: true },
  })
  return p.balance.toFixed(2)
}

function rol(nombre: string): TestUser {
  const u = fx.porRol[nombre]
  if (!u) throw new Error(`La fixture no tiene un usuario con rol ${nombre}`)
  return u
}

// ===========================================================================
// 1. El anticipo
// ===========================================================================

describe('Un anticipo es un pago sin nada que cancelar', () => {
  it('registra el pago, mueve el libro y deja el saldo a favor', async () => {
    const res = await anticipo('50000')

    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.resultingBalance).toBe('-50000.00')
    expect(await saldo()).toBe('-50000.00')

    // El comprobante existe y el movimiento tambien.
    const pago = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: res.body.id } })
    expect(pago.amount.toFixed(2)).toBe('50000.00')
    expect(pago.method).toBe('TRANSFER')

    const movimientos = await prisma.supplierAccountMovement.findMany({
      where: { supplierId: fx.proveedor.id },
    })
    expect(movimientos).toHaveLength(1)
    expect(movimientos[0]?.type).toBe('PAYMENT')
    expect(movimientos[0]?.amount.toFixed(2)).toBe('-50000.00')
  })

  it('NO inventa una recepción ni una imputación', async () => {
    await anticipo('50000')

    expect(await prisma.purchaseReceipt.count(), 'un anticipo no es una entrega').toBe(0)
    expect(
      await prisma.supplierPaymentAllocation.count(),
      'no hay obligación contra la cual imputar',
    ).toBe(0)
  })

  it('queda entero sin imputar', async () => {
    const res = await anticipo('50000')
    expect(res.body.sinImputar).toBe('50000.00')
    expect(res.body.imputaciones).toHaveLength(0)
  })

  it('la imputación “ninguna” NO consume las deudas abiertas que haya', async () => {
    // Con deuda abierta, 'automatica' la cancelaria. 'ninguna' es una decision
    // distinta: la plata se entrega y se decide despues a que se aplica.
    await recibir('1', '20000')
    expect(await saldo()).toBe('20000.00')

    const res = await pagar({
      imputacion: 'ninguna',
      amount: '20000',
      method: 'TRANSFER',
    })

    expect(res.status).toBe(201)
    expect(res.body.sinImputar, 'no toco la entrega abierta').toBe('20000.00')
    expect(await prisma.supplierPaymentAllocation.count()).toBe(0)
    // El SALDO si baja: eso lo decide el libro, no la imputacion.
    expect(await saldo()).toBe('0.00')
  })

  it('sin confirmación explícita se rechaza, igual que cualquier sobrepago', async () => {
    const res = await pagar({ imputacion: 'ninguna', amount: '50000', method: 'TRANSFER' })
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('SUPPLIER_PAYMENT_LEAVES_CREDIT')
  })
})

// ===========================================================================
// 2. Lo imputado y lo disponible son DERIVADOS
// ===========================================================================

describe('allocatedAmount y unallocatedAmount', () => {
  it('salen de la suma de imputaciones, no de una columna', async () => {
    const a = await anticipo('50000')
    const r = await recibir('1', '30000')
    await imputar(a.body.id, [{ receiptId: r.receiptId, amount: '30000' }])

    const { GET } = await import('@/app/api/suppliers/[id]/anticipos/route')
    const lista = await call<{
      data: Array<{
        number: string
        amount: string
        allocatedAmount: string
        unallocatedAmount: string
      }>
    }>(GET, `/api/suppliers/${String(fx.proveedor.id)}/anticipos`, {
      cookie: await sessionCookie(fx.admin),
      params: { id: String(fx.proveedor.id) },
    })

    const fila = lista.body.data.find((p) => p.number === a.body.number)
    expect(fila?.amount).toBe('50000.00')
    expect(fila?.allocatedAmount).toBe('30000.00')
    expect(fila?.unallocatedAmount).toBe('20000.00')

    // Y la comprobacion que importa: NO existe ninguna columna con esos numeros.
    const columnas = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'SupplierPayment'
    `
    const nombres = columnas.map((c) => c.column_name)
    expect(nombres).not.toContain('allocatedAmount')
    expect(nombres).not.toContain('unallocatedAmount')
  })

  it('un pago imputado entero desaparece de la lista de disponibles', async () => {
    const a = await anticipo('50000')
    const r = await recibir('1', '50000')
    await imputar(a.body.id, [{ receiptId: r.receiptId, amount: '50000' }])

    const { GET } = await import('@/app/api/suppliers/[id]/anticipos/route')
    const lista = await call<{ data: unknown[] }>(
      GET,
      `/api/suppliers/${String(fx.proveedor.id)}/anticipos`,
      {
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.proveedor.id) },
      },
    )
    expect(lista.body.data).toHaveLength(0)
  })
})

// ===========================================================================
// 3. La imputación diferida NO mueve el saldo
// ===========================================================================

describe('El ejemplo del pedido, entero', () => {
  it('anticipo 50.000, recepción 35.000, imputación 35.000, restan 15.000', async () => {
    const a = await anticipo('50000')
    expect(await saldo()).toBe('-50000.00')

    const r = await recibir('1', '35000')
    expect(await saldo(), 'la entrega sube la deuda').toBe('-15000.00')

    const antes = await saldo()
    const res = await imputar(a.body.id, [{ receiptId: r.receiptId, amount: '35000' }])

    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.allocatedAmount).toBe('35000.00')
    expect(res.body.unallocatedAmount).toBe('15000.00')

    // LA REGLA CENTRAL DEL OBJETIVO 3.
    expect(await saldo(), 'imputar no mueve el saldo').toBe(antes)
    expect(await saldo()).toBe('-15000.00')

    // Y la entrega queda saldada.
    const { GET } = await import('@/app/api/suppliers/[id]/deudas/route')
    const deudas = await call<{ data: Array<{ receiptId: number; pendiente: string }> }>(
      GET,
      `/api/suppliers/${String(fx.proveedor.id)}/deudas`,
      { cookie: await sessionCookie(fx.admin), params: { id: String(fx.proveedor.id) } },
    )
    expect(deudas.body.data.find((d) => d.receiptId === r.receiptId)).toBeUndefined()
  })

  it('no escribe ningún movimiento nuevo en el libro', async () => {
    const a = await anticipo('50000')
    const r = await recibir('1', '35000')

    const antes = await prisma.supplierAccountMovement.count({
      where: { supplierId: fx.proveedor.id },
    })
    await imputar(a.body.id, [{ receiptId: r.receiptId, amount: '35000' }])
    const despues = await prisma.supplierAccountMovement.count({
      where: { supplierId: fx.proveedor.id },
    })

    expect(despues, 'la imputación es detalle, no un hecho financiero').toBe(antes)
  })

  it('un pago puede imputarse a la misma entrega en dos veces', async () => {
    // Es el caso que la Fase 4B no podia: el par (pago, entrega) era unico, y
    // el resto del anticipo quedaba varado sin forma de aplicarlo.
    const a = await anticipo('50000')
    const r = await recibir('1', '50000')

    const primera = await imputar(a.body.id, [{ receiptId: r.receiptId, amount: '30000' }])
    expect(primera.status).toBe(201)

    const segunda = await imputar(a.body.id, [{ receiptId: r.receiptId, amount: '20000' }])
    expect(segunda.status, JSON.stringify(segunda.body)).toBe(201)
    expect(segunda.body.unallocatedAmount).toBe('0.00')

    const filas = await prisma.supplierPaymentAllocation.findMany({
      where: { paymentId: a.body.id, receiptId: r.receiptId },
    })
    expect(filas, 'dos hechos, dos filas inmutables').toHaveLength(2)
  })
})

// ===========================================================================
// 4. Los dos topes
// ===========================================================================

describe('No se imputa más de lo que hay', () => {
  it('rechaza pasar del disponible del pago', async () => {
    const a = await anticipo('50000')
    const r = await recibir('1', '80000')

    const res = await imputar(a.body.id, [{ receiptId: r.receiptId, amount: '60000' }])
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('ALLOCATION_EXCEEDS_AVAILABLE')
  })

  it('rechaza pasar de lo que le falta a la entrega', async () => {
    const a = await anticipo('50000')
    const r = await recibir('1', '20000')

    const res = await imputar(a.body.id, [{ receiptId: r.receiptId, amount: '30000' }])
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('ALLOCATION_EXCEEDS_DEBT')
  })

  it('rechaza una entrega que no es de este proveedor', async () => {
    const a = await anticipo('50000')
    const res = await imputar(a.body.id, [{ receiptId: 999_999, amount: '1000' }])
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('ALLOCATION_TARGET_INVALID')
  })

  it('el reparto entero se comprueba junto: dos líneas que suman de más se rechazan', async () => {
    const a = await anticipo('50000')
    const r1 = await recibir('1', '40000')
    const r2 = await recibir('1', '40000')

    const res = await imputar(a.body.id, [
      { receiptId: r1.receiptId, amount: '30000' },
      { receiptId: r2.receiptId, amount: '30000' },
    ])
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('ALLOCATION_EXCEEDS_AVAILABLE')

    // Y no quedó escrita ni la primera: es una decisión, no dos.
    expect(await prisma.supplierPaymentAllocation.count()).toBe(0)
  })
})

// ===========================================================================
// 5. La aplicación automática al recibir
// ===========================================================================

describe('Aplicar anticipos al recibir', () => {
  it('NO se aplica solo: sin pedirlo, el anticipo queda intacto', async () => {
    await anticipo('50000')
    const r = await recibir('1', '30000')

    expect(r.anticipos).toHaveLength(0)
    expect(await prisma.supplierPaymentAllocation.count()).toBe(0)
    // El saldo sí se mueve --nace la deuda-- pero el anticipo sigue disponible.
    expect(await saldo()).toBe('-20000.00')
  })

  it('pedido explícitamente, consume el crédito hasta cubrir la entrega', async () => {
    const a = await anticipo('50000')
    const r = await recibir('1', '30000', { aplicarAnticipos: true })

    expect(r.anticipos).toHaveLength(1)
    expect(r.anticipos[0]?.number).toBe(a.body.number)
    expect(r.anticipos[0]?.amount).toBe('30000.00')

    const imputado = await prisma.supplierPaymentAllocation.aggregate({
      where: { receiptId: r.receiptId },
      _sum: { amount: true },
    })
    expect(imputado._sum.amount?.toFixed(2)).toBe('30000.00')
  })

  it('nunca imputa más que el importe de la entrega', async () => {
    await anticipo('50000')
    const r = await recibir('1', '20000', { aplicarAnticipos: true })

    expect(r.anticipos[0]?.amount).toBe('20000.00')
    const imputado = await prisma.supplierPaymentAllocation.aggregate({
      where: { receiptId: r.receiptId },
      _sum: { amount: true },
    })
    expect(imputado._sum.amount?.toFixed(2)).toBe('20000.00')
  })

  it('consume FIFO de pagos: el más antiguo primero, y el id desempata', async () => {
    const primero = await anticipo('10000')
    const segundo = await anticipo('40000')

    // Los dos se registran en el mismo instante --el reloj no llega a
    // separarlos-- asi que este caso mide el DESEMPATE por id, que es lo que
    // hace la regla determinística. El criterio de fecha se mide abajo.
    const r = await recibir('1', '25000', { aplicarAnticipos: true })

    expect(r.anticipos).toHaveLength(2)
    expect(r.anticipos[0]?.number, 'el de id más bajo primero').toBe(primero.body.number)
    expect(r.anticipos[0]?.amount).toBe('10000.00')
    expect(r.anticipos[1]?.number).toBe(segundo.body.number)
    expect(r.anticipos[1]?.amount).toBe('15000.00')
  })

  it('la FECHA manda sobre el id: un pago viejo con id alto se consume antes', async () => {
    const conIdBajo = await anticipo('10000')
    const conIdAlto = await anticipo('40000')

    // Para envejecer un pago hay que APAGAR SU DISPARADOR DE INMUTABILIDAD, y
    // que haga falta es la prueba de que funciona: no existe ningún camino de la
    // aplicación que pueda cambiarle la fecha a un comprobante. Se apaga y se
    // enciende en la misma sentencia, y solo para armar el escenario.
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "SupplierPayment" DISABLE TRIGGER "SupplierPayment_inmutable"',
    )
    await prisma.$executeRaw`
      UPDATE "SupplierPayment" SET "paidAt" = "paidAt" - interval '30 days'
       WHERE "id" = ${conIdAlto.body.id}
    `
    await prisma.$executeRawUnsafe(
      'ALTER TABLE "SupplierPayment" ENABLE TRIGGER "SupplierPayment_inmutable"',
    )

    const r = await recibir('1', '25000', { aplicarAnticipos: true })

    expect(r.anticipos[0]?.number, 'el más antiguo, aunque su id sea mayor').toBe(
      conIdAlto.body.number,
    )
    expect(r.anticipos[0]?.amount).toBe('25000.00')
    expect(r.anticipos, 'con el primero alcanzó').toHaveLength(1)

    const restante = await prisma.supplierPaymentAllocation.aggregate({
      where: { paymentId: conIdBajo.body.id },
      _sum: { amount: true },
    })
    expect(restante._sum.amount ?? null, 'el otro quedó intacto').toBeNull()
  })

  it('el saldo del proveedor NO cambia por aplicar anticipos', async () => {
    await anticipo('50000')
    const conAplicar = await recibir('1', '30000', { aplicarAnticipos: true })
    expect(conAplicar.saldoProveedor).toBe('-20000.00')

    // Otra fixture, mismo circuito sin aplicar: el saldo tiene que dar igual.
    fx = await seedFixture()
    await anticipo('50000')
    const sinAplicar = await recibir('1', '30000')
    expect(sinAplicar.saldoProveedor).toBe('-20000.00')
  })
})

// ===========================================================================
// 6. Permisos
// ===========================================================================

describe('Imputar tiene su propio permiso', () => {
  it('compras puede imputar', async () => {
    const a = await anticipo('50000')
    const r = await recibir('1', '30000')

    const res = await imputar(
      a.body.id,
      [{ receiptId: r.receiptId, amount: '30000' }],
      rol('compras'),
    )
    expect(res.status, JSON.stringify(res.body)).toBe(201)
  })

  it('el auditor no: quien revisa no modifica lo que revisa', async () => {
    const a = await anticipo('50000')
    const r = await recibir('1', '30000')

    const res = await imputar(
      a.body.id,
      [{ receiptId: r.receiptId, amount: '30000' }],
      rol('auditor'),
    )
    expect(res.status).toBe(403)
  })

  it('el cajero tampoco ve la lista de anticipos', async () => {
    const { GET } = await import('@/app/api/suppliers/[id]/anticipos/route')
    const res = await call(GET, `/api/suppliers/${String(fx.proveedor.id)}/anticipos`, {
      cookie: await sessionCookie(fx.cajero),
      params: { id: String(fx.proveedor.id) },
    })
    expect(res.status).toBe(403)
  })

  it('un pago de OTRO proveedor no se puede imputar desde esta ficha', async () => {
    const a = await anticipo('50000')

    const { POST } = await import('@/app/api/suppliers/[id]/pagos/[pagoId]/imputar/route')
    const res = await call(
      POST,
      `/api/suppliers/${String(fx.proveedorInactivo.id)}/pagos/${String(a.body.id)}/imputar`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.proveedorInactivo.id), pagoId: String(a.body.id) },
        body: { allocations: [{ receiptId: 1, amount: '100' }] },
      },
    )
    expect(res.status).toBe(404)
  })
})
