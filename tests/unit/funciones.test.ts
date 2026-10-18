/**
 * Funciones opcionales de la instalacion (UX V5): lotes y compras.
 *
 * Un almacen de barrio no las usa y no tiene por que verlas. Se apagan sin
 * borrar nada: el dominio y la API siguen enteros, y se vuelven a prender con
 * `KIOSCO_FUNCIONES`. Lo que se prueba aca es que la llave haga exactamente
 * eso --ni mas ni menos--.
 */
import { describe, it, expect } from 'vitest'
import {
  funcionesHabilitadas,
  funcionHabilitada,
  permisosVisibles,
  rutaDeshabilitada,
} from '@/lib/funciones'

describe('funcionesHabilitadas', () => {
  it('sin la variable, modo almacen: ninguna', () => {
    expect(funcionesHabilitadas({})).toEqual([])
  })

  it('acepta comas, espacios y mayusculas', () => {
    expect(funcionesHabilitadas({ KIOSCO_FUNCIONES: 'Lotes, COMPRAS' })).toEqual([
      'lotes',
      'compras',
    ])
    expect(funcionesHabilitadas({ KIOSCO_FUNCIONES: 'compras' })).toEqual(['compras'])
  })

  it('"todas" prende todo, y una errata no rompe el arranque', () => {
    expect(funcionesHabilitadas({ KIOSCO_FUNCIONES: 'todas' })).toEqual(['lotes', 'compras'])
    expect(funcionesHabilitadas({ KIOSCO_FUNCIONES: 'lotez' })).toEqual([])
  })

  it('funcionHabilitada pregunta por una sola', () => {
    expect(funcionHabilitada('lotes', { KIOSCO_FUNCIONES: 'lotes' })).toBe(true)
    expect(funcionHabilitada('compras', { KIOSCO_FUNCIONES: 'lotes' })).toBe(false)
  })
})

describe('permisosVisibles', () => {
  const permisos = [
    'sales.create',
    'stock.view',
    'lots.view',
    'lots.manage',
    'purchases.view',
    'suppliers.view',
    'supplierAccounts.view',
    'purchaseReturns.view',
    'reports.purchases.view',
    'reports.sales.view',
  ]

  it('con todo apagado quita lotes y compras, y deja el resto igual', () => {
    expect(permisosVisibles(permisos, [])).toEqual([
      'sales.create',
      'stock.view',
      'reports.sales.view',
    ])
  })

  it('cada funcion prendida devuelve SOLO sus permisos', () => {
    expect(permisosVisibles(permisos, ['lotes'])).toContain('lots.view')
    expect(permisosVisibles(permisos, ['lotes'])).not.toContain('purchases.view')
    expect(permisosVisibles(permisos, ['compras'])).toContain('suppliers.view')
    expect(permisosVisibles(permisos, ['compras'])).not.toContain('lots.manage')
    expect(permisosVisibles(permisos, ['lotes', 'compras'])).toEqual(permisos)
  })
})

describe('rutaDeshabilitada', () => {
  it('lotes apagado: /stock/lotes y sus fichas llevan a /stock', () => {
    expect(rutaDeshabilitada('/stock/lotes', [])).toBe('/stock')
    expect(rutaDeshabilitada('/stock/lotes/12', [])).toBe('/stock')
    expect(rutaDeshabilitada('/stock/lotes', ['lotes'])).toBeNull()
  })

  it('compras apagado: ordenes, proveedores y devoluciones llevan al inicio', () => {
    for (const ruta of [
      '/compras',
      '/compras/nueva',
      '/compras/recepcion/3',
      '/proveedores',
      '/proveedores/5',
      '/devoluciones/2',
      '/comprobantes/proveedor/9',
    ]) {
      expect(rutaDeshabilitada(ruta, [])).toBe('/')
      expect(rutaDeshabilitada(ruta, ['compras'])).toBeNull()
    }
  })

  it('compara por segmento: /compras no atrapa /comprobantes ni /stock a /stock/movimientos', () => {
    expect(rutaDeshabilitada('/comprobantes/3', [])).toBeNull()
    expect(rutaDeshabilitada('/stock', [])).toBeNull()
    expect(rutaDeshabilitada('/stock/movimientos', [])).toBeNull()
    expect(rutaDeshabilitada('/venta', [])).toBeNull()
  })
})
