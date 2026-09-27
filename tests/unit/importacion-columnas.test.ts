/**
 * El mapeo automatico de columnas y la fila de encabezados.
 */

import { describe, it, expect } from 'vitest'
import {
  datosAEnviar,
  detectarEncabezado,
  encabezadosDe,
  letraDeColumna,
  mapeoVacio,
  normalizarEncabezado,
  sugerirMapeo,
} from '@/modules/importacion/columnas'
import type { FilaDePlanilla } from '@/modules/importacion/planilla'

describe('Mapeo automatico', () => {
  it('los nombres del pedido, con y sin acentos', () => {
    const m = sugerirMapeo([
      'código',
      'descripción',
      'categoría',
      'precio_venta',
      'costo',
      'cantidad',
      'stock minimo',
      'unidad',
    ])
    expect(m).toEqual({
      codigo: 0,
      nombre: 1,
      categoria: 2,
      precio: 3,
      costo: 4,
      stock: 5,
      stockMinimo: 6,
      unidad: 7,
    })
  })

  it.each([
    [['EAN', 'Producto', 'Precio venta'], { codigo: 0, nombre: 1, precio: 2 }],
    [['barcode', 'nombre', 'precio'], { codigo: 0, nombre: 1, precio: 2 }],
    [['Cód. Barras', 'Artículo', 'P. Venta ($)'], { codigo: 0, nombre: 1, precio: 2 }],
    [['codigo', 'producto', 'precio', 'stock'], { codigo: 0, nombre: 1, precio: 2, stock: 3 }],
  ])('%j', (encabezados, esperado) => {
    const m = sugerirMapeo(encabezados)
    for (const [campo, columna] of Object.entries(esperado)) {
      expect(m[campo as keyof typeof m], campo).toBe(columna)
    }
  })

  it('"Stock mínimo" no se confunde con "Stock", en cualquier orden', () => {
    expect(sugerirMapeo(['Stock mínimo', 'Stock'])).toMatchObject({ stock: 1, stockMinimo: 0 })
    expect(sugerirMapeo(['Stock', 'Stock mínimo'])).toMatchObject({ stock: 0, stockMinimo: 1 })
  })

  it('con "Producto" y "Descripción", el nombre sale de "Producto"', () => {
    expect(sugerirMapeo(['Descripción', 'Producto']).nombre).toBe(1)
  })

  it('"Precio de costo" es costo y no precio', () => {
    expect(sugerirMapeo(['Precio de costo', 'Precio'])).toMatchObject({ precio: 1, costo: 0 })
  })

  it('"Precio c/IVA" es un precio si no hay otro mejor', () => {
    expect(sugerirMapeo(['Nombre', 'Precio c/IVA']).precio).toBe(1)
  })

  it('una columna desconocida no se mapea', () => {
    const m = sugerirMapeo(['Observaciones', 'Nombre'])
    expect(m.nombre).toBe(1)
    expect(Object.values(m).filter((v) => v === 0)).toEqual([])
  })

  it('normaliza puntuacion, acentos y espacios', () => {
    expect(normalizarEncabezado('  Cód. Barras ($) ')).toBe('cod barras')
    expect(normalizarEncabezado('PRECIO_VENTA')).toBe('precio venta')
  })
})

function fila(numero: number, ...celdas: string[]): FilaDePlanilla {
  return { numero, celdas }
}

describe('Fila de encabezados', () => {
  it('saltea el titulo de la lista', () => {
    const filas = [
      fila(1, 'Distribuidora Ejemplo - Lista de precios'),
      fila(3, 'Código', 'Descripción', 'Precio'),
      fila(4, '7790001', 'Yerba', '1500'),
    ]
    expect(detectarEncabezado(filas)).toBe(1)
    expect(encabezadosDe(filas, 1)).toEqual(['Código', 'Descripción', 'Precio'])
  })

  it('sin encabezados reconocibles, la primera fila', () => {
    expect(detectarEncabezado([fila(1, 'a', 'b'), fila(2, 'c', 'd')])).toBe(0)
  })

  it('sin fila de encabezados, las columnas se llaman como en Excel', () => {
    const filas = [fila(1, '7790001', 'Yerba', '1500')]
    expect(encabezadosDe(filas, -1)).toEqual(['Columna A', 'Columna B', 'Columna C'])
    expect(letraDeColumna(0)).toBe('A')
    expect(letraDeColumna(26)).toBe('AA')
  })
})

describe('Lo que viaja al servidor', () => {
  it('solo las columnas mapeadas, en el orden de los campos, y sin renglones vacios', () => {
    const filas: FilaDePlanilla[] = [
      fila(1, 'Precio', 'Nombre', 'Notas'),
      fila(2, '1500', 'Yerba', 'ojo'),
      fila(3, '', '', 'solo una nota'),
      { numero: 5, celdas: [{ n: '980.5' }, 'Azúcar'] },
    ]
    const mapeo = { ...mapeoVacio(), nombre: 1, precio: 0 }
    expect(datosAEnviar(filas, 0, mapeo)).toEqual({
      campos: ['nombre', 'precio'],
      filas: [
        { f: 2, v: ['Yerba', '1500'] },
        { f: 5, v: ['Azúcar', { n: '980.5' }] },
      ],
    })
  })
})
