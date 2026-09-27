/**
 * La plantilla que se descarga desde Productos → Importar.
 *
 * Se lee con el MISMO lector de la aplicacion y tiene que mapear sola sus ocho
 * columnas y dar tres productos validos. Si alguien la regenera mal, o cambia
 * los sinonimos del mapeo y deja de reconocer los encabezados de la propia
 * plantilla, esto falla antes que el primer comercio.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { leerPlanilla } from '@/modules/importacion/planilla'
import {
  CAMPOS,
  datosAEnviar,
  detectarEncabezado,
  encabezadosDe,
  sugerirMapeo,
} from '@/modules/importacion/columnas'
import {
  leerCantidad,
  leerCategoria,
  leerCodigo,
  leerCosto,
  leerNombre,
  leerPrecio,
  leerUnidad,
} from '@/modules/importacion/valores'

const ARCHIVO = path.join(process.cwd(), 'public', 'productos-ejemplo.xlsx')

describe('productos-ejemplo.xlsx', () => {
  it('se lee, mapea sus ocho columnas solas y trae tres productos validos', async () => {
    const planilla = await leerPlanilla(
      'productos-ejemplo.xlsx',
      new Uint8Array(readFileSync(ARCHIVO)),
    )
    expect(planilla.tipo).toBe('xlsx')
    expect(planilla.hoja).toBe('Productos')

    const encabezado = detectarEncabezado(planilla.filas)
    const mapeo = sugerirMapeo(encabezadosDe(planilla.filas, encabezado))
    for (const campo of CAMPOS) expect(mapeo[campo], campo).not.toBeNull()

    const { campos, filas } = datosAEnviar(planilla.filas, encabezado, mapeo)
    expect(filas).toHaveLength(3)

    const i = (c: (typeof CAMPOS)[number]) => campos.indexOf(c)
    for (const fila of filas) {
      const v = (c: (typeof CAMPOS)[number]) => fila.v[i(c)] ?? ''
      const unidad = leerUnidad(v('unidad'))
      expect(unidad.ok).toBe(true)
      const u = unidad.ok ? (unidad.valor ?? 'UNIT') : 'UNIT'
      for (const lectura of [
        leerCodigo(v('codigo')),
        leerNombre(v('nombre')),
        leerCategoria(v('categoria')),
        leerPrecio(v('precio')),
        leerCosto(v('costo')),
        leerCantidad(v('stock'), u, 'Stock'),
        leerCantidad(v('stockMinimo'), u, 'Stock mínimo'),
      ]) {
        expect(lectura.ok, JSON.stringify(lectura)).toBe(true)
      }
    }
  })

  it('no trae datos reales: los codigos son de ejemplo', async () => {
    const planilla = await leerPlanilla(
      'productos-ejemplo.xlsx',
      new Uint8Array(readFileSync(ARCHIVO)),
    )
    const codigos = planilla.filas.slice(1).map((f) => f.celdas[0])
    expect(codigos).toEqual(['EJEMPLO-001', 'EJEMPLO-002', 'EJEMPLO-003'])
  })
})
