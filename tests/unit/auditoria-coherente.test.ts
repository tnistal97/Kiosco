/**
 * La bitacora se puede FILTRAR por todo lo que escribe.
 *
 * Un evento que se registra pero que la pantalla no ofrece filtrar es un
 * evento que existe y no se puede encontrar. Paso con las compras: la Fase 3C
 * auditaba `PurchaseOrder`, `PurchaseReceipt` y `PurchaseReceiptItem`, y
 * ninguno de los tres figuraba en la lista blanca del filtro.
 *
 * Esta prueba es estatica --lee el codigo-- porque el problema tambien lo era:
 * las dos listas vivian en archivos distintos y nada las ataba.
 *
 * Ver docs/PERMISSIONS_MATRIX.md y src/modules/audit/schemas.ts.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { ACCIONES_AUDITADAS, TABLAS_AUDITADAS } from '@/modules/audit/schemas'

const RAIZ = process.cwd()

function archivosDe(...carpetas: string[]): string[] {
  const salida: string[] = []
  const recorrer = (dir: string) => {
    for (const entrada of readdirSync(dir)) {
      const completo = path.join(dir, entrada)
      if (statSync(completo).isDirectory()) recorrer(completo)
      else if (/\.tsx?$/.test(entrada)) salida.push(completo)
    }
  }
  for (const c of carpetas) recorrer(path.join(RAIZ, c))
  return salida
}

/** Lo que se le pasa a `audit()` en todo `src/`, extraido del codigo. */
function extraer(campo: 'table' | 'action'): Set<string> {
  const encontrados = new Set<string>()
  const patron = new RegExp(`\\b${campo}:\\s*'([^']+)'`, 'g')

  for (const archivo of archivosDe('src')) {
    const contenido = readFileSync(archivo, 'utf8')
    for (const m of contenido.matchAll(patron)) {
      if (m[1] !== undefined) encontrados.add(m[1])
    }
  }
  return encontrados
}

describe('Todo lo que se audita se puede buscar', () => {
  it('cada tabla que emite eventos figura en el filtro', () => {
    const tablas = extraer('table')

    // La busqueda tiene que encontrar algo: una expresion que no case con nada
    // pasaria sin comprobar nada.
    expect(tablas.size, 'no se encontro ninguna llamada a audit()').toBeGreaterThan(8)

    const faltantes = [...tablas].filter((t) => !TABLAS_AUDITADAS.includes(t as never)).sort()

    expect(
      faltantes,
      'estas tablas se auditan pero no se pueden filtrar en la pantalla de bitacora: ' +
        'agregalas a TABLAS_AUDITADAS o el evento queda escrito y perdido',
    ).toEqual([])
  })

  it('cada accion que se registra figura en el filtro', () => {
    const acciones = extraer('action')

    expect(acciones.size, 'no se encontro ninguna llamada a audit()').toBeGreaterThan(5)

    const faltantes = [...acciones].filter((a) => !ACCIONES_AUDITADAS.includes(a as never)).sort()

    expect(faltantes, 'estas acciones se registran pero no se pueden filtrar').toEqual([])
  })

  it('las tres tablas de compras estan, que es lo que faltaba', () => {
    for (const t of ['PurchaseOrder', 'PurchaseReceipt', 'PurchaseReceiptItem'] as const) {
      expect(TABLAS_AUDITADAS.includes(t), `falta ${t}`).toBe(true)
    }
  })

  it('la bitacora NO duplica el libro de inventario ni el historial de costos', () => {
    // Cada tabla tiene una responsabilidad distinta y no hay que confundirlas:
    //
    //   StockMovement        la contabilidad fisica de unidades
    //   ProductCostHistory   como se llego al costo actual
    //   AuditLog             QUIEN hizo la operacion
    //
    // Copiar las dos primeras dentro de la tercera convertiria una venta de
    // quince productos en dieciseis entradas que dicen lo mismo, y la bitacora
    // dejaria de servir para lo unico que sirve.
    const ledger = readFileSync(path.join(RAIZ, 'src/modules/inventory/service.ts'), 'utf8')

    // El servicio de inventario audita SOLO cuando quien lo llama lo pide
    // --los ajustes-- y no en cada movimiento.
    expect(ledger).toContain('entrada.audit')
    expect(
      /audit\?: \{ origin: string \} \| null/.test(ledger),
      'la auditoria del libro dejo de ser opcional',
    ).toBe(true)
  })
})
