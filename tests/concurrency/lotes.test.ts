/**
 * Objetivo 43 — lotes e inventario físico bajo concurrencia.
 *
 * Estos tests fallan de forma INTERMITENTE si la implementación es incorrecta,
 * no siempre. Por eso cada caso repite la operación varias veces: una sola
 * pasada puede no llegar a solapar.
 *
 * Los cuatro casos, y lo que protege a cada uno:
 *
 *   1. DOS VENTAS de 2 sobre un lote que tiene 2. Nunca puede quedar en -2. Lo
 *      cierra la condición `quantity + delta >= 0` del saldo del LOTE, que
 *      viaja dentro de la misma sentencia que descuenta --la misma técnica que
 *      protege el stock del producto desde la Fase 3A, un nivel más abajo--.
 *
 *   2. DOS ATRIBUCIONES de 8 sobre un producto que tiene 10. Nunca pueden
 *      atribuirse 16. Acá el tope NO vive en la fila que se escribe --es la
 *      suma de otra tabla-- y lo cierra el bloqueo de `BranchStock`, tomado en
 *      su propia sentencia ANTES de sumar lo ya atribuido.
 *
 *   3. VENTA Y AJUSTE del mismo lote a la vez. El saldo del lote tiene que
 *      quedar continuo y nunca negativo.
 *
 *   4. DOS INVENTARIOS que cuentan el mismo producto y aplican a la vez. La
 *      diferencia NO se puede corregir dos veces: el segundo tiene que
 *      rechazarse con `COUNT_SUPERSEDED`.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'

import { POST as VENDER } from '@/app/api/sales/route'
import { POST as CREAR_LOTE } from '@/app/api/lotes/route'
import { POST as ATRIBUIR } from '@/app/api/lotes/atribuir/route'
import { PUT as POLITICA } from '@/app/api/productos/[id]/lotes/route'
import { PATCH as AJUSTAR } from '@/app/api/stock/[id]/route'
import { POST as CREAR_INVENTARIO } from '@/app/api/inventarios/route'
import { GET as LINEAS } from '@/app/api/inventarios/[id]/lineas/route'
import { POST as CONTAR } from '@/app/api/inventarios/[id]/conteo/route'
import { POST as REVISAR } from '@/app/api/inventarios/[id]/revision/route'
import { POST as APLICAR } from '@/app/api/inventarios/[id]/aplicar/route'

let fx: Fixture
let cookie: string

beforeEach(async () => {
  fx = await seedFixture()
  cookie = await sessionCookie(fx.admin)
})

afterAll(async () => {
  await prisma.$disconnect()
})

const VUELTAS = 5

async function habilitarLotes(politica = 'OPTIONAL') {
  await call(POLITICA, `/api/productos/${String(fx.productoA.id)}/lotes`, {
    method: 'PUT',
    cookie,
    params: { id: String(fx.productoA.id) },
    body: { lotTracking: politica, expirationTracking: 'NONE' },
  })
}

async function crearLote(code: string): Promise<number> {
  const res = await call<{ id: number }>(CREAR_LOTE, '/api/lotes', {
    method: 'POST',
    cookie,
    body: { productId: fx.productoA.id, code },
  })
  return res.body.id
}

async function atribuir(lotId: number, quantity: string) {
  return call(ATRIBUIR, '/api/lotes/atribuir', {
    method: 'POST',
    cookie,
    body: {
      productId: fx.productoA.id,
      reason: 'Prueba de concurrencia',
      lineas: [{ lotId, quantity }],
    },
  })
}

async function stockDelLote(lotId: number): Promise<string> {
  const fila = await prisma.branchLotStock.findFirst({
    where: { lotId, branchId: fx.branchA.id },
    select: { quantity: true },
  })
  return (fila?.quantity ?? '0').toString()
}

describe('un lote nunca queda en negativo', () => {
  it('dos ventas simultáneas de 2 sobre un lote que tiene 2', async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      fx = await seedFixture()
      cookie = await sessionCookie(fx.admin)
      await habilitarLotes()
      const chico = await crearLote('L-CHICO')
      const grande = await crearLote('L-GRANDE')
      await atribuir(chico, '2')
      await atribuir(grande, '8')

      const venta = () =>
        call(VENDER, '/api/sales', {
          method: 'POST',
          cookie,
          body: {
            items: [
              {
                productId: fx.productoA.id,
                quantity: '2',
                lots: [{ lotId: chico, quantity: '2' }],
              },
            ],
            paymentMethod: 'CASH',
          },
        })

      const [a, b] = await Promise.all([venta(), venta()])
      const exitosas = [a, b].filter((r) => r.status === 200 || r.status === 201)

      // La segunda tiene que rebotar: el lote sólo tenía dos.
      expect(exitosas).toHaveLength(1)
      expect(await stockDelLote(chico)).toBe('0')
      expect(await stockDelLote(grande)).toBe('8')
    }
  })
})

describe('no se atribuye más stock del que hay', () => {
  it('dos atribuciones simultáneas de 8 sobre un producto que tiene 10', async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      fx = await seedFixture()
      cookie = await sessionCookie(fx.admin)
      await habilitarLotes()
      const uno = await crearLote('L-1')
      const dos = await crearLote('L-2')

      const [a, b] = await Promise.all([atribuir(uno, '8'), atribuir(dos, '8')])
      const exitosas = [a, b].filter((r) => r.status === 200 || r.status === 201)

      expect(exitosas).toHaveLength(1)

      const total = await prisma.branchLotStock.aggregate({
        where: { branchId: fx.branchA.id, lot: { productId: fx.productoA.id } },
        _sum: { quantity: true },
      })
      // 16 sería la respuesta incorrecta, y es la que sale si la suma viaja en
      // la misma sentencia que el bloqueo.
      expect((total._sum.quantity ?? '0').toString()).toBe('8')
    }
  })
})

describe('venta y ajuste sobre el mismo lote', () => {
  it('el saldo del lote nunca queda negativo', async () => {
    for (let vuelta = 0; vuelta < VUELTAS; vuelta++) {
      fx = await seedFixture()
      cookie = await sessionCookie(fx.admin)
      await habilitarLotes()
      const lote = await crearLote('L-1')
      await atribuir(lote, '6')

      await Promise.all([
        call(VENDER, '/api/sales', {
          method: 'POST',
          cookie,
          body: {
            items: [
              { productId: fx.productoA.id, quantity: '5', lots: [{ lotId: lote, quantity: '5' }] },
            ],
            paymentMethod: 'CASH',
          },
        }),
        call(AJUSTAR, `/api/stock/${String(fx.productoA.id)}`, {
          method: 'PATCH',
          cookie,
          params: { id: String(fx.productoA.id) },
          body: { delta: '-5', type: 'BREAKAGE', reason: 'Se rompieron', lotId: lote },
        }),
      ])

      const saldo = await stockDelLote(lote)
      expect(Number(saldo)).toBeGreaterThanOrEqual(0)

      // Y el libro del lote tiene que explicar el saldo, sin huecos.
      const movimientos = await prisma.stockMovement.aggregate({
        where: { lotId: lote, branchId: fx.branchA.id },
        _sum: { quantity: true },
      })
      const atribuciones = await prisma.lotAssignment.aggregate({
        where: { lotId: lote, branchId: fx.branchA.id },
        _sum: { quantity: true },
      })
      const esperado =
        Number((movimientos._sum.quantity ?? 0).toString()) +
        Number((atribuciones._sum.quantity ?? 0).toString())
      expect(Number(saldo)).toBe(esperado)
    }
  })
})

describe('dos inventarios sobre el mismo producto', () => {
  it('la misma diferencia no se corrige dos veces', async () => {
    async function sesionContada(): Promise<number> {
      const s = await call<{ id: number }>(CREAR_INVENTARIO, '/api/inventarios', {
        method: 'POST',
        cookie,
        body: { scope: 'SELECTION', productIds: [fx.productoA.id], blindCount: true },
      })
      const l = await call<{ data: Array<{ id: number }> }>(
        LINEAS,
        `/api/inventarios/${String(s.body.id)}/lineas?pageSize=100`,
        { cookie, params: { id: String(s.body.id) } },
      )
      await call(CONTAR, `/api/inventarios/${String(s.body.id)}/conteo`, {
        method: 'POST',
        cookie,
        params: { id: String(s.body.id) },
        body: { lineas: l.body.data.map((x) => ({ lineId: x.id, countedQuantity: '9' })) },
      })
      await call(REVISAR, `/api/inventarios/${String(s.body.id)}/revision`, {
        method: 'POST',
        cookie,
        params: { id: String(s.body.id) },
      })
      return s.body.id
    }

    // Las dos cuentan 9 sobre 10: cada una ve una diferencia de -1. Si las dos
    // se aplicaran, el stock terminaria en 8 por una sola unidad que falta.
    const primera = await sesionContada()
    const segunda = await sesionContada()

    const aplicar = (id: number) =>
      call(APLICAR, `/api/inventarios/${String(id)}/aplicar`, {
        method: 'POST',
        cookie,
        params: { id: String(id) },
      })

    const [a, b] = await Promise.all([aplicar(primera), aplicar(segunda)])
    const exitosas = [a, b].filter((r) => r.status === 200)
    expect(exitosas).toHaveLength(1)

    const rechazada = [a, b].find((r) => r.status !== 200)
    expect(JSON.stringify(rechazada?.body)).toContain('COUNT_SUPERSEDED')

    const stock = await prisma.branchStock.findFirstOrThrow({
      where: { productId: fx.productoA.id, branchId: fx.branchA.id },
      select: { quantity: true },
    })
    expect(stock.quantity.toString()).toBe('9')
  })

  /**
   * La otra mitad de la política, y la que hace que no sea una prohibición.
   *
   * Corregir la partida A no cambia el stock de la partida B. Una sesión que
   * contó B sigue teniendo razón después de que otra corrigió A, así que
   * bloquearla sería un conflicto inventado: obligaría a recontar mercadería
   * que nadie tocó.
   *
   * Sin comparar por LOTE --sólo por producto-- este caso falla: la segunda
   * sesión se rechazaría con COUNT_SUPERSEDED y el estante quedaría sin
   * corregir. Es la prueba que sostiene el `IS NOT DISTINCT FROM` de
   * `conflictosDeInventario`.
   */
  it('dos inventarios sobre PARTIDAS distintas del mismo producto sí se aplican', async () => {
    await habilitarLotes('OPTIONAL')
    const loteA = await crearLote('CC-A')
    const loteB = await crearLote('CC-B')
    // 10 unidades del producto: 4 en A, 4 en B, 2 sin atribuir.
    await atribuir(loteA, '4')
    await atribuir(loteB, '4')

    /** Cuenta UNA sola línea --la del lote pedido-- y deja la sesión en revisión. */
    async function sesionDeUnLote(lotId: number, contado: string): Promise<number> {
      const s = await call<{ id: number }>(CREAR_INVENTARIO, '/api/inventarios', {
        method: 'POST',
        cookie,
        body: { scope: 'SELECTION', productIds: [fx.productoA.id], blindCount: true },
      })
      const l = await call<{ data: Array<{ id: number; lotId: number | null }> }>(
        LINEAS,
        `/api/inventarios/${String(s.body.id)}/lineas?pageSize=100`,
        { cookie, params: { id: String(s.body.id) } },
      )
      // Todas las líneas se cuentan --si no, la sesión queda incompleta-- pero
      // sólo la del lote pedido tiene diferencia.
      const lineas = l.body.data.map((x) => ({
        lineId: x.id,
        countedQuantity: x.lotId === lotId ? contado : x.lotId === null ? '2' : '4',
      }))
      await call(CONTAR, `/api/inventarios/${String(s.body.id)}/conteo`, {
        method: 'POST',
        cookie,
        params: { id: String(s.body.id) },
        body: { lineas },
      })
      await call(REVISAR, `/api/inventarios/${String(s.body.id)}/revision`, {
        method: 'POST',
        cookie,
        params: { id: String(s.body.id) },
      })
      return s.body.id
    }

    // Una encuentra 3 donde había 4 en A; la otra, 3 donde había 4 en B.
    const deA = await sesionDeUnLote(loteA, '3')
    const deB = await sesionDeUnLote(loteB, '3')

    const aplicar = (id: number) =>
      call(APLICAR, `/api/inventarios/${String(id)}/aplicar`, {
        method: 'POST',
        cookie,
        params: { id: String(id) },
      })

    const a = await aplicar(deA)
    const b = await aplicar(deB)

    expect([a.status, b.status], 'las dos correcciones son reales y distintas').toEqual([200, 200])
    expect(await stockDelLote(loteA)).toBe('3')
    expect(await stockDelLote(loteB)).toBe('3')

    // 4+4+2 menos una unidad de cada partida.
    const stock = await prisma.branchStock.findFirstOrThrow({
      where: { productId: fx.productoA.id, branchId: fx.branchA.id },
      select: { quantity: true },
    })
    expect(stock.quantity.toString()).toBe('8')
  })
})
