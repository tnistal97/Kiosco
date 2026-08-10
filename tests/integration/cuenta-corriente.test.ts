/**
 * Cuenta corriente: fiar, cobrar y anular.
 *
 * El caso obligatorio de la fase, escrito una sola vez y en mayusculas porque
 * es el que resume todo:
 *
 *   UNA VENTA DE $30.000 COBRADA $10.000 EN EFECTIVO Y $20.000 A CUENTA
 *   AUMENTA LA CAJA EN $10.000 Y LA DEUDA DEL CLIENTE EN $20.000.
 *
 * Y la regla que lo hace posible: la suma de los pagos sigue siendo EXACTAMENTE
 * el total. El fiado no rompe esa invariante --la cubre-- y lo que cambia es a
 * DONDE va cada linea: el efectivo al cajon, la cuenta al libro del cliente.
 *
 * Al final de cada escenario se comprueba que el libro cuadre, con
 * `descuadresDeCuenta`, que suma por una via distinta a la que escribe.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  seedFixture,
  prisma,
  cashOf,
  expectedOfShift,
  saldoDe,
  descuadresDeCuenta,
  movimientosDeCuenta,
  descuadresDelLibro,
  num,
  type Fixture,
} from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'

import { POST as CREAR_VENTA } from '@/app/api/sales/route'
import { POST as ANULAR } from '@/app/api/sales/[id]/cancel/route'
import { POST as COBRAR } from '@/app/api/clients/[id]/pagos/route'
import { POST as AJUSTAR } from '@/app/api/clients/[id]/ajuste/route'
import { GET as VER_CREDITO } from '@/app/api/clients/[id]/credito/route'
import { PATCH as CAMBIAR_FIADO } from '@/app/api/clients/[id]/fiado/route'

interface CuentaDeVenta {
  clientId: number
  clientName: string
  charged: string
  previousBalance: string
  resultingBalance: string
  creditApplied: string
  limitOverridden: boolean
}
interface VentaCreada {
  id: number
  total: string
  cashCollected: string
  account: CuentaDeVenta | null
}
interface Comprobante {
  id: number
  number: string
  amount: string
  previousBalance: string
  resultingBalance: string
  saldoAFavor: string
  entroACaja: boolean
}
interface Anulacion {
  id: number
  cashReversed: string
  account: {
    reverted: string
    previousBalance: string
    resultingBalance: string
    saldoAFavor: string
  } | null
}

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  // Precio redondo: las cuentas de esta suite hablan de $30.000, no de
  // multiplos de 12.500.
  await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: '10000.00' } })
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Tres unidades a $10.000: total $30.000. */
function tresUnidades() {
  return [{ productId: fx.productoA.id, quantity: 3 }]
}

async function vender(body: unknown, quien = fx.cajero) {
  return call<VentaCreada>(CREAR_VENTA, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(quien),
    body,
  })
}

async function cobrar(clientId: number, body: unknown, quien = fx.cajero) {
  return call<Comprobante>(COBRAR, `/api/clients/${String(clientId)}/pagos`, {
    method: 'POST',
    cookie: await sessionCookie(quien),
    body,
    params: { id: String(clientId) },
  })
}

/** Ninguna prueba de esta suite puede terminar con el libro descuadrado. */
async function elLibroCierra() {
  expect(await descuadresDeCuenta(), 'el saldo de un cliente no coincide con su libro').toEqual([])
}

// ===========================================================================
// EL caso: pago parcial
// ===========================================================================

describe('EL caso: efectivo mas cuenta', () => {
  it('la caja sube por el efectivo y la deuda por lo fiado', async () => {
    const res = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.total).toBe('30000.00')

    // La caja fisica sube SOLO $10.000.
    expect(res.body.cashCollected).toBe('10000.00')
    expect(await cashOf(fx.branchA.id), 'lo fiado no puede entrar al cajon').toBe('10000.00')
    expect(await expectedOfShift(fx.branchA.id)).toBe('10000.00')

    // La cuenta del cliente sube $20.000.
    expect(res.body.account?.charged).toBe('20000.00')
    expect(res.body.account?.previousBalance).toBe('0.00')
    expect(res.body.account?.resultingBalance).toBe('20000.00')
    expect(await saldoDe(fx.cliente.id)).toBe('20000.00')

    await elLibroCierra()
  })

  it('lo fiado NO deja movimiento de caja, y lo cobrado si', async () => {
    const res = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { saleId: res.body.id },
      select: { paymentMethod: true, amount: true },
    })

    // Un solo movimiento, el del efectivo. Un cargo a cuenta no es plata que
    // cambio de manos: anotarlo en la caja mostraria dinero que nadie recibio.
    expect(movimientos).toHaveLength(1)
    expect(movimientos[0]?.paymentMethod).toBe('CASH')
    expect(num(movimientos[0]?.amount)).toBe(10000)
  })

  it('la suma de los pagos sigue siendo exactamente el total', async () => {
    const res = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })

    const pagos = await prisma.salePayment.findMany({ where: { saleId: res.body.id } })
    const suma = pagos.reduce((t, p) => t + num(p.amount), 0)

    expect(suma, 'el fiado CUBRE parte del total: la invariante no se relaja').toBe(30000)
  })
})

// ===========================================================================
// Venta completamente fiada
// ===========================================================================

describe('venta 100 % fiada', () => {
  it('la caja no se mueve y la deuda es el total', async () => {
    const antes = await cashOf(fx.branchA.id)

    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.cliente.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.cashCollected).toBe('0.00')
    expect(await cashOf(fx.branchA.id), 'una venta fiada no mueve el cajon').toBe(antes)
    expect(await saldoDe(fx.cliente.id)).toBe('10000.00')

    // Y el stock si sale: la mercaderia se la llevo.
    const stock = await prisma.branchStock.findUnique({
      where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
    })
    expect(num(stock?.quantity)).toBe(9)

    await elLibroCierra()
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('el movimiento del libro guarda los dos saldos y apunta a la venta', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.cliente.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    const [movimiento] = await movimientosDeCuenta(fx.cliente.id)
    expect(movimiento?.type).toBe('SALE_CHARGE')
    expect(num(movimiento?.amount)).toBe(10000)
    expect(num(movimiento?.previousBalance)).toBe(0)
    expect(num(movimiento?.resultingBalance)).toBe(10000)
    expect(movimiento?.saleId).toBe(res.body.id)
    expect(movimiento?.paymentId, 'un cargo de venta no viene de un cobro').toBeNull()
  })
})

// ===========================================================================
// Fiar exige cliente, y exige permiso
// ===========================================================================

describe('fiar exige cliente', () => {
  it('sin cliente, la venta a cuenta se rechaza', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    expect(res.status).toBe(400)
    expect(errorDe(res).code).toBe('ACCOUNT_SALE_NEEDS_CLIENT')
  })

  it('una venta cobrada NO necesita cliente', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      payments: [{ method: 'CASH', amount: '10000.00' }],
    })

    expect(res.status, 'obligar a identificar a todo comprador no es la idea').toBeLessThan(300)
    expect(res.body.account).toBeNull()

    const venta = await prisma.sale.findUnique({ where: { id: res.body.id } })
    expect(venta?.clientId, 'null es venta al mostrador, no cliente desconocido').toBeNull()
  })

  it('un cliente de otra sucursal no existe para esta', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.clienteB.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    expect(res.status).toBe(404)
  })

  it('el repositor no puede fiar', async () => {
    const res = await vender(
      {
        items: [{ productId: fx.productoA.id, quantity: 1 }],
        clientId: fx.cliente.id,
        payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
      },
      fx.porRol.repositor,
    )

    // 403 por `sales.create` antes incluso de llegar a `accounts.charge`: el
    // repositor no vende. Lo que importa es que no pase.
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
// Limite de credito
// ===========================================================================

describe('limite de credito', () => {
  it('rechaza la venta que se pasa, y dice por cuanto', async () => {
    // Juan tiene limite 50.000. Se le cargan 43.000 con un ajuste, y despues
    // intenta fiar 10.000: llegaria a 53.000.
    await call(AJUSTAR, `/api/clients/${String(fx.cliente.id)}/ajuste`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { delta: '43000.00', reason: 'Deuda anterior a la migracion' },
      params: { id: String(fx.cliente.id) },
    })

    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.cliente.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('CREDIT_LIMIT_EXCEEDED')
    // El mensaje dice los tres numeros: a cuanto llegaria, cual es el limite y
    // por cuanto se pasa. Un "no se puede" obliga a adivinar.
    expect(errorDe(res).message).toContain('53000.00')
    expect(errorDe(res).message).toContain('50000.00')
    expect(errorDe(res).message).toContain('3000.00')

    // Y la venta NO quedo: ni stock, ni caja, ni deuda.
    expect(await saldoDe(fx.cliente.id)).toBe('43000.00')
    await elLibroCierra()
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('acepta la venta que llega JUSTO al limite', async () => {
    await call(AJUSTAR, `/api/clients/${String(fx.cliente.id)}/ajuste`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { delta: '40000.00', reason: 'Deuda anterior' },
      params: { id: String(fx.cliente.id) },
    })

    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.cliente.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    expect(res.status, 'el limite es un tope, no una frontera abierta').toBeLessThan(300)
    expect(await saldoDe(fx.cliente.id)).toBe('50000.00')
  })

  it('sin limite configurado (NULL) no hay tope', async () => {
    const res = await vender({
      items: tresUnidades(),
      clientId: fx.clienteSinLimite.id,
      payments: [{ method: 'ACCOUNT', amount: '30000.00' }],
    })

    expect(res.status).toBeLessThan(300)
    expect(await saldoDe(fx.clienteSinLimite.id)).toBe('30000.00')
  })

  it('limite CERO significa que no se le fia, y es distinto de NULL', async () => {
    await prisma.client.update({
      where: { id: fx.clienteSinLimite.id },
      data: { creditLimit: 0 },
    })

    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.clienteSinLimite.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    expect(res.status, 'cero es una decision: no se le fia').toBe(409)
    expect(errorDe(res).code).toBe('CREDIT_LIMIT_EXCEEDED')
  })

  it('el pago NO lo frena el limite: si no, nadie saldria de ahi', async () => {
    // Se lo deja por encima del limite con un ajuste autorizado.
    await call(AJUSTAR, `/api/clients/${String(fx.cliente.id)}/ajuste`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { delta: '60000.00', reason: 'Deuda historica' },
      params: { id: String(fx.cliente.id) },
    })

    const res = await cobrar(fx.cliente.id, { amount: '10000.00', method: 'CASH' })

    expect(res.status).toBeLessThan(300)
    expect(await saldoDe(fx.cliente.id)).toBe('50000.00')
    await elLibroCierra()
  })
})

// ===========================================================================
// Override del limite
// ===========================================================================

describe('override del limite', () => {
  beforeEach(async () => {
    await call(AJUSTAR, `/api/clients/${String(fx.cliente.id)}/ajuste`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { delta: '45000.00', reason: 'Deuda anterior' },
      params: { id: String(fx.cliente.id) },
    })
  })

  it('el admin puede autorizar pasarse, y queda quien lo hizo', async () => {
    const res = await vender(
      {
        items: [{ productId: fx.productoA.id, quantity: 1 }],
        clientId: fx.cliente.id,
        payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
        autorizarExcesoDeCredito: true,
      },
      fx.admin,
    )

    expect(res.status).toBeLessThan(300)
    expect(res.body.account?.limitOverridden).toBe(true)
    expect(await saldoDe(fx.cliente.id)).toBe('55000.00')

    // El autorizante queda en la FILA DEL LIBRO, no solo en la bitacora: quien
    // lee el extracto tiene que ver que esa deuda se tomo por encima del limite
    // sin cruzar dos tablas.
    const movimientos = await movimientosDeCuenta(fx.cliente.id)
    const cargo = movimientos.find((m) => m.type === 'SALE_CHARGE')
    expect(cargo?.authorizedById).toBe(fx.admin.id)

    await elLibroCierra()
  })

  it('el cajero NO puede autorizar, ni siquiera pidiendolo', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.cliente.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
      autorizarExcesoDeCredito: true,
    })

    expect(res.status, 'pedir una autorizacion que no se tiene es un rechazo').toBe(403)
    expect(await saldoDe(fx.cliente.id)).toBe('45000.00')
  })

  it('sin pedir la autorizacion, el admin tambien queda frenado', async () => {
    const res = await vender(
      {
        items: [{ productId: fx.productoA.id, quantity: 1 }],
        clientId: fx.cliente.id,
        payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
      },
      fx.admin,
    )

    expect(res.status, 'tener el permiso no es lo mismo que usarlo').toBe(409)
    expect(errorDe(res).code).toBe('CREDIT_LIMIT_EXCEEDED')
  })
})

// ===========================================================================
// Fiado bloqueado
// ===========================================================================

describe('cliente con el fiado cortado', () => {
  it('no se le puede fiar', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.clienteBloqueado.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('CLIENT_CREDIT_DISABLED')
  })

  it('pero SI puede comprar de contado', async () => {
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.clienteBloqueado.id,
      payments: [{ method: 'CASH', amount: '10000.00' }],
    })

    expect(res.status, 'cortar el fiado no es dar de baja al cliente').toBeLessThan(300)
  })

  it('ni el override del limite lo desbloquea', async () => {
    const res = await vender(
      {
        items: [{ productId: fx.productoA.id, quantity: 1 }],
        clientId: fx.clienteBloqueado.id,
        payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
        autorizarExcesoDeCredito: true,
      },
      fx.admin,
    )

    expect(res.status, 'cortar el fiado es una decision, no un tope').toBe(409)
    expect(errorDe(res).code).toBe('CLIENT_CREDIT_DISABLED')
  })

  it('se puede volver a habilitar, y entonces si se le fia', async () => {
    const cambio = await call(
      CAMBIAR_FIADO,
      `/api/clients/${String(fx.clienteBloqueado.id)}/fiado`,
      {
        method: 'PATCH',
        cookie: await sessionCookie(fx.admin),
        body: { isCreditEnabled: true, reason: 'Se puso al dia' },
        params: { id: String(fx.clienteBloqueado.id) },
      },
    )
    expect(cambio.status).toBeLessThan(300)

    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.clienteBloqueado.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })
    expect(res.status).toBeLessThan(300)
  })

  it('el cajero no puede habilitarle el fiado a nadie', async () => {
    const res = await call(CAMBIAR_FIADO, `/api/clients/${String(fx.clienteBloqueado.id)}/fiado`, {
      method: 'PATCH',
      cookie: await sessionCookie(fx.cajero),
      body: { isCreditEnabled: true },
      params: { id: String(fx.clienteBloqueado.id) },
    })

    expect(res.status).toBe(403)
  })
})

// ===========================================================================
// Cobro
// ===========================================================================

describe('cobro al cliente', () => {
  beforeEach(async () => {
    // Juan debe 20.000, fiados en una venta.
    await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })
  })

  it('en efectivo: baja el saldo y sube la caja', async () => {
    const cajaAntes = await cashOf(fx.branchA.id)

    const res = await cobrar(fx.cliente.id, { amount: '8000.00', method: 'CASH' })

    expect(res.status).toBeLessThan(300)
    expect(res.body.previousBalance).toBe('20000.00')
    expect(res.body.resultingBalance).toBe('12000.00')
    expect(await saldoDe(fx.cliente.id)).toBe('12000.00')

    expect(res.body.entroACaja).toBe(true)
    expect(await cashOf(fx.branchA.id)).toBe('18000.00')
    expect(cajaAntes).toBe('10000.00')
    expect(await expectedOfShift(fx.branchA.id), 'el efectivo cobrado entra al turno').toBe(
      '18000.00',
    )

    await elLibroCierra()
  })

  it('por transferencia: baja el saldo y la caja NO sube', async () => {
    const cajaAntes = await cashOf(fx.branchA.id)

    const res = await cobrar(fx.cliente.id, { amount: '8000.00', method: 'TRANSFER' })

    expect(res.status).toBeLessThan(300)
    expect(await saldoDe(fx.cliente.id)).toBe('12000.00')

    expect(res.body.entroACaja).toBe(false)
    expect(await cashOf(fx.branchA.id), 'una transferencia no entra al cajon').toBe(cajaAntes)
    expect(await expectedOfShift(fx.branchA.id)).toBe('10000.00')

    // Y no dejo movimiento de caja.
    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { customerPaymentId: res.body.id },
    })
    expect(movimientos).toHaveLength(0)

    await elLibroCierra()
  })

  it('el comprobante se numera RC-00000001 y sigue', async () => {
    const uno = await cobrar(fx.cliente.id, { amount: '1000.00', method: 'CASH' })
    const dos = await cobrar(fx.cliente.id, { amount: '1000.00', method: 'CASH' })

    expect(uno.body.number).toBe('RC-00000001')
    expect(dos.body.number).toBe('RC-00000002')
  })

  it('todo cobro deja exactamente un movimiento, negativo y por el mismo importe', async () => {
    const res = await cobrar(fx.cliente.id, { amount: '8000.00', method: 'CASH' })

    const movimientos = await prisma.customerAccountMovement.findMany({
      where: { paymentId: res.body.id },
    })

    expect(movimientos).toHaveLength(1)
    expect(movimientos[0]?.type).toBe('PAYMENT')
    expect(num(movimientos[0]?.amount), 'un pago reduce la deuda').toBe(-8000)
    expect(movimientos[0]?.saleId, 'un pago no viene de una venta').toBeNull()
  })

  it('el cajero puede cobrar', async () => {
    const res = await cobrar(fx.cliente.id, { amount: '5000.00', method: 'CASH' }, fx.cajero)
    expect(res.status, 'cobrar es una operacion de mostrador').toBeLessThan(300)
  })

  it('el auditor no puede cobrar', async () => {
    const res = await cobrar(
      fx.cliente.id,
      { amount: '5000.00', method: 'CASH' },
      fx.porRol.auditor,
    )
    expect(res.status, 'quien revisa no modifica lo que revisa').toBe(403)
  })
})

// ===========================================================================
// Sobrepago
// ===========================================================================

describe('sobrepago', () => {
  beforeEach(async () => {
    await call(AJUSTAR, `/api/clients/${String(fx.cliente.id)}/ajuste`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { delta: '8000.00', reason: 'Deuda anterior' },
      params: { id: String(fx.cliente.id) },
    })
  })

  it('sin confirmar, se rechaza y dice cuanto sobra', async () => {
    const res = await cobrar(fx.cliente.id, { amount: '10000.00', method: 'CASH' })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('PAYMENT_LEAVES_CREDIT')
    expect(errorDe(res).message).toContain('2000.00')
    expect(await saldoDe(fx.cliente.id), 'el rechazo no cobro nada').toBe('8000.00')
  })

  it('confirmado, queda saldo A FAVOR', async () => {
    const res = await cobrar(fx.cliente.id, {
      amount: '10000.00',
      method: 'CASH',
      aceptarSaldoAFavor: true,
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.resultingBalance, 'negativo = el cliente tiene plata a favor').toBe('-2000.00')
    expect(res.body.saldoAFavor).toBe('2000.00')
    expect(await saldoDe(fx.cliente.id)).toBe('-2000.00')

    await elLibroCierra()
  })

  it('el saldo a favor lo consume la venta siguiente', async () => {
    await cobrar(fx.cliente.id, {
      amount: '10000.00',
      method: 'CASH',
      aceptarSaldoAFavor: true,
    })
    expect(await saldoDe(fx.cliente.id)).toBe('-2000.00')

    // Compra $5.000 a cuenta. De esos, $2.000 salen del credito que tenia.
    const res = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.cliente.id,
      payments: [
        { method: 'ACCOUNT', amount: '5000.00' },
        { method: 'CASH', amount: '5000.00' },
      ],
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.account?.previousBalance).toBe('-2000.00')
    expect(res.body.account?.resultingBalance).toBe('3000.00')
    // Y se dice explicitamente cuanto salio del credito: el libro ya hizo la
    // resta, y esto la explica sin una segunda entidad ni un segundo medio.
    expect(res.body.account?.creditApplied).toBe('2000.00')

    await elLibroCierra()
  })
})

// ===========================================================================
// Anulacion
// ===========================================================================

describe('anulacion de una venta fiada', () => {
  async function anular(saleId: number, reason = 'Se arrepintio') {
    return call<Anulacion>(ANULAR, `/api/sales/${String(saleId)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { reason },
      params: { id: String(saleId) },
    })
  }

  it('revierte la caja y la cuenta, y deja el saldo en cero', async () => {
    const venta = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })

    const res = await anular(venta.body.id)

    expect(res.status).toBeLessThan(300)
    expect(res.body.cashReversed).toBe('10000.00')
    expect(res.body.account?.reverted).toBe('20000.00')
    expect(res.body.account?.resultingBalance).toBe('0.00')

    expect(await cashOf(fx.branchA.id)).toBe('0.00')
    expect(await saldoDe(fx.cliente.id)).toBe('0.00')

    await elLibroCierra()
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('NO borra el movimiento original: agrega el inverso', async () => {
    const venta = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })
    await anular(venta.body.id)

    const movimientos = await movimientosDeCuenta(fx.cliente.id)

    expect(movimientos).toHaveLength(2)
    expect(movimientos[0]?.type).toBe('SALE_CHARGE')
    expect(num(movimientos[0]?.amount)).toBe(20000)
    expect(movimientos[1]?.type).toBe('SALE_CANCEL')
    expect(num(movimientos[1]?.amount)).toBe(-20000)

    // La cadena de saldos queda continua: 0 → 20.000 → 0.
    expect(num(movimientos[1]?.previousBalance)).toBe(20000)
    expect(num(movimientos[1]?.resultingBalance)).toBe(0)
  })

  it('conserva el SalePayment ACCOUNT', async () => {
    const venta = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })
    await anular(venta.body.id)

    const pagos = await prisma.salePayment.findMany({ where: { saleId: venta.body.id } })
    expect(pagos, 'una venta anulada conserva como se habia cobrado').toHaveLength(2)
    expect(pagos.some((p) => p.method === 'ACCOUNT')).toBe(true)
  })

  // =========================================================================
  // EL caso dificil: anular DESPUES de que el cliente pago
  // =========================================================================

  it('LA PRUEBA: pago 8.000 y despues se anula: le quedan 8.000 A FAVOR', async () => {
    // 1. Venta fiada de $20.000.
    const venta = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })
    expect(await saldoDe(fx.cliente.id)).toBe('20000.00')

    // 2. El cliente paga $8.000.
    await cobrar(fx.cliente.id, { amount: '8000.00', method: 'CASH' })
    expect(await saldoDe(fx.cliente.id)).toBe('12000.00')

    // 3. Se anula la venta original.
    const res = await anular(venta.body.id, 'La mercaderia estaba fallada')

    // 4. La anulacion revierte EXACTAMENTE lo que la venta habia cargado:
    //    -20.000. No "lo que quede".
    expect(res.body.account?.reverted).toBe('20000.00')
    expect(res.body.account?.previousBalance).toBe('12000.00')
    expect(res.body.account?.resultingBalance).toBe('-8000.00')
    expect(res.body.account?.saldoAFavor).toBe('8000.00')

    // 5. Al cliente le quedan $8.000 a favor, que es la plata que puso de
    //    verdad y por mercaderia que devolvio. Ni se le regala ni se le pierde.
    expect(await saldoDe(fx.cliente.id)).toBe('-8000.00')

    // 6. El pago anterior NO se toco ni se reinterpreto: sigue ahi, con su
    //    comprobante. Es un hecho, no una opinion.
    const pagos = await prisma.customerPayment.findMany({ where: { clientId: fx.cliente.id } })
    expect(pagos).toHaveLength(1)
    expect(num(pagos[0]?.amount)).toBe(8000)

    // 7. Y los tres movimientos del libro cuentan la historia entera.
    const movimientos = await movimientosDeCuenta(fx.cliente.id)
    expect(movimientos.map((m) => [m.type, num(m.amount)])).toEqual([
      ['SALE_CHARGE', 20000],
      ['PAYMENT', -8000],
      ['SALE_CANCEL', -20000],
    ])

    await elLibroCierra()
  })

  it('y despues puede usar ese saldo a favor en otra compra', async () => {
    const venta = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [
        { method: 'CASH', amount: '10000.00' },
        { method: 'ACCOUNT', amount: '20000.00' },
      ],
    })
    await cobrar(fx.cliente.id, { amount: '8000.00', method: 'CASH' })
    await anular(venta.body.id)
    expect(await saldoDe(fx.cliente.id)).toBe('-8000.00')

    const nueva = await vender({
      items: [{ productId: fx.productoA.id, quantity: 1 }],
      clientId: fx.cliente.id,
      payments: [{ method: 'ACCOUNT', amount: '10000.00' }],
    })

    expect(nueva.body.account?.creditApplied).toBe('8000.00')
    expect(await saldoDe(fx.cliente.id), '10.000 menos los 8.000 a favor').toBe('2000.00')

    await elLibroCierra()
  })

  it('anular una venta SIN fiado no toca ninguna cuenta', async () => {
    const venta = await vender({
      items: tresUnidades(),
      clientId: fx.cliente.id,
      payments: [{ method: 'CASH', amount: '30000.00' }],
    })

    const res = await anular(venta.body.id)

    expect(res.body.account, 'no habia nada a cuenta que revertir').toBeNull()
    expect(await movimientosDeCuenta(fx.cliente.id)).toHaveLength(0)
  })
})

// ===========================================================================
// Ajuste manual
// ===========================================================================

describe('ajuste manual', () => {
  async function ajustar(body: unknown, quien = fx.admin) {
    return call(AJUSTAR, `/api/clients/${String(fx.cliente.id)}/ajuste`, {
      method: 'POST',
      cookie: await sessionCookie(quien),
      body,
      params: { id: String(fx.cliente.id) },
    })
  }

  it('suma el delta y deja el motivo', async () => {
    const res = await ajustar({ delta: '2000.00', reason: 'Deuda previa a la migracion' })

    expect(res.status).toBeLessThan(300)
    expect(await saldoDe(fx.cliente.id)).toBe('2000.00')

    const [movimiento] = await movimientosDeCuenta(fx.cliente.id)
    expect(movimiento?.type).toBe('MANUAL_ADJUSTMENT')
    expect(movimiento?.reason).toBe('Deuda previa a la migracion')
    expect(movimiento?.saleId).toBeNull()
    expect(movimiento?.paymentId).toBeNull()
  })

  it('acepta delta negativo', async () => {
    await ajustar({ delta: '5000.00', reason: 'Deuda previa' })
    await ajustar({ delta: '-2000.00', reason: 'Se cargo de mas' })
    expect(await saldoDe(fx.cliente.id)).toBe('3000.00')
    await elLibroCierra()
  })

  it('exige motivo', async () => {
    const res = await ajustar({ delta: '2000.00', reason: '   ' })
    expect(res.status).toBe(400)
  })

  it('rechaza un ajuste de cero', async () => {
    const res = await ajustar({ delta: '0', reason: 'Nada' })
    expect(res.status).toBe(400)
  })

  it('el cajero NO puede ajustar: es la separacion que da sentido al modulo', async () => {
    const res = await ajustar({ delta: '-20000.00', reason: 'Perdonado' }, fx.cajero)
    expect(res.status, 'quien cobra no puede bajarle la deuda a nadie').toBe(403)
  })

  it('el supervisor tampoco', async () => {
    const res = await ajustar({ delta: '-20000.00', reason: 'Perdonado' }, fx.porRol.supervisor)
    expect(res.status).toBe(403)
  })

  it('el auditor tampoco', async () => {
    const res = await ajustar({ delta: '2000.00', reason: 'Correccion' }, fx.porRol.auditor)
    expect(res.status).toBe(403)
  })
})

// ===========================================================================
// Previsualizacion del credito
// ===========================================================================

describe('mostrar el saldo antes de fiar', () => {
  it('devuelve los cinco numeros que hacen falta para decidir', async () => {
    await call(AJUSTAR, `/api/clients/${String(fx.cliente.id)}/ajuste`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { delta: '23000.00', reason: 'Deuda anterior' },
      params: { id: String(fx.cliente.id) },
    })

    const res = await call<{
      name: string
      balance: string
      saldoResultante: string
      creditLimit: string | null
      disponible: string | null
      entra: boolean
      motivo: string | null
    }>(VER_CREDITO, `/api/clients/${String(fx.cliente.id)}/credito?monto=12000.00`, {
      cookie: await sessionCookie(fx.cajero),
      params: { id: String(fx.cliente.id) },
    })

    expect(res.status).toBeLessThan(300)
    expect(res.body.name).toBe('Juan Pérez')
    expect(res.body.balance).toBe('23000.00')
    expect(res.body.saldoResultante).toBe('35000.00')
    expect(res.body.creditLimit).toBe('50000.00')
    expect(res.body.disponible).toBe('27000.00')
    expect(res.body.entra).toBe(true)
    expect(res.body.motivo).toBeNull()
  })

  it('cuando no entra, explica por que en una frase', async () => {
    const res = await call<{ entra: boolean; motivo: string | null; excedente: string }>(
      VER_CREDITO,
      `/api/clients/${String(fx.cliente.id)}/credito?monto=60000.00`,
      { cookie: await sessionCookie(fx.cajero), params: { id: String(fx.cliente.id) } },
    )

    expect(res.body.entra).toBe(false)
    expect(res.body.excedente).toBe('10000.00')
    expect(res.body.motivo, 'no un 409 pelado').toContain('50000.00')
  })
})
