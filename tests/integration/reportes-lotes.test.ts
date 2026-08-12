/**
 * Los tres reportes de la Fase 4D, con datos de verdad.
 *
 * Lo que se comprueba no es que respondan 200: es que SEPAREN. El punto entero
 * del reporte de mermas es que una diferencia de inventario no se llame
 * pérdida, y eso sólo se ve armando las dos cosas y mirando dónde cae cada una.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, hoyLocal, diaLocal, type Fixture } from '../helpers/db'
import { call, sessionCookie, errorDe } from '../helpers/http'

import { GET as MERMAS } from '@/app/api/reports/mermas/route'
import { GET as INVENTARIOS } from '@/app/api/reports/inventarios/route'
import { GET as VENCIMIENTOS } from '@/app/api/reports/vencimientos/route'
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
let hoy: string

interface Merma {
  renglones: Array<{ categoria: string; etiqueta: string; unidades: string; movimientos: number }>
  totalUnidades: string
  totalACostoActual: string | null
  productos: number
}

interface Inventarios {
  sesiones: Array<{
    number: string
    estado: string
    productosConDiferencia: number
    diferenciaPositiva: string
    diferenciaNegativa: string
    valorACostoActual: string | null
  }>
  aplicadas: number
}

interface Vencimientos {
  tramos: Array<{
    tramo: string
    lotes: number
    unidades: string
    valorACostoActual: string | null
  }>
  sinFecha: { lotes: number; unidades: string }
  detalle: Array<{ code: string; dias: number | null }>
}

beforeEach(async () => {
  fx = await seedFixture()
  cookie = await sessionCookie(fx.admin)
  // El dia del NEGOCIO, no el de UTC. Con `toISOString()` estas cuatro pruebas
  // fallaban todos los dias entre las nueve de la noche y la medianoche: pedian
  // el reporte de manana y no encontraban lo que acababan de cargar.
  hoy = hoyLocal()
})

afterAll(async () => {
  await prisma.$disconnect()
})

const rango = () => `desde=${hoy}&hasta=${hoy}`

/** El stock real del producto. Las cantidades salen de acá, no de constantes. */
async function stockDe(productId: number): Promise<string> {
  const fila = await prisma.branchStock.findFirstOrThrow({
    where: { productId, branchId: fx.branchA.id },
    select: { quantity: true },
  })
  return fila.quantity.toString()
}

async function ajustar(tipo: string, delta: string, lotId?: number) {
  return call(AJUSTAR, `/api/stock/${String(fx.productoA.id)}`, {
    method: 'PATCH',
    cookie,
    params: { id: String(fx.productoA.id) },
    body: { delta, type: tipo, reason: `Prueba de ${tipo}`, ...(lotId ? { lotId } : {}) },
  })
}

describe('Reporte de mermas', () => {
  it('separa pérdida, rotura y uso interno en renglones distintos', async () => {
    await ajustar('LOSS', '-3')
    await ajustar('BREAKAGE', '-2')
    await ajustar('INTERNAL_USE', '-1')

    const res = await call<Merma>(MERMAS, `/api/reports/mermas?${rango()}`, { cookie })
    expect(res.status).toBe(200)

    const de = (c: string) => res.body.renglones.find((r) => r.categoria === c)
    expect(de('LOSS')?.unidades).toBe('3.000')
    expect(de('BREAKAGE')?.unidades).toBe('2.000')
    expect(de('INTERNAL_USE')?.unidades).toBe('1.000')

    // Tres causas, tres renglones. Sumarlas en uno haría imposible preguntar
    // cuánto se rompió de verdad.
    expect(res.body.renglones).toHaveLength(3)
    expect(res.body.totalUnidades).toBe('6.000')
  })

  it('la diferencia de inventario NO se llama merma y NO suma al total', async () => {
    await ajustar('LOSS', '-3')

    // Un inventario que encuentra una unidad de menos.
    const s = await call<{ id: number }>(CREAR_INVENTARIO, '/api/inventarios', {
      method: 'POST',
      cookie,
      body: { scope: 'SELECTION', productIds: [fx.productoA.id], blindCount: true },
    })
    const l = await call<{ data: Array<{ id: number; snapshotQuantity: string }> }>(
      LINEAS,
      `/api/inventarios/${String(s.body.id)}/lineas?pageSize=100`,
      { cookie, params: { id: String(s.body.id) } },
    )
    const linea = l.body.data[0]
    if (!linea) throw new Error('el inventario no generó líneas')

    // DOS unidades de menos de lo que haya. El número exacto sale del stock
    // real y no de una constante: la fixture puede cambiar, y una prueba que
    // asume "hay 100" mide la fixture en vez del reporte.
    const quedan = Number(await stockDe(fx.productoA.id))
    await call(CONTAR, `/api/inventarios/${String(s.body.id)}/conteo`, {
      method: 'POST',
      cookie,
      params: { id: String(s.body.id) },
      body: { lineas: [{ lineId: linea.id, countedQuantity: String(quedan - 2) }] },
    })
    await call(REVISAR, `/api/inventarios/${String(s.body.id)}/revision`, {
      method: 'POST',
      cookie,
      params: { id: String(s.body.id) },
    })
    const aplicada = await call(APLICAR, `/api/inventarios/${String(s.body.id)}/aplicar`, {
      method: 'POST',
      cookie,
      params: { id: String(s.body.id) },
    })
    expect(aplicada.status).toBe(200)

    const res = await call<Merma>(MERMAS, `/api/reports/mermas?${rango()}`, { cookie })
    const dif = res.body.renglones.find((r) => r.categoria === 'INVENTORY_DIFF')

    expect(dif, 'la diferencia aparece').toBeDefined()
    expect(dif?.etiqueta).toBe('Diferencia de inventario')
    expect(dif?.unidades).toBe('2.000')

    // Y lo que importa: el total de mermas sigue siendo SÓLO la pérdida.
    expect(res.body.totalUnidades, 'la diferencia no suma al total de mermas').toBe('3.000')
  })

  it('una baja sobre una partida vencida se cuenta como "vencido retirado"', async () => {
    await call(POLITICA, `/api/productos/${String(fx.productoA.id)}/lotes`, {
      method: 'PUT',
      cookie,
      params: { id: String(fx.productoA.id) },
      body: { lotTracking: 'OPTIONAL', expirationTracking: 'OPTIONAL' },
    })
    const lote = await call<{ id: number }>(CREAR_LOTE, '/api/lotes', {
      method: 'POST',
      cookie,
      // Ayer: la partida ya estaba vencida cuando se cargó la baja.
      body: {
        productId: fx.productoA.id,
        code: 'VENC-1',
        expirationDate: diaLocal(-1),
      },
    })
    await call(ATRIBUIR, '/api/lotes/atribuir', {
      method: 'POST',
      cookie,
      body: {
        productId: fx.productoA.id,
        reason: 'Prueba',
        lineas: [{ lotId: lote.body.id, quantity: '10' }],
      },
    })

    await ajustar('LOSS', '-4', lote.body.id)
    // Y una pérdida SIN partida, que sigue siendo pérdida común.
    await ajustar('LOSS', '-1')

    const res = await call<Merma>(MERMAS, `/api/reports/mermas?${rango()}`, { cookie })
    const de = (c: string) => res.body.renglones.find((r) => r.categoria === c)

    expect(de('EXPIRED')?.unidades, 'la baja del lote vencido va aparte').toBe('4.000')
    expect(de('EXPIRED')?.etiqueta).toBe('Vencido retirado')
    expect(de('LOSS')?.unidades, 'la otra sigue siendo pérdida').toBe('1.000')
  })

  it('sin permiso de costos el valor llega nulo, no oculto en la pantalla', async () => {
    await ajustar('LOSS', '-3')

    const conCosto = await call<Merma>(MERMAS, `/api/reports/mermas?${rango()}`, { cookie })
    expect(conCosto.body.totalACostoActual).not.toBeNull()

    const supervisor = fx.porRol.supervisor
    if (!supervisor) throw new Error('falta el supervisor en la fixture')
    const otro = await sessionCookie(supervisor)
    const sinCosto = await call<Merma>(MERMAS, `/api/reports/mermas?${rango()}`, { cookie: otro })

    expect(sinCosto.status).toBe(200)
    expect(sinCosto.body.totalACostoActual, 'el importe no viaja sin el permiso').toBeNull()
  })

  it('el cajero no puede pedirlo', async () => {
    const cajero = await sessionCookie(fx.cajero)
    const res = await call(MERMAS, `/api/reports/mermas?${rango()}`, { cookie: cajero })
    expect(res.status).toBe(403)
    expect(errorDe(res).message).toContain('permiso')
  })
})

describe('Reporte de inventarios', () => {
  it('las diferencias positivas y negativas van SEPARADAS, no netas', async () => {
    // Dos productos: uno sobra 2, otro falta 2. Neteadas darían cero.
    const s = await call<{ id: number }>(CREAR_INVENTARIO, '/api/inventarios', {
      method: 'POST',
      cookie,
      body: {
        scope: 'SELECTION',
        productIds: [fx.productoA.id, fx.productoCaja.id],
        blindCount: true,
      },
    })
    const l = await call<{ data: Array<{ id: number; productId: number }> }>(
      LINEAS,
      `/api/inventarios/${String(s.body.id)}/lineas?pageSize=100`,
      { cookie, params: { id: String(s.body.id) } },
    )

    const deA = Number(await stockDe(fx.productoA.id))
    const deCaja = Number(await stockDe(fx.productoCaja.id))
    const lineas = l.body.data.map((x) => ({
      lineId: x.id,
      // Uno sobra 2 y el otro falta 2, sobre el stock que de verdad hay.
      countedQuantity: x.productId === fx.productoA.id ? String(deA + 2) : String(deCaja - 2),
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

    const res = await call<Inventarios>(INVENTARIOS, `/api/reports/inventarios?${rango()}`, {
      cookie,
    })
    expect(res.status).toBe(200)
    const sesion = res.body.sesiones[0]

    expect(sesion?.productosConDiferencia).toBe(2)
    expect(sesion?.diferenciaPositiva, 'lo que sobró, aparte').toBe('2.000')
    expect(sesion?.diferenciaNegativa, 'lo que faltó, aparte').toBe('-2.000')
  })

  it('cuenta las aplicadas y las que siguen abiertas', async () => {
    const s = await call<{ id: number }>(CREAR_INVENTARIO, '/api/inventarios', {
      method: 'POST',
      cookie,
      body: { scope: 'SELECTION', productIds: [fx.productoA.id], blindCount: true },
    })
    const res = await call<Inventarios>(INVENTARIOS, `/api/reports/inventarios?${rango()}`, {
      cookie,
    })

    expect(res.body.sesiones).toHaveLength(1)
    expect(res.body.aplicadas).toBe(0)
    expect(res.body.sesiones[0]?.number).toMatch(/^IF-/)
    expect(s.body.id).toBeGreaterThan(0)
  })
})

describe('Reporte de vencimientos', () => {
  it('separa vencido, 7 días, 30 días y SIN FECHA', async () => {
    await call(POLITICA, `/api/productos/${String(fx.productoA.id)}/lotes`, {
      method: 'PUT',
      cookie,
      params: { id: String(fx.productoA.id) },
      body: { lotTracking: 'OPTIONAL', expirationTracking: 'OPTIONAL' },
    })

    const dia = diaLocal

    // Las cuatro partidas SUMAN EXACTAMENTE el stock del producto: atribuir
    // más de lo que hay se rechaza --y con razón--, y una prueba que lo
    // intentara mediría el tope en vez del reporte.
    const total = Number(await stockDe(fx.productoA.id))
    expect(total, 'la fixture tiene stock para repartir').toBeGreaterThanOrEqual(4)
    const resto = total - 3
    const partidas = [
      { code: 'V-VENCIDA', expirationDate: dia(-2), cantidad: '1' },
      { code: 'V-SIETE', expirationDate: dia(3), cantidad: '1' },
      { code: 'V-TREINTA', expirationDate: dia(20), cantidad: '1' },
      { code: 'V-SINFECHA', expirationDate: null, cantidad: String(resto) },
    ]

    for (const p of partidas) {
      const creado = await call<{ id: number }>(CREAR_LOTE, '/api/lotes', {
        method: 'POST',
        cookie,
        body: {
          productId: fx.productoA.id,
          code: p.code,
          ...(p.expirationDate === null ? {} : { expirationDate: p.expirationDate }),
        },
      })
      await call(ATRIBUIR, '/api/lotes/atribuir', {
        method: 'POST',
        cookie,
        body: {
          productId: fx.productoA.id,
          reason: 'Prueba de vencimientos',
          lineas: [{ lotId: creado.body.id, quantity: p.cantidad }],
        },
      })
    }

    const res = await call<Vencimientos>(VENCIMIENTOS, '/api/reports/vencimientos', { cookie })
    expect(res.status).toBe(200)

    const tramo = (t: string) => res.body.tramos.find((x) => x.tramo === t)
    expect(tramo('VENCIDO')?.unidades).toBe('1.000')
    expect(tramo('SIETE')?.unidades).toBe('1.000')
    expect(tramo('TREINTA')?.unidades).toBe('1.000')

    // Sin fecha va APARTE y no dentro de "vence lejos": una partida sin
    // vencimiento no es una que vence tarde, es una sobre la que no hay nada
    // que controlar.
    expect(res.body.sinFecha.lotes).toBe(1)
    expect(res.body.sinFecha.unidades).toBe(`${String(resto)}.000`)

    // El detalle viene ordenado por fecha: lo más urgente primero.
    expect(res.body.detalle[0]?.code).toBe('V-VENCIDA')
    expect(res.body.detalle[0]?.dias).toBeLessThan(0)
  })

  it('el valor va etiquetado como costo actual, y sólo con permiso', async () => {
    await call(POLITICA, `/api/productos/${String(fx.productoA.id)}/lotes`, {
      method: 'PUT',
      cookie,
      params: { id: String(fx.productoA.id) },
      body: { lotTracking: 'OPTIONAL', expirationTracking: 'OPTIONAL' },
    })
    const creado = await call<{ id: number }>(CREAR_LOTE, '/api/lotes', {
      method: 'POST',
      cookie,
      body: {
        productId: fx.productoA.id,
        code: 'V-COSTO',
        expirationDate: diaLocal(-1),
      },
    })
    await call(ATRIBUIR, '/api/lotes/atribuir', {
      method: 'POST',
      cookie,
      body: {
        productId: fx.productoA.id,
        reason: 'Prueba',
        lineas: [{ lotId: creado.body.id, quantity: '5' }],
      },
    })

    const res = await call<Vencimientos>(VENCIMIENTOS, '/api/reports/vencimientos', { cookie })
    const vencido = res.body.tramos.find((t) => t.tramo === 'VENCIDO')
    expect(vencido?.valorACostoActual).not.toBeNull()

    const repositor = fx.porRol.repositor
    if (!repositor) throw new Error('falta el repositor en la fixture')
    const otro = await sessionCookie(repositor)
    const sinCosto = await call<Vencimientos>(VENCIMIENTOS, '/api/reports/vencimientos', {
      cookie: otro,
    })

    expect(sinCosto.status, 'el repositor SÍ ve qué se vence').toBe(200)
    expect(
      sinCosto.body.tramos.find((t) => t.tramo === 'VENCIDO')?.valorACostoActual,
      'pero no lo que vale',
    ).toBeNull()
  })
})
