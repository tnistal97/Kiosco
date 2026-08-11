/**
 * Fase 4D contra la base: lotes, vencimientos y FEFO.
 *
 * Recorre los dos primeros ejemplos del pedido, con sus números:
 *
 *   A — FEFO      lote A vence antes con 3, lote B con 7, venta de 5 → A-3 B-2
 *   B — vencido   stock 10, vencidos 7, vendible 3, venta de 5 → RECHAZADA
 *
 * Y las reglas que los rodean:
 *
 *   1. un producto NONE se comporta exactamente como antes;
 *   2. no se activa REQUIRED dejando stock sin atribuir;
 *   3. atribuir NO mueve stock: no escribe en el libro de inventario;
 *   4. FEFO es determinístico y excluye los vencidos;
 *   5. la anulación devuelve a los MISMOS lotes, sin recalcular;
 *   6. una pérdida de un producto REQUIRED tiene que decir de qué partida;
 *   7. la identidad de un lote con historial es inmutable, incluso por SQL;
 *   8. el vencimiento es una FECHA y vuelve sin correrse un día.
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
// Ayudantes. Todos devuelven el `CallResult` entero: asi el mismo ayudante
// sirve para leer el cuerpo con `.body` y para pasarlo a `errorDe`.
// ---------------------------------------------------------------------------

/** `YYYY-MM-DD` a `dias` de hoy. Fecha de calendario, nunca un instante. */
function enDias(dias: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

async function crearLote(productId: number, code: string, vence: string | null) {
  const { POST } = await import('@/app/api/lotes/route')
  return call<{ id: number }>(POST, '/api/lotes', {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    body: { productId, code, ...(vence === null ? {} : { expirationDate: vence }) },
  })
}

async function atribuir(productId: number, lineas: Array<{ lotId: number; quantity: string }>) {
  const { POST } = await import('@/app/api/lotes/atribuir/route')
  return call(POST, '/api/lotes/atribuir', {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    body: { productId, reason: 'Inicialización de prueba', lineas },
  })
}

async function politica(productId: number, lote: string, venc: string) {
  const { PUT } = await import('@/app/api/productos/[id]/lotes/route')
  return call(PUT, `/api/productos/${String(productId)}/lotes`, {
    method: 'PUT',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(productId) },
    body: { lotTracking: lote, expirationTracking: venc },
  })
}

async function vender(items: unknown[]) {
  const { POST } = await import('@/app/api/sales/route')
  return call<{ id: number }>(POST, '/api/sales', {
    method: 'POST',
    cookie: await sessionCookie(fx.admin),
    body: { items, paymentMethod: 'CASH' },
  })
}

async function ajustar(body: unknown) {
  const { PATCH } = await import('@/app/api/stock/[id]/route')
  return call(PATCH, `/api/stock/${String(fx.productoA.id)}`, {
    method: 'PATCH',
    cookie: await sessionCookie(fx.admin),
    params: { id: String(fx.productoA.id) },
    body,
  })
}

async function stockDelLote(lotId: number): Promise<string> {
  const fila = await prisma.branchLotStock.findFirst({
    where: { lotId, branchId: fx.branchA.id },
    select: { quantity: true },
  })
  return (fila?.quantity ?? '0').toString()
}

async function stockDelProducto(): Promise<string> {
  const fila = await prisma.branchStock.findFirstOrThrow({
    where: { productId: fx.productoA.id, branchId: fx.branchA.id },
    select: { quantity: true },
  })
  return fila.quantity.toString()
}

/**
 * Deja `productoA` con dos partidas: una que vence pronto con `a` unidades y
 * otra que vence después con `b`. La suma tiene que ser su stock (10).
 */
async function dosPartidas(a: string, b: string, venceA = enDias(7), venceB = enDias(25)) {
  await politica(fx.productoA.id, 'OPTIONAL', 'OPTIONAL')
  const loteA = (await crearLote(fx.productoA.id, 'L-A', venceA)).body
  const loteB = (await crearLote(fx.productoA.id, 'L-B', venceB)).body
  await atribuir(fx.productoA.id, [
    { lotId: loteA.id, quantity: a },
    ...(b === '0' ? [] : [{ lotId: loteB.id, quantity: b }]),
  ])
  return { loteA, loteB }
}

/** Un producto que EXIGE lotes, con sus 10 unidades atribuidas a una partida. */
async function conLoteObligatorio() {
  await politica(fx.productoA.id, 'OPTIONAL', 'NONE')
  const lote = (await crearLote(fx.productoA.id, 'L-1', null)).body
  await atribuir(fx.productoA.id, [{ lotId: lote.id, quantity: '10' }])
  await politica(fx.productoA.id, 'REQUIRED', 'NONE')
  return lote
}

// ---------------------------------------------------------------------------

describe('el catálogo existente no cambia', () => {
  it('un producto NONE se vende sin lote', async () => {
    await vender([{ productId: fx.productoA.id, quantity: '2' }])

    const movs = await prisma.stockMovement.findMany({
      where: { productId: fx.productoA.id, type: 'SALE' },
      select: { lotId: true, quantity: true },
    })
    expect(movs).toHaveLength(1)
    expect(movs[0]?.lotId).toBeNull()
    expect(movs[0]?.quantity.toString()).toBe('-2')
  })

  it('no se le pueden crear partidas', async () => {
    const e = errorDe(await crearLote(fx.productoA.id, 'L-1', null))
    expect(e.code).toBe('LOT_NOT_TRACKED')
  })
})

describe('activar el rastreo', () => {
  it('no se puede exigir lotes dejando stock sin atribuir', async () => {
    await politica(fx.productoA.id, 'OPTIONAL', 'NONE')
    await crearLote(fx.productoA.id, 'L-1', null)

    const e = errorDe(await politica(fx.productoA.id, 'REQUIRED', 'NONE'))
    expect(e.code).toBe('LOT_TRACKING_NEEDS_ASSIGNMENT')
    expect(e.message).toContain('10')
  })

  it('con el stock atribuido entero, sí', async () => {
    await conLoteObligatorio()
    const p = await prisma.product.findUniqueOrThrow({
      where: { id: fx.productoA.id },
      select: { lotTracking: true },
    })
    expect(p.lotTracking).toBe('REQUIRED')
  })

  it('atribuir NO escribe en el libro de inventario', async () => {
    const antes = await prisma.stockMovement.count({ where: { productId: fx.productoA.id } })
    await politica(fx.productoA.id, 'OPTIONAL', 'NONE')
    const lote = (await crearLote(fx.productoA.id, 'L-1', null)).body
    await atribuir(fx.productoA.id, [{ lotId: lote.id, quantity: '4' }])

    expect(await prisma.stockMovement.count({ where: { productId: fx.productoA.id } })).toBe(antes)
    expect(await stockDelProducto()).toBe('10')
    expect(await stockDelLote(lote.id)).toBe('4')
  })

  it('no se atribuye más stock del que hay', async () => {
    await politica(fx.productoA.id, 'OPTIONAL', 'NONE')
    const lote = (await crearLote(fx.productoA.id, 'L-1', null)).body
    const e = errorDe(await atribuir(fx.productoA.id, [{ lotId: lote.id, quantity: '11' }]))
    expect(e.code).toBe('LOT_ASSIGNMENT_EXCEEDS_STOCK')
  })

  it('un vencimiento obligatorio sin lotes no se puede pedir', async () => {
    const e = errorDe(await politica(fx.productoA.id, 'NONE', 'REQUIRED'))
    expect(e.message).toContain('la fecha vive en la partida')
  })
})

describe('A — FEFO', () => {
  it('una venta de 5 toma 3 del que vence antes y 2 del otro', async () => {
    const { loteA, loteB } = await dosPartidas('3', '7')

    await vender([{ productId: fx.productoA.id, quantity: '5' }])

    expect(await stockDelLote(loteA.id)).toBe('0')
    expect(await stockDelLote(loteB.id)).toBe('5')

    const movs = await prisma.stockMovement.findMany({
      where: { productId: fx.productoA.id, type: 'SALE' },
      orderBy: { lotId: 'asc' },
      select: { lotId: true, quantity: true },
    })
    expect(movs).toHaveLength(2)
    expect(movs[0]?.lotId).toBe(loteA.id)
    expect(movs[0]?.quantity.toString()).toBe('-3')
    expect(movs[1]?.quantity.toString()).toBe('-2')
  })

  it('el reparto queda guardado en la línea de venta, sin partirla', async () => {
    const { loteA, loteB } = await dosPartidas('3', '7')
    const venta = (await vender([{ productId: fx.productoA.id, quantity: '5' }])).body

    const item = await prisma.saleItem.findFirstOrThrow({
      where: { saleId: venta.id },
      select: { quantity: true, lots: { orderBy: { lotId: 'asc' } } },
    })
    expect(item.quantity.toString()).toBe('5')
    expect(item.lots).toHaveLength(2)
    expect(item.lots[0]?.lotId).toBe(loteA.id)
    expect(item.lots[0]?.quantity.toString()).toBe('3')
    expect(item.lots[1]?.lotId).toBe(loteB.id)
    expect(item.lots[1]?.quantity.toString()).toBe('2')
  })

  it('el lote SIN fecha sale después de los que vencen', async () => {
    await politica(fx.productoA.id, 'OPTIONAL', 'OPTIONAL')
    const sinFecha = (await crearLote(fx.productoA.id, 'L-SF', null)).body
    const conFecha = (await crearLote(fx.productoA.id, 'L-CF', enDias(20))).body
    await atribuir(fx.productoA.id, [
      { lotId: sinFecha.id, quantity: '5' },
      { lotId: conFecha.id, quantity: '5' },
    ])

    await vender([{ productId: fx.productoA.id, quantity: '5' }])

    expect(await stockDelLote(conFecha.id)).toBe('0')
    expect(await stockDelLote(sinFecha.id)).toBe('5')
  })

  it('un producto OPTIONAL toma primero de los lotes y después de lo no atribuido', async () => {
    await politica(fx.productoA.id, 'OPTIONAL', 'OPTIONAL')
    const lote = (await crearLote(fx.productoA.id, 'L-1', enDias(10))).body
    await atribuir(fx.productoA.id, [{ lotId: lote.id, quantity: '4' }])

    await vender([{ productId: fx.productoA.id, quantity: '6' }])

    expect(await stockDelLote(lote.id)).toBe('0')
    const movs = await prisma.stockMovement.findMany({
      where: { productId: fx.productoA.id, type: 'SALE' },
      select: { lotId: true, quantity: true },
    })
    expect(movs).toHaveLength(2)
    expect(movs.find((m) => m.lotId === null)?.quantity.toString()).toBe('-2')
    expect(movs.find((m) => m.lotId === lote.id)?.quantity.toString()).toBe('-4')
  })
})

describe('B — un lote vencido no se vende', () => {
  it('con 10 en stock, 7 vencidos y 3 vendibles, una venta de 5 se rechaza', async () => {
    await dosPartidas('7', '3', enDias(-2), enDias(20))

    const e = errorDe(await vender([{ productId: fx.productoA.id, quantity: '5' }]))
    expect(e.code).toBe('INSUFFICIENT_SELLABLE_STOCK')
    // Los tres numeros, por separado: sin ellos habria que adivinar por que el
    // agregado dice 10 y la venta no entra.
    expect(e.message).toContain('vendible')
    expect(e.message).toContain('vencido')
  })

  it('una venta de 3 entra, y sale del lote que no venció', async () => {
    const { loteA, loteB } = await dosPartidas('7', '3', enDias(-2), enDias(20))

    await vender([{ productId: fx.productoA.id, quantity: '3' }])

    expect(await stockDelLote(loteA.id)).toBe('7')
    expect(await stockDelLote(loteB.id)).toBe('0')
  })

  it('el stock del producto NO cambia: el vencido sigue ocupando lugar', async () => {
    await dosPartidas('7', '3', enDias(-2), enDias(20))
    expect(await stockDelProducto()).toBe('10')
  })

  it('un lote que vence HOY todavía se vende', async () => {
    const { loteA } = await dosPartidas('10', '0', enDias(0), enDias(30))
    await vender([{ productId: fx.productoA.id, quantity: '1' }])
    expect(await stockDelLote(loteA.id)).toBe('9')
  })
})

describe('la anulación devuelve a los mismos lotes', () => {
  it('sin recalcular FEFO, aunque el orden haya cambiado', async () => {
    const { loteA, loteB } = await dosPartidas('3', '7')
    const venta = (await vender([{ productId: fx.productoA.id, quantity: '5' }])).body

    // Entre la venta y la anulación, el lote A vence: FEFO ya no lo elegiría.
    // La anulación tiene que devolverle sus 3 igual.
    await prisma.productLot.update({
      where: { id: loteA.id },
      data: { expirationDate: new Date(`${enDias(-1)}T00:00:00.000Z`) },
    })

    const { POST } = await import('@/app/api/sales/[id]/cancel/route')
    await call(POST, `/api/sales/${String(venta.id)}/cancel`, {
      method: 'POST',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(venta.id) },
      body: { reason: 'Prueba de anulación por lote' },
    })

    expect(await stockDelLote(loteA.id)).toBe('3')
    expect(await stockDelLote(loteB.id)).toBe('7')
  })
})

describe('pérdidas y roturas', () => {
  it('un producto REQUIRED exige decir de qué partida', async () => {
    await conLoteObligatorio()
    const e = errorDe(await ajustar({ delta: '-2', type: 'BREAKAGE', reason: 'Se rompieron dos' }))
    expect(e.code).toBe('LOT_REQUIRED')
  })

  it('con la partida, descuenta del lote y del producto', async () => {
    const lote = await conLoteObligatorio()
    await ajustar({ delta: '-2', type: 'BREAKAGE', reason: 'Se rompieron dos', lotId: lote.id })

    expect(await stockDelLote(lote.id)).toBe('8')
    expect(await stockDelProducto()).toBe('8')
  })

  it('el tope del lote es SUYO, aunque al producto le sobre stock', async () => {
    // 10 en el producto y 4 en la partida: pedirle 6 a la partida tiene que
    // fallar por el lote, no por el producto. Es el caso que distingue los dos
    // codigos de error, y el que justifica que sean dos.
    await politica(fx.productoA.id, 'OPTIONAL', 'NONE')
    const lote = (await crearLote(fx.productoA.id, 'L-1', null)).body
    await atribuir(fx.productoA.id, [{ lotId: lote.id, quantity: '4' }])

    const e = errorDe(
      await ajustar({ delta: '-6', type: 'LOSS', reason: 'Faltante', lotId: lote.id }),
    )
    expect(e.code).toBe('INSUFFICIENT_LOT_STOCK')
    expect(await stockDelProducto()).toBe('10')
  })
})

describe('la identidad de una partida', () => {
  it('no se puede cambiar el código de un lote que ya movió mercadería', async () => {
    const { loteA } = await dosPartidas('3', '7')
    await vender([{ productId: fx.productoA.id, quantity: '1' }])

    // Por SQL directo: el disparador tiene que rechazarlo aunque nadie pase por
    // el servicio.
    await expect(
      prisma.$executeRaw`
        UPDATE "ProductLot" SET "code" = 'OTRO', "codeNormalized" = 'OTRO'
         WHERE "id" = ${loteA.id}
      `,
    ).rejects.toThrow(/inmutable|movio mercaderia/i)
  })

  it('el vencimiento SÍ se puede corregir', async () => {
    const { loteA } = await dosPartidas('3', '7')
    await vender([{ productId: fx.productoA.id, quantity: '1' }])

    const { PATCH } = await import('@/app/api/lotes/[id]/route')
    await call(PATCH, `/api/lotes/${String(loteA.id)}`, {
      method: 'PATCH',
      cookie: await sessionCookie(fx.admin),
      params: { id: String(loteA.id) },
      body: { expirationDate: enDias(40) },
    })

    const lote = await prisma.productLot.findUniqueOrThrow({
      where: { id: loteA.id },
      select: { expirationDate: true },
    })
    expect(lote.expirationDate?.toISOString().slice(0, 10)).toBe(enDias(40))
  })

  it('dos partidas del mismo producto no pueden tener el mismo código', async () => {
    await politica(fx.productoA.id, 'OPTIONAL', 'NONE')
    await crearLote(fx.productoA.id, 'L-1', null)
    const e = errorDe(await crearLote(fx.productoA.id, ' l-1 ', null))
    expect(e.message).toContain('ya tiene la partida')
  })

  it('una atribución de lote es inmutable', async () => {
    await politica(fx.productoA.id, 'OPTIONAL', 'NONE')
    const lote = (await crearLote(fx.productoA.id, 'L-1', null)).body
    await atribuir(fx.productoA.id, [{ lotId: lote.id, quantity: '4' }])

    const fila = await prisma.lotAssignment.findFirstOrThrow({ select: { id: true } })
    await expect(
      prisma.$executeRaw`UPDATE "LotAssignment" SET "quantity" = 99 WHERE "id" = ${fila.id}`,
    ).rejects.toThrow(/inmutable/i)
  })
})

describe('el vencimiento es una fecha, no un instante', () => {
  it('vuelve tal cual se cargó, sin correrse un día', async () => {
    await politica(fx.productoA.id, 'OPTIONAL', 'OPTIONAL')
    const lote = (await crearLote(fx.productoA.id, 'L-1', '2026-09-05')).body

    const { GET } = await import('@/app/api/lotes/[id]/route')
    const detalle = await call<{ expirationDate: string }>(GET, `/api/lotes/${String(lote.id)}`, {
      cookie: await sessionCookie(fx.admin),
      params: { id: String(lote.id) },
    })
    expect(detalle.body.expirationDate).toBe('2026-09-05')
  })

  it('el estado se calcula con la fecha del negocio, no con la del proceso', async () => {
    // La sucursal está en Buenos Aires (UTC-3). Un lote que vence hoy no está
    // vencido, y a las 21:05 de acá el reloj UTC ya marca mañana: si el estado
    // saliera de un instante, este lote aparecería vencido tres horas por día.
    await politica(fx.productoA.id, 'OPTIONAL', 'OPTIONAL')
    const lote = (await crearLote(fx.productoA.id, 'L-HOY', enDias(0))).body

    const { GET } = await import('@/app/api/lotes/[id]/route')
    const detalle = await call<{ estado: string; dias: number }>(
      GET,
      `/api/lotes/${String(lote.id)}`,
      { cookie: await sessionCookie(fx.admin), params: { id: String(lote.id) } },
    )
    expect(detalle.body.estado).toBe('VENCE_HOY')
    expect(detalle.body.dias).toBe(0)
  })
})
