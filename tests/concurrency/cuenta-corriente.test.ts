/**
 * Objetivo 33 — el limite de credito y el libro bajo concurrencia.
 *
 * Estos tests fallan de forma intermitente si la implementacion es incorrecta,
 * no siempre. Por eso cada caso repite la operacion varias veces: una sola
 * pasada puede no llegar a solapar.
 *
 * El caso que da sentido a todo el archivo:
 *
 *   CLIENTE CON SALDO 40.000 Y LIMITE 50.000. DOS CAJAS INTENTAN FIARLE 8.000
 *   AL MISMO TIEMPO. NUNCA PUEDE TERMINAR EN 56.000.
 *
 * La version ingenua --leer el saldo, comparar contra el limite en JavaScript,
 * escribir-- deja un hueco entre la lectura y la escritura: las dos leen "hay
 * lugar", las dos deciden "entra", y el saldo termina pasado. Ese hueco no se
 * cierra con mas comprobaciones: se cierra no teniendolo, y por eso el limite
 * se comprueba DENTRO de la misma sentencia que mueve el saldo.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import {
  seedFixture,
  prisma,
  saldoDe,
  descuadresDeCuenta,
  movimientosDeCuenta,
  num,
  type Fixture,
} from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

import { POST as CREAR_VENTA } from '@/app/api/sales/route'
import { POST as COBRAR } from '@/app/api/clients/[id]/pagos/route'
import { POST as AJUSTAR } from '@/app/api/clients/[id]/ajuste/route'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  // $1.000 la unidad: asi cualquier importe redondo de esta suite es una
  // cantidad entera de unidades, y la venta cierra sin restos.
  await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: '1000.00' } })
  // Stock de sobra: lo que se prueba aca es el limite de credito, no el stock.
  await prisma.branchStock.update({
    where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
    data: { quantity: 500 },
  })
  await prisma.stockMovement.create({
    data: {
      branchId: fx.branchA.id,
      productId: fx.productoA.id,
      type: 'MANUAL_ADJUSTMENT',
      quantity: 490,
      previousQuantity: 10,
      resultingQuantity: 500,
      userId: fx.admin.id,
      reason: 'Preparacion del escenario de concurrencia',
    },
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

/** Deja al cliente con el saldo pedido, por la puerta oficial. */
async function ponerSaldo(clientId: number, monto: string) {
  await call(AJUSTAR, `/api/clients/${String(clientId)}/ajuste`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    body: { delta: monto, reason: 'Preparacion del escenario de concurrencia' },
    params: { id: String(clientId) },
  })
}

/**
 * Vende a cuenta por `monto` pesos exactos.
 *
 * La cantidad se DERIVA del importe y del precio ($1.000) en vez de fijarse: la
 * invariante `suma(pagos) == total` sigue valiendo con fiado, asi que una linea
 * `ACCOUNT` que no coincida con el total es un 400 y no una venta.
 */
async function fiarUna(clientId: number, monto = '8000.00') {
  const unidades = Number(monto) / 1000
  return call(CREAR_VENTA, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body: {
      items: [{ productId: fx.productoA.id, quantity: unidades }],
      clientId,
      payments: [{ method: 'ACCOUNT', amount: monto }],
    },
  })
}

async function cobrarUno(clientId: number, monto: string) {
  return call(COBRAR, `/api/clients/${String(clientId)}/pagos`, {
    method: 'POST',
    cookie: await sessionCookie(fx.cajero),
    body: { amount: monto, method: 'CASH' },
    params: { id: String(clientId) },
  })
}

/** El libro tiene que cuadrar SIEMPRE, pase lo que pase con la concurrencia. */
async function elLibroCierra() {
  expect(await descuadresDeCuenta(), 'el saldo de un cliente no coincide con su libro').toEqual([])
}

/**
 * La cadena de saldos es continua: cada movimiento empieza donde termino el
 * anterior.
 *
 * Es la comprobacion que de verdad detecta una carrera perdida. Dos
 * transacciones que leyeran el mismo saldo de partida escribirian dos filas con
 * el MISMO `previousBalance`, y el saldo final podria quedar bien igual --si los
 * deltas se aplicaron con `balance = balance + x` en la base-- mientras el libro
 * cuenta una historia imposible.
 */
async function laCadenaEsContinua(clientId: number) {
  const movimientos = await movimientosDeCuenta(clientId)
  let esperado = 0
  for (const m of movimientos) {
    expect(
      num(m.previousBalance),
      `el movimiento #${String(m.id)} no empieza donde termino el anterior`,
    ).toBe(esperado)
    esperado = num(m.resultingBalance)
  }
  const cliente = await prisma.client.findUnique({ where: { id: clientId } })
  expect(num(cliente?.balance), 'el saldo final no es el ultimo resultante del libro').toBe(
    esperado,
  )
}

describe('el limite de credito bajo concurrencia', () => {
  it('EL CASO: dos cajas fian 8.000 sobre un saldo de 40.000 y un limite de 50.000', async () => {
    // Se repite: una sola pasada puede no llegar a solapar.
    for (let intento = 0; intento < 5; intento++) {
      fx = await seedFixture()
      await prisma.product.update({ where: { id: fx.productoA.id }, data: { price: '1000.00' } })
      await prisma.branchStock.update({
        where: { branchId_productId: { branchId: fx.branchA.id, productId: fx.productoA.id } },
        data: { quantity: 500 },
      })
      await ponerSaldo(fx.cliente.id, '40000.00')

      const [a, b] = await Promise.all([fiarUna(fx.cliente.id), fiarUna(fx.cliente.id)])
      const exitosas = [a, b].filter((r) => r.status < 300).length

      // Una entra (48.000) y la otra NO (56.000 > 50.000). Nunca las dos.
      expect(exitosas, `intento ${String(intento)}: las dos ventas pasaron el limite`).toBe(1)
      expect(
        await saldoDe(fx.cliente.id),
        `intento ${String(intento)}: el saldo se paso del limite`,
      ).toBe('48000.00')

      await elLibroCierra()
      await laCadenaEsContinua(fx.cliente.id)
    }
  }, 60_000)

  it('diez intentos simultaneos sobre un limite que da para uno solo', async () => {
    await ponerSaldo(fx.cliente.id, '45000.00')

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => fiarUna(fx.cliente.id, '4000.00')),
    )
    const exitosas = resultados.filter((r) => r.status < 300).length

    // 45.000 + 4.000 = 49.000 entra. Un segundo daria 53.000 y no entra.
    expect(exitosas, 'mas de una venta se colo por encima del limite').toBe(1)
    expect(await saldoDe(fx.cliente.id)).toBe('49000.00')

    await elLibroCierra()
    await laCadenaEsContinua(fx.cliente.id)
  }, 60_000)

  it('sin limite configurado, las diez entran y el libro sigue cerrando', async () => {
    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => fiarUna(fx.clienteSinLimite.id, '8000.00')),
    )

    expect(resultados.filter((r) => r.status < 300).length, 'sin limite no hay tope').toBe(10)
    expect(await saldoDe(fx.clienteSinLimite.id)).toBe('80000.00')

    await elLibroCierra()
    await laCadenaEsContinua(fx.clienteSinLimite.id)
  }, 60_000)
})

describe('cobros simultaneos', () => {
  it('dos pagos a la vez dejan la cadena continua y ningun importe perdido', async () => {
    await ponerSaldo(fx.cliente.id, '30000.00')

    const resultados = await Promise.all([
      cobrarUno(fx.cliente.id, '5000.00'),
      cobrarUno(fx.cliente.id, '7000.00'),
    ])

    expect(resultados.filter((r) => r.status < 300).length, 'un cobro se perdio').toBe(2)
    expect(await saldoDe(fx.cliente.id), '30.000 - 5.000 - 7.000').toBe('18000.00')

    await elLibroCierra()
    await laCadenaEsContinua(fx.cliente.id)
  }, 60_000)

  it('diez pagos en paralelo suman diez veces', async () => {
    await ponerSaldo(fx.cliente.id, '100000.00')

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () => cobrarUno(fx.cliente.id, '1000.00')),
    )

    expect(resultados.filter((r) => r.status < 300).length).toBe(10)
    expect(await saldoDe(fx.cliente.id), 'se perdio alguna actualizacion de saldo').toBe('90000.00')

    // Y diez comprobantes con diez numeros DISTINTOS: la secuencia de
    // PostgreSQL no puede entregar el mismo dos veces.
    const numeros = (await prisma.customerPayment.findMany({ select: { number: true } })).map(
      (p) => p.number,
    )
    expect(new Set(numeros).size, 'dos cobros recibieron el mismo numero').toBe(10)
    for (const n of numeros) expect(n).toMatch(/^RC-\d{8}$/)

    await elLibroCierra()
    await laCadenaEsContinua(fx.cliente.id)
  }, 60_000)
})

describe('venta y cobro a la vez', () => {
  it('el libro mantiene la continuidad aunque se crucen', async () => {
    await ponerSaldo(fx.cliente.id, '20000.00')

    // Cinco ventas y cinco cobros, todos mezclados. El limite (50.000) da para
    // las cinco ventas de 4.000 aunque no entrara ningun cobro.
    const operaciones = [
      ...Array.from({ length: 5 }, () => fiarUna(fx.cliente.id, '4000.00')),
      ...Array.from({ length: 5 }, () => cobrarUno(fx.cliente.id, '2000.00')),
    ]

    const resultados = await Promise.all(operaciones)
    expect(resultados.filter((r) => r.status < 300).length, 'alguna operacion fallo').toBe(10)

    // 20.000 + 5x4.000 - 5x2.000 = 30.000
    expect(await saldoDe(fx.cliente.id)).toBe('30000.00')

    await elLibroCierra()
    await laCadenaEsContinua(fx.cliente.id)
  }, 60_000)
})
