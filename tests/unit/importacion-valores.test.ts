/**
 * Que significa cada celda. La tabla del pedido, fila por fila:
 *
 *   1500  1500,50  1.500  1.500,50  1500.50
 *
 * y la regla que la acompaña: "1.500" son mil quinientos PESOS, mil quinientas
 * UNIDADES y un kilo y medio. Dinero, cantidad y peso no se confunden.
 */

import { describe, it, expect } from 'vitest'
import {
  claveDeNombre,
  decimalDeExcel,
  leerCantidad,
  leerCategoria,
  leerCodigo,
  leerCosto,
  leerNombre,
  leerPrecio,
  leerUnidad,
  redondear,
  type Lectura,
} from '@/modules/importacion/valores'

function valor<T>(l: Lectura<T>): T | null {
  if (!l.ok) throw new Error(`se esperaba un valor y vino el error: ${l.error}`)
  return l.valor
}

function falla<T>(l: Lectura<T>): string {
  if (l.ok) throw new Error(`se esperaba un error y vino ${JSON.stringify(l.valor)}`)
  return l.error
}

function aviso<T>(l: Lectura<T>): string | undefined {
  return l.ok ? l.aviso : undefined
}

describe('Dinero: los cinco formatos del pedido', () => {
  it.each([
    ['1500', '1500.00'],
    ['1500,50', '1500.50'],
    ['1.500', '1500.00'],
    ['1.500,50', '1500.50'],
    ['1500.50', '1500.50'],
    ['$ 1.500,00', '1500.00'],
    ['  2.300  ', '2300.00'],
    ['1.234.567,8', '1234567.80'],
  ])('precio "%s" → %s', (texto, esperado) => {
    expect(valor(leerPrecio(texto))).toBe(esperado)
  })

  it('el costo lee igual, con cuatro decimales', () => {
    expect(valor(leerCosto('1.500'))).toBe('1500.0000')
    expect(valor(leerCosto('1543,125'))).toBe('1543.1250')
    expect(valor(leerCosto('1500.50'))).toBe('1500.5000')
  })

  it('vacio es "no viene", nunca cero', () => {
    expect(valor(leerPrecio(''))).toBeNull()
    expect(valor(leerPrecio('   '))).toBeNull()
    expect(valor(leerCosto(''))).toBeNull()
  })

  it('el costo admite cero; el precio no', () => {
    expect(valor(leerCosto('0'))).toBe('0.0000')
    expect(falla(leerPrecio('0'))).toMatch(/mayor que cero/)
    expect(falla(leerPrecio('0,00'))).toMatch(/mayor que cero/)
  })

  it('"1,500" se puede leer de dos formas y no se adivina', () => {
    expect(falla(leerPrecio('1,500'))).toMatch(/dos formas/)
    expect(falla(leerCosto('12,500,000'))).toMatch(/dos formas/)
  })

  it('negativos, tres decimales y basura se rechazan con su motivo', () => {
    expect(falla(leerPrecio('-100'))).toMatch(/^Precio: .*negativo/)
    expect(falla(leerPrecio('1500,555'))).toMatch(/dos decimales/)
    expect(falla(leerPrecio('mil'))).toMatch(/número válido/)
    expect(falla(leerCosto('1,23456'))).toMatch(/cuatro decimales/)
    expect(falla(leerPrecio('2000000000'))).toMatch(/demasiado grande/)
  })

  it('una celda NUMERICA de Excel no pasa por la lectura de texto', () => {
    // Guardado como numero, 1.234 es uno coma dos tres cuatro, no mil
    // doscientos: no hay separador de miles en un numero de la maquina.
    expect(valor(leerCosto({ n: '1.234' }))).toBe('1.2340')
    expect(valor(leerPrecio({ n: '1500.5' }))).toBe('1500.50')
    expect(valor(leerPrecio({ n: '3500' }))).toBe('3500.00')
  })

  it('una formula que dio 1815,605 se redondea al centavo y la fila lo avisa', () => {
    const l = leerPrecio({ n: '1815.6049999999998' })
    expect(valor(l)).toBe('1815.61')
    expect(aviso(l)).toMatch(/1815,605 se redondeó a 1815,61/)
  })

  it('el ruido del punto flotante no genera avisos', () => {
    const l = leerPrecio({ n: '1500.0000000000002' })
    expect(valor(l)).toBe('1500.00')
    expect(aviso(l)).toBeUndefined()
  })

  it('los errores de Excel se explican', () => {
    expect(falla(leerPrecio('#DIV/0!'))).toMatch(/error de Excel \(#DIV\/0!\)/)
    expect(falla(leerPrecio('#N/A'))).toMatch(/error de Excel/)
  })
})

describe('Cantidades: unidades y peso no leen igual', () => {
  it.each([
    ['UNIT', '1500', '1500.000'],
    ['UNIT', '1.500', '1500.000'],
    ['UNIT', '1500,00', '1500.000'],
    ['UNIT', '0', '0.000'],
    ['G', '1.500', '1500.000'],
    ['KG', '1,5', '1.500'],
    ['KG', '1.500,250', '1500.250'],
    ['KG', '0,425', '0.425'],
    ['L', '2,25', '2.250'],
  ] as const)('%s "%s" → %s', (unidad, texto, esperado) => {
    expect(valor(leerCantidad(texto, unidad, 'Stock'))).toBe(esperado)
  })

  it('"1.500" en kilos es kilo y medio, y la fila lo avisa', () => {
    const l = leerCantidad('1.500', 'KG', 'Stock')
    expect(valor(l)).toBe('1.500')
    expect(aviso(l)).toMatch(/se leyó como 1,5 kg/)
    expect(aviso(l)).toMatch(/Si eran 1500/)
  })

  it('media unidad no existe', () => {
    expect(falla(leerCantidad('1,5', 'UNIT', 'Stock'))).toMatch(/entero/)
    expect(falla(leerCantidad({ n: '2.5' }, 'UNIT', 'Stock'))).toMatch(/entero/)
  })

  it('negativos y demasiado grandes se rechazan', () => {
    expect(falla(leerCantidad('-3', 'UNIT', 'Stock'))).toMatch(/negativa/)
    expect(falla(leerCantidad('2.000.000', 'UNIT', 'Stock mínimo'))).toMatch(
      /^Stock mínimo: .*demasiado grande/,
    )
  })

  it('una celda numerica se toma con tres decimales', () => {
    expect(valor(leerCantidad({ n: '3.5' }, 'KG', 'Stock'))).toBe('3.500')
    const l = leerCantidad({ n: '0.12345' }, 'KG', 'Stock')
    expect(valor(l)).toBe('0.123')
    expect(aviso(l)).toMatch(/redondeó/)
  })
})

describe('Codigo de barras', () => {
  it('guardado como texto o como numero', () => {
    expect(valor(leerCodigo('7790001234567'))).toBe('7790001234567')
    expect(valor(leerCodigo(' 7790001234567 '))).toBe('7790001234567')
    expect(valor(leerCodigo({ n: '7790001234567' }))).toBe('7790001234567')
    expect(valor(leerCodigo({ n: '7.790001234567E12' }))).toBe('7790001234567')
    expect(valor(leerCodigo('ABC-123'))).toBe('ABC-123')
  })

  it('los tres estragos de Excel, explicados', () => {
    expect(falla(leerCodigo('7,79E+12'))).toMatch(/notación científica/)
    expect(falla(leerCodigo('7.790.001.234.567'))).toMatch(/separador de miles/)
    expect(falla(leerCodigo({ n: '12345678901234567' }))).toMatch(/15 cifras/)
  })

  it('con 12 cifras guardado como numero, avisa que pudo perder el cero', () => {
    const l = leerCodigo({ n: '123456789012' })
    expect(valor(l)).toBe('123456789012')
    expect(aviso(l)).toMatch(/empezaba con 0/)
  })

  it('la regla de siempre: sin espacios ni simbolos', () => {
    expect(falla(leerCodigo('779 000'))).toMatch(/espacios/)
    expect(falla(leerCodigo('779/000'))).toMatch(/caracteres/)
  })

  it('vacio es "sin codigo"', () => {
    expect(valor(leerCodigo(''))).toBeNull()
  })
})

describe('Textos y unidad', () => {
  it('el nombre sin espacios de mas ni saltos de linea', () => {
    expect(valor(leerNombre('  Queso\n cremoso  '))).toBe('Queso cremoso')
    expect(falla(leerNombre('x'.repeat(151)))).toMatch(/150 caracteres/)
    expect(valor(leerCategoria('Lácteos'))).toBe('Lácteos')
  })

  it('un nombre guardado como numero se lee como texto', () => {
    expect(valor(leerNombre({ n: '7' }))).toBe('7')
  })

  it('la clave de un nombre ignora mayusculas, acentos y espacios', () => {
    expect(claveDeNombre('  LÁCTEOS  ')).toBe(claveDeNombre('lacteos'))
    expect(claveDeNombre('Yerba  Playadito')).toBe('yerba playadito')
  })

  it.each([
    ['unidad', 'UNIT'],
    ['Unidades', 'UNIT'],
    ['u.', 'UNIT'],
    ['c/u', 'UNIT'],
    ['Kg', 'KG'],
    ['kilo', 'KG'],
    ['gr', 'G'],
    ['Lts.', 'L'],
    ['litro', 'L'],
    ['cc', 'ML'],
    ['ml', 'ML'],
  ] as const)('unidad "%s" → %s', (texto, esperado) => {
    expect(valor(leerUnidad(texto))).toBe(esperado)
  })

  it('una unidad desconocida dice cuales valen', () => {
    expect(falla(leerUnidad('bolsa'))).toMatch(/unidad, kg, g, l o ml/)
  })
})

describe('Aritmetica de apoyo', () => {
  it('quince cifras significativas, como las muestra Excel', () => {
    expect(decimalDeExcel('1815.6049999999998')).toBe('1815.605')
    expect(decimalDeExcel('7.790001234567E12')).toBe('7790001234567')
    expect(decimalDeExcel('1E-7')).toBe('0.0000001')
    expect(decimalDeExcel('-3.2')).toBe('-3.2')
    expect(decimalDeExcel('0')).toBe('0')
    expect(decimalDeExcel('abc')).toBeNull()
  })

  it('redondeo medio hacia arriba, por cadena', () => {
    expect(redondear('1815.605', 2)).toBe('1815.61')
    expect(redondear('1815.604', 2)).toBe('1815.60')
    expect(redondear('0.125', 2)).toBe('0.13')
    expect(redondear('9.995', 2)).toBe('10.00')
    expect(redondear('12.5', 0)).toBe('13')
    expect(redondear('1.2', 3)).toBe('1.2')
  })
})
