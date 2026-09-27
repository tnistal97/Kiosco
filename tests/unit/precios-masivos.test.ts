/**
 * La cuenta del cambio masivo de precios: operaciones y redondeos.
 *
 * La regla que importa: el redondeo va en la direccion del cambio. Un aumento
 * nunca queda por debajo de lo calculado; una baja nunca termina mas cara.
 */

import { describe, it, expect } from 'vitest'
import {
  calcularPrecio,
  describirCriterio,
  motivoDeCriterioInvalido,
  type CriterioDePrecio,
  type Operacion,
  type Redondeo,
} from '@/modules/products/precios'

function precio(
  actual: string,
  operacion: Operacion,
  valor: string,
  redondeo: Redondeo = 'ninguno',
  costo: string | null = null,
): string {
  const r = calcularPrecio(actual, costo, { operacion, valor, redondeo })
  return r.ok ? r.precio : `ERROR: ${r.motivo}`
}

describe('Operaciones', () => {
  it.each([
    ['1000.00', 'aumentar', '10.00', '1100.00'],
    ['1234.56', 'aumentar', '12.50', '1388.88'], // 1388,88 exactos: 1234,56 x 1,125
    ['999.99', 'aumentar', '0.01', '1000.09'], // 1000,089999 → medio hacia arriba
    ['1000.00', 'disminuir', '15.00', '850.00'],
    ['1000.00', 'sumar', '250.00', '1250.00'],
    ['1000.00', 'restar', '250.00', '750.00'],
    ['1000.00', 'fijar', '1999.90', '1999.90'],
  ] as const)('%s %s %s → %s', (actual, op, valor, esperado) => {
    expect(precio(actual, op, valor)).toBe(esperado)
  })

  it('costo mas un porcentaje, desde el costo de cuatro decimales', () => {
    expect(precio('1.00', 'costo-mas', '40.00', 'ninguno', '1000.0000')).toBe('1400.00')
    // $ 1.543,125 + 30 % = $ 2.006,0625 → al centavo.
    expect(precio('1.00', 'costo-mas', '30.00', 'ninguno', '1543.1250')).toBe('2006.06')
    expect(precio('1.00', 'costo-mas', '0.00', 'ninguno', '500.0000')).toBe('500.00')
  })

  it('sin costo cargado, "costo mas" no tiene precio y lo dice', () => {
    expect(precio('1000.00', 'costo-mas', '40.00')).toBe('ERROR: No tiene costo cargado.')
  })

  it('una resta que deja el precio en cero o menos no se aplica', () => {
    expect(precio('100.00', 'restar', '100.00')).toMatch(/cero o negativo/)
    expect(precio('100.00', 'restar', '150.00')).toMatch(/cero o negativo/)
  })
})

describe('Redondeo en la direccion del cambio', () => {
  it.each([
    // Subiendo: el siguiente valor que cumple, nunca menos de lo calculado.
    ['1000.00', 'aumentar', '12.34', 'entero', '1124.00'], // 1123,40 → 1124
    ['1000.00', 'aumentar', '12.34', 'termina-0', '1130.00'],
    ['1000.00', 'aumentar', '12.34', 'termina-50', '1150.00'],
    ['1000.00', 'aumentar', '12.34', 'termina-90', '1190.00'],
    ['1000.00', 'aumentar', '12.34', 'termina-99', '1199.00'],
    ['1234.00', 'aumentar', '10.00', 'termina-90', '1390.00'], // 1357,40 → 1390
    // Justo en el valor: queda.
    ['1000.00', 'aumentar', '9.00', 'termina-90', '1090.00'],
    // Bajando: el anterior, nunca mas que lo calculado.
    ['1290.00', 'disminuir', '5.00', 'termina-90', '1190.00'], // 1225,50 → 1190
    ['1000.00', 'disminuir', '12.34', 'entero', '876.00'], // 876,60 → 876
    ['1000.00', 'disminuir', '12.34', 'termina-50', '850.00'],
    ['1000.00', 'restar', '33.00', 'termina-0', '960.00'], // 967 → 960
  ] as const)('%s %s %s, %s → %s', (actual, op, valor, redondeo, esperado) => {
    expect(precio(actual, op, valor, redondeo)).toBe(esperado)
  })

  it('una baja nunca termina mas cara que antes por culpa del redondeo', () => {
    // 1010 - 1 % = 999,90. Redondeando "para arriba" a 99 daria 1099: mas caro
    // que antes. Para abajo da 999.
    expect(precio('1010.00', 'disminuir', '1.00', 'termina-99')).toBe('999.00')
  })

  it('un aumento nunca queda por debajo de lo calculado', () => {
    // 1000 + 0,5 % = 1005. Al entero mas cercano seria 1005; a 99 para abajo
    // seria 999, que es MENOS que antes. Para arriba: 1099.
    expect(precio('1000.00', 'aumentar', '0.50', 'termina-99')).toBe('1099.00')
  })

  it('costo mas un porcentaje redondea siempre para arriba: no se come el margen pedido', () => {
    expect(precio('5000.00', 'costo-mas', '40.00', 'termina-90', '1000.0000')).toBe('1490.00')
  })

  it('un precio chico que bajando no llega a la terminacion pedida, no se aplica', () => {
    expect(precio('45.00', 'disminuir', '10.00', 'termina-99')).toMatch(/cero o negativo/)
  })

  it('el precio fijo no se redondea: es el que se escribio', () => {
    expect(precio('1000.00', 'fijar', '1234.56', 'termina-90')).toBe('1234.56')
  })
})

describe('Criterio', () => {
  const c = (
    operacion: Operacion,
    valor: string,
    redondeo: Redondeo = 'ninguno',
  ): CriterioDePrecio => ({
    operacion,
    valor,
    redondeo,
  })

  it('se describe en castellano, igual en la pantalla y en la bitacora', () => {
    expect(describirCriterio(c('aumentar', '10.50', 'termina-90'))).toBe(
      'Aumento del 10,5 %, que termine en 90',
    )
    expect(describirCriterio(c('restar', '100.00'))).toMatch(/^Resta de \$\s?100,00$/)
    expect(describirCriterio(c('fijar', '1500.00', 'termina-90'))).toMatch(/^Precio fijo de/)
  })

  it('los valores sin sentido se rechazan con su motivo', () => {
    expect(motivoDeCriterioInvalido(c('aumentar', '0.00'))).toMatch(/mayor que cero/)
    expect(motivoDeCriterioInvalido(c('disminuir', '100.00'))).toMatch(/menor que el 100/)
    expect(motivoDeCriterioInvalido(c('aumentar', '1000.01'))).toMatch(/1000 %/)
    expect(motivoDeCriterioInvalido(c('costo-mas', '0.00'))).toBeNull()
    expect(motivoDeCriterioInvalido(c('sumar', '50.00'))).toBeNull()
  })
})
