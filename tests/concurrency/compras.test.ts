/**
 * La recepcion de mercaderia bajo concurrencia.
 *
 * Tres propiedades, y ninguna admite excepciones:
 *
 *   1. la suma de lo recibido NUNCA supera lo pedido;
 *   2. el libro de inventario queda CONTINUO: cada movimiento arranca donde
 *      termino el anterior;
 *   3. el costo del producto es el de la ultima recepcion que confirmo, y el
 *      historial cuenta esa misma secuencia.
 *
 * Estos casos fallan de forma intermitente si la implementacion es incorrecta,
 * no siempre: la version ingenua --leer, comparar en JavaScript, escribir--
 * solo se rompe cuando las dos transacciones se solapan de verdad. Por eso
 * cada caso repite o exige el resultado exacto en vez de "al menos uno".
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { Prisma } from '@prisma/client'
import { seedFixture, prisma, stockExacto, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

interface OrdenRes {
  id: number
  number: string
  items: Array<{ id: number }>
}

/** Una orden confirmada de N cajas a $8.800, lista para recibir. */
async function ordenLista(cajas: string, unitCost = '8800') {
  const { POST } = await import('@/app/api/purchases/route')
  const creada = await call<OrdenRes>(POST, '/api/purchases', {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    body: {
      supplierId: fx.proveedor.id,
      items: [{ productId: fx.productoCaja.id, quantity: cajas, unitCost }],
    },
  })

  const { POST: confirmar } = await import('@/app/api/purchases/[id]/confirm/route')
  await call(confirmar, `/api/purchases/${String(creada.body.id)}/confirm`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(creada.body.id) },
  })

  const linea = creada.body.items[0]
  if (!linea) throw new Error('la orden quedo sin lineas')
  return { orderId: creada.body.id, itemId: linea.id }
}

async function recibir(orderId: number, itemId: number, quantity: string, unitCost?: string) {
  const { POST } = await import('@/app/api/purchases/[id]/receive/route')
  return call<{ receiptId: number; status: string }>(
    POST,
    `/api/purchases/${String(orderId)}/receive`,
    {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(orderId) },
      body: {
        items: [{ orderItemId: itemId, quantity, ...(unitCost === undefined ? {} : { unitCost }) }],
      },
    },
  )
}

/**
 * El libro del producto tiene que ser una cadena continua.
 *
 * Mas fuerte que "la suma cuadra": si dos recepciones simultaneas leen el
 * mismo saldo y escriben cada una el suyo, la suma puede cuadrar de casualidad
 * mientras los saldos intermedios cuentan una historia que nunca paso.
 */
async function exigirCadenaContinua(): Promise<string> {
  const saldo = await stockExacto(fx.branchA.id, fx.productoCaja.id)

  const movimientos = await prisma.stockMovement.findMany({
    where: { branchId: fx.branchA.id, productId: fx.productoCaja.id },
    orderBy: { id: 'asc' },
  })

  expect(
    movimientos.at(-1)?.resultingQuantity.toFixed(3),
    'el saldo no es el ultimo movimiento',
  ).toBe(saldo)

  for (let i = 1; i < movimientos.length; i++) {
    expect(
      movimientos[i]?.previousQuantity.toFixed(3),
      `el movimiento ${String(movimientos[i]?.id)} arranca en un saldo que nadie dejo`,
    ).toBe(movimientos[i - 1]?.resultingQuantity.toFixed(3))
  }

  const suma = movimientos.reduce((acc, m) => acc.plus(m.quantity), new Prisma.Decimal(0))
  expect(suma.toFixed(3), 'la suma del libro no da el saldo').toBe(saldo)

  return saldo
}

describe('Dos recepciones simultaneas', () => {
  it('con 5 pendientes y dos procesos pidiendo 4, NUNCA quedan 8 recibidas', async () => {
    const { orderId, itemId } = await ordenLista('5')

    const [a, b] = await Promise.all([recibir(orderId, itemId, '4'), recibir(orderId, itemId, '4')])

    const ok = [a, b].filter((r) => r.status === 200)
    expect(ok, 'las dos recepciones pasaron: se recibio mas de lo pedido').toHaveLength(1)

    const linea = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(linea.receivedQuantity.toFixed(3)).toBe('4.000')

    // 100 + 4 cajas de 8 = 132. La que fallo no dejo ni un movimiento.
    expect(await exigirCadenaContinua()).toBe('132.000')
  }, 30_000)

  it('cinco recepciones de 1 caja sobre 5 pedidas: entran las cinco, exactas', async () => {
    const { orderId, itemId } = await ordenLista('5')

    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => recibir(orderId, itemId, '1')),
    )
    const ok = resultados.filter((r) => r.status === 200)

    expect(ok, 'cinco cajas pedidas dan exactamente cinco recepciones de una').toHaveLength(5)

    const linea = await prisma.purchaseOrderItem.findUniqueOrThrow({ where: { id: itemId } })
    expect(linea.receivedQuantity.toFixed(3)).toBe('5.000')

    // 100 + 5 x 8 = 140, sin residuo y sin importar el orden en que entraron.
    expect(await exigirCadenaContinua()).toBe('140.000')

    const orden = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: orderId } })
    expect(orden.status, 'con todo recibido la orden queda RECEIVED').toBe('RECEIVED')
  }, 60_000)

  it('seis recepciones de 1 sobre 5 pedidas: entra una menos', async () => {
    const { orderId, itemId } = await ordenLista('5')

    const resultados = await Promise.all(
      Array.from({ length: 6 }, () => recibir(orderId, itemId, '1')),
    )

    expect(resultados.filter((r) => r.status === 200)).toHaveLength(5)
    expect(resultados.filter((r) => r.status === 409)).toHaveLength(1)
    expect(await exigirCadenaContinua()).toBe('140.000')
  }, 60_000)

  it('la restriccion de la base tambien lo impide, sin pasar por el servicio', async () => {
    // El UPDATE condicional del servicio cierra la carrera; el CHECK es la
    // garantia de ultima instancia. Se comprueba aparte porque si algun dia
    // alguien escribe sobre la tabla por otro camino, esto es lo unico que
    // queda en pie.
    const { itemId } = await ordenLista('5')

    await expect(
      prisma.purchaseOrderItem.update({
        where: { id: itemId },
        data: { receivedQuantity: 6 },
      }),
    ).rejects.toThrow()
  })
})

describe('Costo bajo concurrencia', () => {
  it('el costo del producto es el de la recepcion que confirmo ultimo', async () => {
    const primera = await ordenLista('2', '8000')
    const segunda = await ordenLista('2', '9600')

    await Promise.all([
      recibir(primera.orderId, primera.itemId, '1'),
      recibir(segunda.orderId, segunda.itemId, '1'),
    ])

    const producto = await prisma.product.findUniqueOrThrow({
      where: { id: fx.productoCaja.id },
      select: { cost: true },
    })

    // $8.000/8 = $1.000 y $9.600/8 = $1.200. El orden real de confirmacion lo
    // decide PostgreSQL; lo que NO puede pasar es que quede un tercer numero,
    // ni que el historial diga otra cosa que el producto.
    const costoFinal = producto.cost?.toFixed(4)
    expect(['1000.0000', '1200.0000']).toContain(costoFinal)

    const historial = await prisma.productCostHistory.findMany({
      where: { productId: fx.productoCaja.id },
      orderBy: { id: 'asc' },
    })
    expect(historial).toHaveLength(2)
    expect(
      historial.at(-1)?.newCost.toFixed(4),
      'el ultimo cambio del historial y el costo del producto tienen que coincidir',
    ).toBe(costoFinal)
  }, 30_000)

  it('el historial encadena: el previousCost del segundo es el newCost del primero', async () => {
    const primera = await ordenLista('2', '8000')
    const segunda = await ordenLista('2', '9600')

    // En serie, para que el orden sea conocido y la cadena verificable.
    await recibir(primera.orderId, primera.itemId, '1')
    await recibir(segunda.orderId, segunda.itemId, '1')

    const historial = await prisma.productCostHistory.findMany({
      where: { productId: fx.productoCaja.id },
      orderBy: { id: 'asc' },
    })

    expect(historial[0]?.previousCost, 'el producto no tenia costo').toBeNull()
    expect(historial[0]?.newCost.toFixed(4)).toBe('1000.0000')
    expect(historial[1]?.previousCost?.toFixed(4)).toBe('1000.0000')
    expect(historial[1]?.newCost.toFixed(4)).toBe('1200.0000')
  }, 30_000)
})

describe('Numeracion bajo concurrencia', () => {
  it('diez ordenes simultaneas dan diez numeros distintos', async () => {
    const { POST } = await import('@/app/api/purchases/route')
    const cookie = await sessionCookie(fx.admin)

    const resultados = await Promise.all(
      Array.from({ length: 10 }, () =>
        call<{ number: string }>(POST, '/api/purchases', {
          method: 'POST',
          cookie,
          body: { supplierId: fx.proveedor.id, items: [] },
        }),
      ),
    )

    expect(resultados.every((r) => r.status === 201)).toBe(true)

    const numeros = resultados.map((r) => r.body.number)
    expect(new Set(numeros).size, 'dos ordenes con el mismo numero').toBe(10)
    // Y todos tienen la forma legible, no un id crudo.
    for (const n of numeros) expect(n).toMatch(/^OC-\d{8}$/)
  }, 30_000)
})
