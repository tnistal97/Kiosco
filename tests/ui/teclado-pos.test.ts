/**
 * La gramatica de teclado del punto de venta, tecla por tecla.
 *
 * Es una funcion pura: no hace falta montar la pantalla para comprobar que
 * ↑ nunca suba la cantidad, que Enter con el campo vacio cobre, y que Supr
 * solo quite con una linea elegida.
 */

import { describe, it, expect } from 'vitest'
import {
  accionDeTecla,
  modoDelCampo,
  moverSeleccion,
  seleccionTrasQuitar,
  type ContextoDelPos,
} from '@/components/venta/teclado'

const VACIO: ContextoDelPos = {
  texto: '',
  hayLineas: false,
  haySeleccion: false,
  hayResultados: false,
  hayAviso: false,
}

describe('Que es lo que hay escrito', () => {
  it('nada, un codigo o una busqueda', () => {
    expect(modoDelCampo('')).toBe('vacio')
    expect(modoDelCampo('   ')).toBe('vacio')
    expect(modoDelCampo('7790001000011')).toBe('codigo')
    expect(modoDelCampo('yerba')).toBe('busqueda')
    // Una letra entre digitos ya no es un codigo de barras.
    expect(modoDelCampo('77900a')).toBe('busqueda')
  })
})

describe('Enter', () => {
  it('con digitos busca el codigo', () => {
    expect(accionDeTecla('Enter', { ...VACIO, texto: '7790001000011' })).toBe('buscar-codigo')
  })

  it('con letras agrega el resultado elegido, si hay', () => {
    expect(accionDeTecla('Enter', { ...VACIO, texto: 'yer', hayResultados: true })).toBe(
      'agregar-resultado',
    )
    expect(accionDeTecla('Enter', { ...VACIO, texto: 'zzz', hayResultados: false })).toBe('nada')
  })

  it('con el campo vacio abre el cobro, solo si hay ticket', () => {
    expect(accionDeTecla('Enter', { ...VACIO, hayLineas: true })).toBe('cobrar')
    expect(accionDeTecla('Enter', VACIO)).toBe('nada')
  })
})

describe('Flechas', () => {
  it('arriba y abajo recorren los resultados mientras se busca', () => {
    const ctx = { ...VACIO, texto: 'yer', hayResultados: true }
    expect(accionDeTecla('ArrowDown', ctx)).toBe('resultado-siguiente')
    expect(accionDeTecla('ArrowUp', ctx)).toBe('resultado-anterior')
  })

  it('arriba y abajo recorren el ticket con el campo vacio', () => {
    const ctx = { ...VACIO, hayLineas: true }
    expect(accionDeTecla('ArrowDown', ctx)).toBe('linea-siguiente')
    expect(accionDeTecla('ArrowUp', ctx)).toBe('linea-anterior')
  })

  it('arriba NUNCA cambia la cantidad', () => {
    const ctx = { ...VACIO, hayLineas: true, haySeleccion: true }
    expect(accionDeTecla('ArrowUp', ctx)).not.toBe('cantidad-mas')
    expect(accionDeTecla('ArrowDown', ctx)).not.toBe('cantidad-menos')
  })

  it('izquierda y derecha cambian la cantidad de la linea elegida', () => {
    const ctx = { ...VACIO, hayLineas: true, haySeleccion: true }
    expect(accionDeTecla('ArrowRight', ctx)).toBe('cantidad-mas')
    expect(accionDeTecla('ArrowLeft', ctx)).toBe('cantidad-menos')
    expect(accionDeTecla('+', ctx)).toBe('cantidad-mas')
    expect(accionDeTecla('-', ctx)).toBe('cantidad-menos')
  })

  it('sin linea elegida, izquierda y derecha no hacen nada', () => {
    const ctx = { ...VACIO, hayLineas: true }
    expect(accionDeTecla('ArrowRight', ctx)).toBe('nada')
    expect(accionDeTecla('ArrowLeft', ctx)).toBe('nada')
  })

  it('mientras se escribe un codigo, las flechas mueven el cursor', () => {
    const ctx = { ...VACIO, texto: '779', hayLineas: true, haySeleccion: true }
    expect(accionDeTecla('ArrowRight', ctx)).toBe('nada')
    expect(accionDeTecla('ArrowUp', ctx)).toBe('nada')
    expect(accionDeTecla('Delete', ctx)).toBe('nada')
  })
})

describe('Supr y Escape', () => {
  it('Supr quita la linea elegida, y solo esa', () => {
    expect(accionDeTecla('Delete', { ...VACIO, hayLineas: true, haySeleccion: true })).toBe(
      'quitar-linea',
    )
    expect(accionDeTecla('Delete', { ...VACIO, hayLineas: true })).toBe('nada')
  })

  it('Escape vuelve un paso por vez', () => {
    expect(accionDeTecla('Escape', { ...VACIO, texto: 'yer' })).toBe('limpiar-campo')
    expect(accionDeTecla('Escape', { ...VACIO, haySeleccion: true })).toBe('deseleccionar')
    expect(accionDeTecla('Escape', { ...VACIO, hayAviso: true })).toBe('cerrar-aviso')
    expect(accionDeTecla('Escape', VACIO)).toBe('nada')
  })
})

describe('Donde queda la seleccion', () => {
  const IDS = [10, 20, 30]

  it('sin seleccion, abajo elige la primera y arriba la ultima', () => {
    expect(moverSeleccion(IDS, null, 1)).toBe(10)
    expect(moverSeleccion(IDS, null, -1)).toBe(30)
  })

  it('en los bordes no da la vuelta', () => {
    expect(moverSeleccion(IDS, 30, 1)).toBe(30)
    expect(moverSeleccion(IDS, 10, -1)).toBe(10)
    expect(moverSeleccion(IDS, 10, 1)).toBe(20)
  })

  it('sin lineas no hay seleccion', () => {
    expect(moverSeleccion([], null, 1)).toBeNull()
  })

  it('al quitar, pasa a la que ocupaba su lugar; si era la ultima, a la anterior', () => {
    expect(seleccionTrasQuitar(IDS, 20)).toBe(30)
    expect(seleccionTrasQuitar(IDS, 30)).toBe(20)
    expect(seleccionTrasQuitar(IDS, 10)).toBe(20)
    expect(seleccionTrasQuitar([10], 10)).toBeNull()
  })
})
