/**
 * Turnos de caja.
 *
 * Lo que estas pruebas garantizan, en una frase: **el esperado del turno es
 * el monto inicial mas lo que de verdad entro al cajon, y nada mas**.
 *
 * Eso incluye lo que NO tiene que contar: una venta con tarjeta o
 * transferencia no entra al cajon, asi que no puede mover el esperado. Es la
 * regla que hace que un arqueo signifique algo, y la que rompia el modelo
 * anterior --`Branch.currentCash`, el acumulado desde la instalacion--.
 *
 * Ver docs/CASH_SHIFT_MODEL.md.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, cashOf, expectedOfShift, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'
import { multiplicarMonto, sumarMontos, restarMontos } from '@/lib/money'
import { aMonto } from '@/server/money'

import { POST as CREAR_VENTA } from '@/app/api/sales/route'
import { POST as ANULAR } from '@/app/api/sales/[id]/cancel/route'
import { POST as MOVIMIENTO } from '@/app/api/cash/route'
import { POST as ARQUEO } from '@/app/api/cash/count/route'
import { GET as ESTADO_CAJA, POST as ABRIR } from '@/app/api/cash/shift/route'
import { POST as CERRAR } from '@/app/api/cash/shift/[id]/close/route'
import { GET as HISTORIAL } from '@/app/api/cash/shifts/route'
import { GET as SALDO } from '@/app/api/cash/balance/route'

/** Forma del turno tal como sale por la API. Lo justo para las aserciones. */
interface Turno {
  id: number
  status: string
  openingAmount: string
  expectedAmount: string
  countedAmount: string | null
  difference: string | null
  openedBy: { id: number; name: string }
  authorizedBy: { id: number; name: string } | null
}

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

/**
 * Cierra el turno que la fixture deja abierto, para probar el caso sin caja.
 *
 * Escribe TODOS los campos del cierre. No es celo: la base tiene un CHECK que
 * exige que un turno 'closed' traiga fecha, responsable, esperado, contado y
 * diferencia, justamente para que no queden turnos a medio cerrar que despues
 * nadie sabe interpretar. Un atajo aca fallaba con `CashShift_close_fields_check`,
 * que es la restriccion haciendo su trabajo.
 */
async function sinTurnoAbierto(): Promise<void> {
  await prisma.cashShift.updateMany({
    where: { branchId: fx.branchA.id, status: 'open' },
    data: {
      status: 'closed',
      closedAt: new Date(),
      closedById: fx.admin.id,
      expectedAmount: 0,
      countedAmount: 0,
      difference: 0,
    },
  })
}

async function vender(quantity: number, paymentMethod = 'efectivo', quien = fx.cajero) {
  return call<{ id: number }>(CREAR_VENTA, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(quien),
    body: { items: [{ productId: fx.productoA.id, quantity }], paymentMethod },
  })
}

describe('Apertura', () => {
  it('abre la caja con el monto que se conto', async () => {
    await sinTurnoAbierto()

    const res = await call<{ turno: Turno }>(ABRIR, '/api/cash/shift', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: { openingAmount: '10000.00', notes: 'Fondo del sábado' },
    })

    expect(res.status).toBe(201)
    expect(res.body.turno.openingAmount).toBe('10000.00')
    expect(res.body.turno.expectedAmount).toBe('10000.00')
    expect(res.body.turno.status).toBe('open')
    expect(res.body.turno.openedBy.id).toBe(fx.cajero.id)
  })

  it('IMPIDE un segundo turno abierto en la misma sucursal', async () => {
    // La fixture ya deja uno abierto.
    const res = await call<{ turno: Turno }>(ABRIR, '/api/cash/shift', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: { openingAmount: '5000.00' },
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('SHIFT_ALREADY_OPEN')
    expect(await prisma.cashShift.count({ where: { status: 'open' } })).toBe(2) // A y B
  })

  it('dos aperturas simultaneas: una sola gana', async () => {
    await sinTurnoAbierto()

    const cookie = await sessionCookie(fx.cajero)
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () =>
        call<{ turno: Turno }>(ABRIR, '/api/cash/shift', {
          method: 'POST',
          cookie,
          body: { openingAmount: '1000.00' },
        }),
      ),
    )

    const exitosas = resultados.filter((r) => r.status === 201)
    expect(
      exitosas,
      'La unicidad la garantiza un indice parcial, no una comprobacion previa',
    ).toHaveLength(1)
    expect(
      await prisma.cashShift.count({ where: { branchId: fx.branchA.id, status: 'open' } }),
    ).toBe(1)
  })

  it('el turno historico no cuenta como turno abierto', async () => {
    await sinTurnoAbierto()
    await prisma.cashShift.create({
      data: {
        branchId: fx.branchA.id,
        openedById: fx.admin.id,
        openingAmount: 0,
        status: 'legacy',
        closedAt: new Date(),
      },
    })

    const res = await vender(1)
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('NO_OPEN_SHIFT')
  })
})

describe('Sin caja abierta', () => {
  beforeEach(sinTurnoAbierto)

  it('no se puede vender', async () => {
    const res = await vender(1)
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('NO_OPEN_SHIFT')
    // El mensaje dice QUE HACER: quien lo lee tiene un cliente enfrente.
    expect(errorDe(res).message).toMatch(/abrí la caja/i)
  })

  it('la venta rechazada NO descuenta stock', async () => {
    const antes = await prisma.branchStock.findUniqueOrThrow({
      where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
    })
    await vender(2)
    const despues = await prisma.branchStock.findUniqueOrThrow({
      where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
    })
    expect(despues.quantity).toBe(antes.quantity)
  })

  it('el saldo no es cero: es "no hay caja"', async () => {
    const res = await call<{
      balance: string | null
      turnoAbierto: boolean
      acumuladoHistorico: string
    }>(SALDO, '/api/cash/balance', { cookie: await sessionCookie(fx.admin) })
    expect(res.status).toBe(200)
    expect(res.body.balance, 'Un cero se leeria como "no vendi nada"').toBeNull()
    expect(res.body.turnoAbierto).toBe(false)
  })

  it('el arqueo se rechaza: no hay contra que comparar', async () => {
    const res = await call<{ cashCount: { esperado: string; diferencia: string } }>(
      ARQUEO,
      '/api/cash/count',
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        body: { amount: '1000.00' },
      },
    )
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('NO_OPEN_SHIFT')
  })

  it('con la politica apagada, la sucursal puede vender igual', async () => {
    await prisma.branch.update({
      where: { id: fx.branchA.id },
      data: { requireOpenShift: false },
    })

    const res = await vender(1)
    expect(res.status).toBeLessThan(300)

    // El movimiento queda sin turno, y eso es exacto: no hubo turno.
    const mov = await prisma.cashRegisterMovement.findFirstOrThrow({ where: { type: 'sale' } })
    expect(mov.shiftId).toBeNull()
  })
})

describe('Durante el turno', () => {
  it('una venta en EFECTIVO sube el esperado', async () => {
    const res = await vender(2, 'efectivo')
    expect(res.status).toBeLessThan(300)

    const esperado = multiplicarMonto(fx.productoA.price, 2)
    expect(await expectedOfShift(fx.branchA.id)).toBe(esperado)
  })

  it('una venta por TRANSFERENCIA no toca el efectivo', async () => {
    // El caso obligatorio de la fase: la plata no entra al cajon.
    const antes = await expectedOfShift(fx.branchA.id)
    const res = await vender(2, 'mercado_pago')
    expect(res.status).toBeLessThan(300)

    expect(
      await expectedOfShift(fx.branchA.id),
      'Una venta que no entra al cajon no puede mover el esperado',
    ).toBe(antes)
  })

  it('efectivo y transferencia juntos: la caja sube solo por el efectivo', async () => {
    await vender(1, 'efectivo')
    await vender(1, 'tarjeta')
    await vender(1, 'mercado_pago')

    expect(await expectedOfShift(fx.branchA.id)).toBe(fx.productoA.price)
  })

  it('un ingreso manual sube el esperado', async () => {
    await call(MOVIMIENTO, '/api/cash', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        amount: '5000.00',
        paymentMethod: 'efectivo',
        movementType: 'ingreso',
        description: 'Cambio',
      },
    })
    expect(await expectedOfShift(fx.branchA.id)).toBe('5000.00')
  })

  it('un retiro lo baja', async () => {
    await vender(1, 'efectivo')
    await call(MOVIMIENTO, '/api/cash', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: {
        amount: '1000.00',
        paymentMethod: 'efectivo',
        movementType: 'retiro',
        description: 'Pago a proveedor',
      },
    })

    expect(await expectedOfShift(fx.branchA.id)).toBe(restarMontos(fx.productoA.price, '1000.00'))
  })

  it('no se puede retirar mas de lo que hay EN EL TURNO', async () => {
    // Antes se comparaba contra el acumulado historico y se podia sacar
    // dinero de ventas de hace dos anios que ya no estaba en el cajon.
    await prisma.branch.update({
      where: { id: fx.branchA.id },
      data: { currentCash: 999_999 },
    })

    const res = await call(MOVIMIENTO, '/api/cash', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { amount: '5000.00', paymentMethod: 'efectivo', movementType: 'retiro' },
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('INSUFFICIENT_CASH')
  })

  it('la anulacion de una venta en efectivo baja el esperado', async () => {
    const venta = await vender(2, 'efectivo')
    const saleId = venta.body.id
    expect(await expectedOfShift(fx.branchA.id)).toBe(multiplicarMonto(fx.productoA.price, 2))

    await call(ANULAR, `/api/sales/${saleId}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(saleId) },
      body: { reason: 'Error de cobro' },
    })

    expect(
      await expectedOfShift(fx.branchA.id),
      'El contramovimiento tiene que dejar el turno como estaba',
    ).toBe('0.00')
  })

  it('el arqueo compara contra el turno, no contra el acumulado', async () => {
    await vender(1, 'efectivo')
    // Un acumulado historico enorme no puede influir.
    await prisma.branch.update({ where: { id: fx.branchA.id }, data: { currentCash: 999_999 } })

    const res = await call<{ cashCount: { esperado: string; diferencia: string } }>(
      ARQUEO,
      '/api/cash/count',
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        body: { amount: fx.productoA.price },
      },
    )

    expect(res.status).toBe(201)
    expect(res.body.cashCount.esperado).toBe(fx.productoA.price)
    expect(res.body.cashCount.diferencia).toBe('0.00')
  })
})

describe('Cierre', () => {
  it('cierra con el esperado congelado y la diferencia calculada', async () => {
    await vender(2, 'efectivo')
    const esperado = multiplicarMonto(fx.productoA.price, 2)

    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${fx.turnoA}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.turnoA) },
        body: { countedAmount: esperado, notes: 'Cuadra' },
      },
    )

    expect(res.status).toBe(200)
    expect(res.body.turno.status).toBe('closed')
    expect(res.body.turno.expectedAmount).toBe(esperado)
    expect(res.body.turno.countedAmount).toBe(esperado)
    expect(res.body.turno.difference).toBe('0.00')
    expect(res.body.necesitoAutorizacion).toBe(false)
  })

  it('registra la diferencia cuando falta plata', async () => {
    await vender(2, 'efectivo')
    const esperado = multiplicarMonto(fx.productoA.price, 2)
    const contado = restarMontos(esperado, '500.00')

    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${fx.turnoA}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.turnoA) },
        body: { countedAmount: contado, notes: 'Falta un billete' },
      },
    )

    expect(res.status).toBe(200)
    expect(res.body.turno.difference).toBe('-500.00')
  })

  it('un turno cerrado es INMUTABLE: no se vuelve a cerrar', async () => {
    const cerrar = async () =>
      call<{ turno: Turno; necesitoAutorizacion: boolean }>(
        CERRAR,
        `/api/cash/shift/${fx.turnoA}/close`,
        {
          method: 'POST',
          cookie: await sessionCookie(fx.admin),
          params: { id: String(fx.turnoA) },
          body: { countedAmount: '0.00' },
        },
      )

    expect((await cerrar()).status).toBe(200)
    const segunda = await cerrar()
    expect(segunda.status).toBe(409)
    expect(errorDe(segunda).message).toMatch(/ya estaba cerrado/i)
  })

  it('el esperado congelado no se recalcula si despues aparece un movimiento', async () => {
    await vender(1, 'efectivo')
    const esperado = fx.productoA.price

    await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${fx.turnoA}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.turnoA) },
        body: { countedAmount: esperado },
      },
    )

    // Un movimiento colado despues del cierre --no deberia pasar, pero si
    // pasa-- no puede reescribir la historia del turno.
    await prisma.cashRegisterMovement.create({
      data: {
        branchId: fx.branchA.id,
        userId: fx.admin.id,
        amount: 99_999,
        paymentMethod: 'efectivo',
        type: 'ingreso',
        shiftId: fx.turnoA,
      },
    })

    const historial = await call<{ data: Turno[] }>(HISTORIAL, '/api/cash/shifts', {
      cookie: await sessionCookie(fx.admin),
    })
    const turno = historial.body.data.find((t) => t.id === fx.turnoA)
    expect(turno?.expectedAmount).toBe(esperado)
  })

  it('el turno historico no se puede cerrar', async () => {
    const legacy = await prisma.cashShift.create({
      data: {
        branchId: fx.branchA.id,
        openedById: fx.admin.id,
        openingAmount: 0,
        status: 'legacy',
        closedAt: new Date(),
      },
    })

    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${legacy.id}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(legacy.id) },
        body: { countedAmount: '0.00' },
      },
    )

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('LEGACY_SHIFT')
  })

  it('no se puede cerrar un turno de otra sucursal', async () => {
    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${fx.turnoB}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.admin),
        params: { id: String(fx.turnoB) },
        body: { countedAmount: '0.00' },
      },
    )
    // 404 y no 403: confirmar que existe en otra sucursal ya es informacion.
    expect(res.status).toBe(404)
  })
})

describe('Umbral de diferencia', () => {
  /** El turno lo abre el CAJERO: asi cerrarlo el mismo no depende de otro permiso. */
  let turno = 0

  beforeEach(async () => {
    await sinTurnoAbierto()
    await prisma.branch.update({
      where: { id: fx.branchA.id },
      data: { cashDifferenceThreshold: 1000 },
    })
    await call<{ turno: Turno }>(ABRIR, '/api/cash/shift', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: { openingAmount: '0.00' },
    })
    const abierto = await prisma.cashShift.findFirstOrThrow({
      where: { branchId: fx.branchA.id, status: 'open' },
    })
    turno = abierto.id
  })

  it('una diferencia bajo el umbral cierra sin autorizar', async () => {
    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${turno}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.cajero),
        params: { id: String(turno) },
        body: { countedAmount: '900.00' },
      },
    )
    expect(res.status).toBe(200)
    expect(res.body.necesitoAutorizacion).toBe(false)
    expect(res.body.turno.difference).toBe('900.00')
  })

  it('una diferencia por encima del umbral se rechaza sin autorizacion', async () => {
    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${turno}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.cajero),
        params: { id: String(turno) },
        body: { countedAmount: '5000.00' },
      },
    )

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('DIFFERENCE_NEEDS_AUTHORIZATION')
    // Dice cuanto y contra que limite, con los dos importes escritos.
    expect(errorDe(res).message).toMatch(/5000\.00/)
    expect(errorDe(res).message).toMatch(/1000\.00/)
  })

  it('el CAJERO no puede autorizar su propio faltante', async () => {
    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${turno}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.cajero),
        params: { id: String(turno) },
        body: { countedAmount: '5000.00', autorizar: true },
      },
    )

    expect(res.status, 'Medio punto del mecanismo es que no pueda firmarlo el mismo').toBe(403)
    // Y el turno sigue abierto: un rechazo no cierra nada a medias.
    const sigue = await prisma.cashShift.findUniqueOrThrow({ where: { id: turno } })
    expect(sigue.status).toBe('open')
  })

  it('un encargado si puede, y queda registrado quien', async () => {
    const encargado = fx.porRol.encargado
    if (!encargado) throw new Error('Falta el rol encargado en la fixture')

    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${turno}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(encargado),
        params: { id: String(turno) },
        body: { countedAmount: '5000.00', autorizar: true, notes: 'Sobra: revisar el ticket 42' },
      },
    )

    expect(res.status).toBe(200)
    expect(res.body.necesitoAutorizacion).toBe(true)
    expect(res.body.turno.authorizedBy?.id).toBe(encargado.id)
  })
})

describe('Permisos', () => {
  it('el repositor no puede abrir la caja', async () => {
    await sinTurnoAbierto()
    const repositor = fx.porRol.repositor
    if (!repositor) throw new Error('Falta el rol repositor')

    const res = await call<{ turno: Turno }>(ABRIR, '/api/cash/shift', {
      method: 'POST',
      cookie: await sessionCookie(repositor),
      body: { openingAmount: '0.00' },
    })
    expect(res.status).toBe(403)
  })

  it('un cajero no puede cerrar el turno de otra persona', async () => {
    // El turno de la fixture lo abrio el admin.
    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${fx.turnoA}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.cajero),
        params: { id: String(fx.turnoA) },
        body: { countedAmount: '0.00' },
      },
    )

    expect(res.status).toBe(403)
    expect(errorDe(res).message).toMatch(/otra persona/i)
  })

  it('el que lo abrio si puede cerrarlo', async () => {
    await sinTurnoAbierto()
    await call<{ turno: Turno }>(ABRIR, '/api/cash/shift', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: { openingAmount: '0.00' },
    })
    const propio = await prisma.cashShift.findFirstOrThrow({
      where: { branchId: fx.branchA.id, status: 'open' },
    })

    const res = await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${propio.id}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.cajero),
        params: { id: String(propio.id) },
        body: { countedAmount: '0.00' },
      },
    )
    expect(res.status).toBe(200)
  })

  it('el auditor ve el estado de la caja pero no la abre', async () => {
    const auditor = fx.porRol.auditor
    if (!auditor) throw new Error('Falta el rol auditor')

    const ver = await call(ESTADO_CAJA, '/api/cash/shift', {
      cookie: await sessionCookie(auditor),
    })
    expect(ver.status).toBe(200)

    const abrir = await call<{ turno: Turno }>(ABRIR, '/api/cash/shift', {
      method: 'POST',
      cookie: await sessionCookie(auditor),
      body: { openingAmount: '0.00' },
    })
    expect(abrir.status).toBe(403)
  })
})

describe('El acumulado historico sigue existiendo', () => {
  it('se sigue actualizando, pero ya no decide nada', async () => {
    await vender(2, 'efectivo')

    const esperadoDelTurno = multiplicarMonto(fx.productoA.price, 2)
    // Los dos coinciden porque el turno arranco en cero; lo que importa es que
    // son dos numeros distintos calculados por caminos distintos.
    expect(await cashOf(fx.branchA.id)).toBe(esperadoDelTurno)
    expect(await expectedOfShift(fx.branchA.id)).toBe(esperadoDelTurno)

    const res = await call<{ balance: string | null; acumuladoHistorico: string }>(
      SALDO,
      '/api/cash/balance',
      { cookie: await sessionCookie(fx.admin) },
    )
    expect(res.body.balance, 'El saldo que se muestra es el del TURNO').toBe(esperadoDelTurno)
    expect(res.body.acumuladoHistorico).toBe(esperadoDelTurno)
  })

  it('con un turno que arranca con plata, los dos numeros divergen y esta bien', async () => {
    await prisma.cashShift.update({
      where: { id: fx.turnoA },
      data: { openingAmount: 10_000 },
    })
    await vender(1, 'efectivo')

    // El acumulado no incluye el fondo inicial: nunca fue un movimiento.
    expect(await cashOf(fx.branchA.id)).toBe(fx.productoA.price)
    expect(await expectedOfShift(fx.branchA.id)).toBe(sumarMontos('10000.00', fx.productoA.price))
  })
})

describe('Auditoria', () => {
  it('la apertura y el cierre quedan registrados con sus importes', async () => {
    await sinTurnoAbierto()
    await call<{ turno: Turno }>(ABRIR, '/api/cash/shift', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
      body: { openingAmount: '7500.00' },
    })
    const turno = await prisma.cashShift.findFirstOrThrow({
      where: { branchId: fx.branchA.id, status: 'open' },
    })

    await call<{ turno: Turno; necesitoAutorizacion: boolean }>(
      CERRAR,
      `/api/cash/shift/${turno.id}/close`,
      {
        method: 'POST',
        cookie: await sessionCookie(fx.cajero),
        params: { id: String(turno.id) },
        body: { countedAmount: '7000.00', notes: 'Falta' },
      },
    )

    const entradas = await prisma.auditLog.findMany({
      where: { tableName: 'CashShift' },
      orderBy: { id: 'asc' },
    })

    expect(entradas.map((e) => e.actionType)).toEqual(['open', 'close'])

    const apertura = entradas[0]?.changes as { after?: { montoInicial?: string } }
    expect(apertura.after?.montoInicial).toBe('7500.00')

    const cierre = entradas[1]?.changes as {
      after?: { esperado?: string; contado?: string; diferencia?: string }
    }
    expect(cierre.after?.esperado).toBe('7500.00')
    expect(cierre.after?.contado).toBe('7000.00')
    expect(cierre.after?.diferencia).toBe('-500.00')
    expect(entradas[1]?.reason).toBe('Falta')
  })
})

describe('Consistencia exacta', () => {
  it('no hay un centavo de diferencia entre el esperado y la suma de lo que paso', async () => {
    // Precio con centavos, para que la cuenta no cierre por casualidad.
    await prisma.product.update({
      where: { id: fx.productoA.id },
      data: { price: '19.99' },
    })
    await prisma.cashShift.update({ where: { id: fx.turnoA }, data: { openingAmount: '0.07' } })

    await vender(3, 'efectivo')
    await call(MOVIMIENTO, '/api/cash', {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      body: { amount: '0.01', paymentMethod: 'efectivo', movementType: 'ingreso' },
    })

    // 0,07 + 59,97 + 0,01 = 60,05
    expect(await expectedOfShift(fx.branchA.id)).toBe('60.05')

    const movimientos = await prisma.cashRegisterMovement.findMany({
      where: { shiftId: fx.turnoA, paymentMethod: 'efectivo' },
    })
    const suma = sumarMontos('0.07', ...movimientos.map((m) => aMonto(m.amount)))
    expect(suma).toBe('60.05')
  })
})
