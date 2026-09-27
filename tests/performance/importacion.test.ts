/**
 * Importacion con volumen de verdad: 5.000 productos. Fase P0-B.
 *
 * El pedido: "un almacen con 2.000–5.000 productos debe poder quedar cargado
 * sin hacerlo manualmente". Esto arma una planilla sintetica de cinco mil
 * productos --sin un solo dato real: codigos del prefijo 99, que GS1 reserva
 * para cupones y nunca es un producto-- y la pasa por el camino entero:
 *
 *   leer el .xlsx → mapear → vista previa → importar → reimportar actualizando
 *
 * y mide cada paso. Los topes son generosos a proposito --corre en una
 * portatil--: lo que se busca es el orden de magnitud equivocado, no el
 * milisegundo. Los numeros se imprimen al final para el informe.
 *
 * Al terminar vacia la base de pruebas: los cinco mil productos no quedan.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { seedFixture, resetDb, prisma, descuadresDelLibro, type Fixture } from '../helpers/db'
import { call, sessionCookie } from '../helpers/http'
import { escribirXlsx, type CeldaAEscribir } from '../../scripts/lib/xlsx-escritor'
import { leerPlanilla } from '@/modules/importacion/planilla'
import {
  datosAEnviar,
  detectarEncabezado,
  encabezadosDe,
  sugerirMapeo,
} from '@/modules/importacion/columnas'
import type { VistaPrevia, ResultadoDeImportacion } from '@/modules/importacion/dto'
import type { VistaDePrecios } from '@/modules/products/precios-dto'
import { POST as VISTA_PREVIA } from '@/app/api/products/import/preview/route'
import { POST as IMPORTAR } from '@/app/api/products/import/route'
import { POST as PRECIOS_VISTA } from '@/app/api/products/prices/preview/route'
import { POST as PRECIOS } from '@/app/api/products/prices/route'
import { POST as PRECIOS_DESHACER } from '@/app/api/products/prices/undo/route'

const PRODUCTOS = 5_000

const MEDIDO: Array<{ que: string; valor: string }> = []

function anotar(que: string, valor: string): void {
  MEDIDO.push({ que, valor })
}

async function medir<T>(que: string, fn: () => Promise<T>, topeMs: number): Promise<T> {
  const arranque = performance.now()
  const resultado = await fn()
  const ms = Math.round(performance.now() - arranque)
  anotar(que, `${ms} ms`)
  expect(ms, `${que} tardó ${ms} ms`).toBeLessThan(topeMs)
  return resultado
}

/** Una planilla sintetica. Determinista: la misma cada vez. */
function planilla(ajustePrecio: number): Uint8Array {
  const filas: CeldaAEscribir[][] = [
    ['Código', 'Descripción', 'Rubro', 'Precio venta', 'Costo', 'Stock', 'Stock mínimo', 'Unidad'],
  ]
  for (let i = 1; i <= PRODUCTOS; i++) {
    const porKilo = i % 10 === 0
    const costo = 300 + ((i * 37) % 9_700)
    filas.push([
      `99${String(i).padStart(11, '0')}`,
      `Producto sintético ${String(i).padStart(5, '0')}`,
      `Rubro ${String((i % 25) + 1).padStart(2, '0')}`,
      Math.round(costo * 1.4 * ajustePrecio),
      costo,
      porKilo ? ((i % 50) + 1) / 4 : (i % 60) + 1,
      porKilo ? 1 : 5,
      porKilo ? 'kg' : 'unidad',
    ])
  }
  return escribirXlsx([{ nombre: 'Productos', filas }], { comprimir: true })
}

let fx: Fixture

beforeAll(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  // "Eliminar datos de prueba al terminar."
  await resetDb()
  await prisma.$disconnect()
})

async function subir(archivo: Uint8Array, modo: string, stock: string) {
  const leida = await medir(
    `leer .xlsx (${modo})`,
    () => leerPlanilla('volumen.xlsx', archivo),
    5_000,
  )
  // Aproximada: el monton de V8 con la planilla ya leida y todavia en uso. No
  // es la memoria de la lectura sola --hay todo lo demas de la prueba--, pero
  // alcanza para ver el orden de magnitud.
  anotar(
    `memoria con la planilla leída (${modo})`,
    `${String(Math.round(process.memoryUsage().heapUsed / 1024 / 1024))} MB de heap`,
  )

  const encabezado = detectarEncabezado(leida.filas)
  const mapeo = sugerirMapeo(encabezadosDe(leida.filas, encabezado))
  const datos = datosAEnviar(leida.filas, encabezado, mapeo)
  expect(datos.campos).toEqual([
    'codigo',
    'nombre',
    'categoria',
    'precio',
    'costo',
    'stock',
    'stockMinimo',
    'unidad',
  ])
  expect(datos.filas).toHaveLength(PRODUCTOS)

  const pedido = { archivo: 'volumen.xlsx', ...datos, modo, stock }
  anotar(`pedido JSON (${modo})`, `${Math.round(JSON.stringify(pedido).length / 1024)} KB`)

  const cookie = await sessionCookie(fx.admin)
  const vista = await medir(
    `vista previa (${modo})`,
    () =>
      call<VistaPrevia>(VISTA_PREVIA, '/api/products/import/preview', {
        method: 'POST',
        cookie,
        body: pedido,
      }),
    20_000,
  )
  expect(vista.status, vista.text.slice(0, 300)).toBe(200)
  anotar(`respuesta de la vista previa (${modo})`, `${Math.round(vista.text.length / 1024)} KB`)

  const res = await medir(
    `importar (${modo})`,
    () =>
      call<ResultadoDeImportacion>(IMPORTAR, '/api/products/import', {
        method: 'POST',
        cookie,
        body: { ...pedido, importacion: vista.body.importacion, huella: vista.body.huella },
      }),
    180_000,
  )
  expect(res.status, res.text.slice(0, 300)).toBe(200)
  return { vista: vista.body, resultado: res.body }
}

describe(`Importacion de ${PRODUCTOS} productos`, () => {
  it('alta de un catalogo entero, con stock inicial por el libro', async () => {
    const { vista, resultado } = await subir(planilla(1), 'nuevos-y-existentes', 'ajustar')

    expect(vista.totales).toMatchObject({ filas: PRODUCTOS, crear: PRODUCTOS, conErrores: 0 })
    expect(resultado).toMatchObject({ creados: PRODUCTOS, movimientosDeStock: PRODUCTOS })
    expect(resultado.categoriasCreadas).toHaveLength(25)

    const iniciales = await prisma.stockMovement.count({
      where: { type: 'INITIAL', reason: { startsWith: 'Stock inicial · Importación' } },
    })
    expect(iniciales).toBe(PRODUCTOS)
    const descuadres = await medir('comprobar el libro', () => descuadresDelLibro(), 30_000)
    expect(descuadres).toEqual([])
  })

  it('reimportar la misma lista con precios nuevos y stock recontado', async () => {
    const { vista, resultado } = await subir(planilla(1.1), 'nuevos-y-existentes', 'sumar')

    expect(vista.totales).toMatchObject({ existentes: PRODUCTOS, actualizar: PRODUCTOS })
    expect(resultado).toMatchObject({ actualizados: PRODUCTOS, creados: 0 })
    expect(await descuadresDelLibro()).toEqual([])
  })

  it('cambio masivo de precios sobre el catalogo importado, y deshacerlo', async () => {
    const cookie = await sessionCookie(fx.admin)
    const criterio = { operacion: 'aumentar', valor: '8', redondeo: 'termina-90' }

    async function cambiar(que: string, seleccion: Record<string, unknown>, cuantos: number) {
      const vista = await medir(
        `precios: vista previa (${que})`,
        () =>
          call<VistaDePrecios>(PRECIOS_VISTA, '/api/products/prices/preview', {
            method: 'POST',
            cookie,
            body: { seleccion, criterio },
          }),
        20_000,
      )
      expect(vista.status, vista.text.slice(0, 300)).toBe(200)
      expect(vista.body.resumen.cambian).toBe(cuantos)
      const res = await medir(
        `precios: aplicar (${que})`,
        () =>
          call<{ operacion: string; cambiados: number }>(PRECIOS, '/api/products/prices', {
            method: 'POST',
            cookie,
            body: { seleccion, criterio, huella: vista.body.huella },
          }),
        120_000,
      )
      expect(res.status, res.text.slice(0, 300)).toBe(200)
      expect(res.body.cambiados).toBe(cuantos)
      return res.body.operacion
    }

    const rubro = await prisma.category.findFirstOrThrow({ where: { name: 'Rubro 01' } })
    await cambiar('una categoría, 200', { categoriaId: rubro.id }, PRODUCTOS / 25)
    const todos = await cambiar(`todos, ${String(PRODUCTOS)}`, {}, PRODUCTOS + 3)

    const deshecho = await medir(
      `precios: deshacer (${String(PRODUCTOS)})`,
      () =>
        call<{ restaurados: number }>(PRECIOS_DESHACER, '/api/products/prices/undo', {
          method: 'POST',
          cookie,
          body: { operacion: todos },
        }),
      120_000,
    )
    expect(deshecho.status, deshecho.text.slice(0, 300)).toBe(200)
    expect(deshecho.body.restaurados).toBe(PRODUCTOS + 3)
  })

  it('deja los numeros por escrito', () => {
    const ancho = Math.max(...MEDIDO.map((m) => m.que.length))
    console.log(
      `\n  IMPORTACION DE ${String(PRODUCTOS)} PRODUCTOS\n\n` +
        MEDIDO.map((m) => `    ${m.que.padEnd(ancho)}  ${m.valor}`).join('\n') +
        '\n',
    )
    expect(MEDIDO.length).toBeGreaterThan(10)
  })
})
