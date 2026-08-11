/**
 * Fase 4D contra la base: inventario físico.
 *
 * Recorre el tercer ejemplo del pedido, con sus números:
 *
 *   inicio                     10
 *   venta durante el conteo    -2
 *   esperado al contar          8
 *   conteo físico               7
 *   diferencia                 -1
 *   otra venta antes de aplicar -1   → stock 7
 *   INVENTORY_COUNT            -1   → stock 6
 *
 * Y las reglas que lo rodean:
 *
 *   1. el conteo a ciegas NO devuelve lo esperado mientras se cuenta;
 *   2. no se cierra el conteo con líneas sin contar;
 *   3. una línea sin partida en un producto REQUIRED bloquea la aplicación;
 *   4. una sesión aplicada es inmutable, incluso por SQL directo;
 *   5. sólo `apply` mueve stock: contar y revisar no tocan nada.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------

/**
 * Una sesion acotada al producto de prueba.
 *
 * Alcance SELECTION y no ALL: la fixture tiene tres productos en la sucursal, y
 * un inventario de todo obligaria a contar los otros dos en cada prueba para
 * poder cerrarlo. El alcance por seleccion es ademas el que hace falta probar.
 */
async function crearInventario(
  body: unknown = { scope: 'SELECTION', productIds: [] as number[], blindCount: true },
) {
  const { POST } = await import('@/app/api/inventarios/route')
  return call<{ id: number; number: string; status: string }>(POST, '/api/inventarios', {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    body:
      typeof body === 'object' && body !== null && 'productIds' in body
        ? { ...body, productIds: [fx.productoA.id] }
        : body,
  })
}

async function lineas(id: number) {
  const { GET } = await import('@/app/api/inventarios/[id]/lineas/route')
  return call<{
    data: Array<{
      id: number
      productId: number
      lotId: number | null
      status: string
      expectedAtCount: string | null
      variance: string | null
      countedQuantity: string | null
    }>
  }>(GET, `/api/inventarios/${String(id)}/lineas?pageSize=100`, {
    cookie: await sessionCookie(fx.admin),
    params: { id: String(id) },
  })
}

async function contar(id: number, cuerpo: unknown) {
  const { POST } = await import('@/app/api/inventarios/[id]/conteo/route')
  return call(POST, `/api/inventarios/${String(id)}/conteo`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(id) },
    body: cuerpo,
  })
}

async function revisar(id: number) {
  const { POST } = await import('@/app/api/inventarios/[id]/revision/route')
  return call(POST, `/api/inventarios/${String(id)}/revision`, {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(id) },
  })
}

async function aplicar(id: number) {
  const { POST } = await import('@/app/api/inventarios/[id]/aplicar/route')
  return call<{ status: string; movimientos: number }>(
    POST,
    `/api/inventarios/${String(id)}/aplicar`,
    { method: 'POST', cookie: await sessionCookie(fx.admin), params: { id: String(id) } },
  )
}

async function vender(cantidad: string) {
  const { POST } = await import('@/app/api/sales/route')
  return call<{ id: number }>(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    body: {
      items: [{ productId: fx.productoA.id, quantity: cantidad }],
      paymentMethod: 'CASH',
    },
  })
}

async function stock(): Promise<string> {
  const fila = await prisma.branchStock.findFirstOrThrow({
    where: { productId: fx.productoA.id, branchId: fx.branchA.id },
    select: { quantity: true },
  })
  return fila.quantity.toString()
}

/** La línea de `productoA` sin partida, que es la única que tiene. */
async function lineaDelProducto(id: number) {
  const res = await lineas(id)
  const linea = res.body.data.find((l) => l.productId === fx.productoA.id && l.lotId === null)
  if (!linea) throw new Error('La sesión no generó línea para el producto de prueba')
  return linea
}

// ---------------------------------------------------------------------------

describe('C — contar sin cerrar el local', () => {
  it('lo esperado se lee al contar, no al empezar', async () => {
    const sesion = (await crearInventario()).body
    const inicial = await lineaDelProducto(sesion.id)
    expect(await stock()).toBe('10')

    // Se vende DURANTE el conteo. Lo esperado baja a 8.
    await vender('2')
    expect(await stock()).toBe('8')

    await contar(sesion.id, {
      lineas: [{ lineId: inicial.id, countedQuantity: '7' }],
    })

    await revisar(sesion.id)
    const linea = await lineaDelProducto(sesion.id)
    // NO es -3: lo esperado cuando contó eran 8, no los 10 del inicio.
    expect(linea.expectedAtCount).toBe('8.000')
    expect(linea.countedQuantity).toBe('7.000')
    expect(linea.variance).toBe('-1.000')
  })

  it('se aplica el DELTA, no el número contado', async () => {
    const sesion = (await crearInventario()).body
    const inicial = await lineaDelProducto(sesion.id)

    await vender('2')
    await contar(sesion.id, { lineas: [{ lineId: inicial.id, countedQuantity: '7' }] })
    await revisar(sesion.id)

    // Otra venta ANTES de aplicar. El stock queda en 7.
    await vender('1')
    expect(await stock()).toBe('7')

    const res = (await aplicar(sesion.id)).body
    expect(res.status).toBe('APPLIED')

    // 7 - 1 = 6. Escribir "stock = 7" habría borrado la segunda venta.
    expect(await stock()).toBe('6')

    const mov = await prisma.stockMovement.findFirstOrThrow({
      where: { productId: fx.productoA.id, type: 'INVENTORY_COUNT' },
      select: {
        quantity: true,
        previousQuantity: true,
        resultingQuantity: true,
        referenceId: true,
      },
    })
    expect(mov.quantity.toString()).toBe('-1')
    expect(mov.previousQuantity.toString()).toBe('7')
    expect(mov.resultingQuantity.toString()).toBe('6')
    expect(mov.referenceId).toBe(sesion.id)
  })

  it('una diferencia de cero no emite movimiento', async () => {
    const sesion = (await crearInventario()).body
    const inicial = await lineaDelProducto(sesion.id)
    await contar(sesion.id, { lineas: [{ lineId: inicial.id, countedQuantity: '10' }] })
    // El resto de las líneas del catálogo también hay que contarlas.
    const todas = (await lineas(sesion.id)).body.data.filter((l) => l.status === 'PENDING')
    if (todas.length > 0) {
      await contar(sesion.id, {
        lineas: todas.map((l) => ({ lineId: l.id, countedQuantity: '0' })),
      })
    }
    await revisar(sesion.id)
    const res = (await aplicar(sesion.id)).body

    const delProducto = await prisma.stockMovement.count({
      where: { productId: fx.productoA.id, type: 'INVENTORY_COUNT' },
    })
    expect(delProducto).toBe(0)
    expect(res.status).toBe('APPLIED')
  })
})

describe('conteo a ciegas', () => {
  it('no devuelve lo esperado mientras se cuenta', async () => {
    const sesion = (await crearInventario()).body
    const inicial = await lineaDelProducto(sesion.id)
    await contar(sesion.id, { lineas: [{ lineId: inicial.id, countedQuantity: '7' }] })

    const linea = await lineaDelProducto(sesion.id)
    expect(linea.expectedAtCount).toBeNull()
    expect(linea.variance).toBeNull()
    // Lo contado sí: es lo que el operario acaba de escribir.
    expect(linea.countedQuantity).toBe('7.000')
  })

  it('con el conteo apagado, lo esperado se ve desde el principio', async () => {
    const sesion = (
      await crearInventario({ scope: 'SELECTION', productIds: [] as number[], blindCount: false })
    ).body
    const inicial = await lineaDelProducto(sesion.id)
    await contar(sesion.id, { lineas: [{ lineId: inicial.id, countedQuantity: '7' }] })

    const linea = await lineaDelProducto(sesion.id)
    expect(linea.expectedAtCount).toBe('10.000')
    expect(linea.variance).toBe('-3.000')
  })
})

describe('los estados', () => {
  it('no se cierra el conteo con líneas sin contar', async () => {
    // Alcance ALL para que la sesion tenga mas de una linea: se cuenta una y las
    // otras quedan pendientes, que es exactamente el caso que hay que frenar.
    const sesion = (await crearInventario({ scope: 'ALL', blindCount: true })).body
    const inicial = await lineaDelProducto(sesion.id)
    await contar(sesion.id, { lineas: [{ lineId: inicial.id, countedQuantity: '10' }] })

    const e = errorDe(await revisar(sesion.id))
    expect(e.code).toBe('COUNT_INCOMPLETE')
  })

  it('no se aplica una sesión que todavía está contando', async () => {
    const sesion = (await crearInventario()).body
    const inicial = await lineaDelProducto(sesion.id)
    await contar(sesion.id, { lineas: [{ lineId: inicial.id, countedQuantity: '10' }] })

    const e = errorDe(await aplicar(sesion.id))
    expect(e.code).toBe('COUNT_NOT_EDITABLE')
  })

  it('contar y revisar NO tocan el stock', async () => {
    const sesion = (await crearInventario()).body
    const todas = (await lineas(sesion.id)).body.data
    await contar(sesion.id, {
      lineas: todas.map((l) => ({ lineId: l.id, countedQuantity: '1' })),
    })
    await revisar(sesion.id)
    expect(await stock()).toBe('10')
  })

  it('una sesión aplicada es inmutable, incluso por SQL directo', async () => {
    const sesion = (await crearInventario()).body
    const todas = (await lineas(sesion.id)).body.data
    await contar(sesion.id, {
      lineas: todas.map((l) => ({ lineId: l.id, countedQuantity: '1' })),
    })
    await revisar(sesion.id)
    await aplicar(sesion.id)

    await expect(
      prisma.$executeRaw`
        UPDATE "InventoryCountSession" SET "notes" = 'editado' WHERE "id" = ${sesion.id}
      `,
    ).rejects.toThrow(/inmutable/i)
  })

  it('una línea de una sesión aplicada tampoco se edita', async () => {
    const sesion = (await crearInventario()).body
    const todas = (await lineas(sesion.id)).body.data
    await contar(sesion.id, {
      lineas: todas.map((l) => ({ lineId: l.id, countedQuantity: '1' })),
    })
    await revisar(sesion.id)
    await aplicar(sesion.id)

    const linea = await lineaDelProducto(sesion.id)
    await expect(
      prisma.$executeRaw`
        UPDATE "InventoryCountLine" SET "countedQuantity" = 99 WHERE "id" = ${linea.id}
      `,
    ).rejects.toThrow(/inmutable/i)
  })
})

describe('unidades sin partida identificada', () => {
  it('bloquean la aplicación hasta que alguien diga de cuál son', async () => {
    // El producto exige lotes y tiene sus 10 unidades en una partida.
    const { PUT } = await import('@/app/api/productos/[id]/lotes/route')
    const { POST: crearLote } = await import('@/app/api/lotes/route')
    const { POST: atribuir } = await import('@/app/api/lotes/atribuir/route')
    const cookie = await sessionCookie(fx.admin)

    await call(PUT, `/api/productos/${String(fx.productoA.id)}/lotes`, {
      method: 'PUT',
      cookie,
      params: { id: String(fx.productoA.id) },
      body: { lotTracking: 'OPTIONAL', expirationTracking: 'NONE' },
    })
    const lote = (
      await call<{ id: number }>(crearLote, '/api/lotes', {
        method: 'POST',
        cookie,
        body: { productId: fx.productoA.id, code: 'L-1' },
      })
    ).body
    await call(atribuir, '/api/lotes/atribuir', {
      method: 'POST',
      cookie,
      body: {
        productId: fx.productoA.id,
        reason: 'Inicialización',
        lineas: [{ lotId: lote.id, quantity: '10' }],
      },
    })
    await call(PUT, `/api/productos/${String(fx.productoA.id)}/lotes`, {
      method: 'PUT',
      cookie,
      params: { id: String(fx.productoA.id) },
      body: { lotTracking: 'REQUIRED', expirationTracking: 'NONE' },
    })

    const sesion = (await crearInventario()).body
    const todas = (await lineas(sesion.id)).body.data

    // Aparecen 3 unidades sin saber de qué partida: van a la línea sin lote.
    for (const l of todas) {
      const esLaSinPartida = l.productId === fx.productoA.id && l.lotId === null
      await contar(sesion.id, {
        lineas: [{ lineId: l.id, countedQuantity: esLaSinPartida ? '3' : '0' }],
      })
    }

    const sinPartida = await lineaDelProducto(sesion.id)
    expect(sinPartida.status).toBe('UNRESOLVED')

    await revisar(sesion.id)
    const e = errorDe(await aplicar(sesion.id))
    expect(e.code).toBe('COUNT_HAS_UNRESOLVED')
    expect(e.message).toContain('no inventa códigos de lote')

    // Resolverla: las 3 unidades son de la partida L-1.
    const { POST: resolver } =
      await import('@/app/api/inventarios/[id]/lineas/[lineId]/resolver/route')
    await call(
      resolver,
      `/api/inventarios/${String(sesion.id)}/lineas/${String(sinPartida.id)}/resolver`,
      {
        method: 'POST',
        cookie,
        params: { id: String(sesion.id), lineId: String(sinPartida.id) },
        body: { lotId: lote.id },
      },
    )

    const aplicada = (await aplicar(sesion.id)).body
    expect(aplicada.status).toBe('APPLIED')
  })
})
