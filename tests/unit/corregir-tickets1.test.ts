/**
 * La cuenta de la correccion de Tickets 1. Ver scripts/lib/corregir-tickets1.ts.
 *
 * Lo que se prueba: se descuenta SOLO lo que la normalizacion sumo de mas, y
 * lo que paso despues (una venta, un ajuste) queda. Si la base no esta como la
 * vio la auditoria, no se corrige.
 */

import { describe, it, expect } from 'vitest'
import {
  cuentaDeStock,
  revisarManifiesto,
  type Correcciones,
  type CorreccionDeStock,
  type Movimiento,
} from '../../scripts/lib/corregir-tickets1'

const pure: CorreccionDeStock = {
  nombre: 'Puré de tomate Noel brick 520 g',
  ticket: '2(12) x 8147,90',
  unidadesTicket: 24,
  agregadoPorLaNormalizacion: 264,
  exceso: 264,
}

const inicial = (id: number, q: number): Movimiento => ({
  id,
  quantity: q,
  previousQuantity: 0,
  deLaNormalizacion: false,
})
const normalizacion = (id: number, q: number, previa: number): Movimiento => ({
  id,
  quantity: q,
  previousQuantity: previa,
  deLaNormalizacion: true,
})
const despues = (id: number, q: number, previa: number): Movimiento => ({
  id,
  quantity: q,
  previousQuantity: previa,
  deLaNormalizacion: false,
})

describe('cuentaDeStock', () => {
  it('sin nada posterior vuelve a las unidades del ticket', () => {
    const c = cuentaDeStock(pure, [inicial(1, 24), normalizacion(9, 264, 24)], 288)
    expect(c).toEqual({ base: 24, agregado: 264, posterior: 0, actual: 288, correcto: 24 })
  })

  it('conserva las ventas y los ajustes de despues de la normalizacion', () => {
    const c = cuentaDeStock(
      pure,
      [inicial(1, 24), normalizacion(9, 264, 24), despues(12, -10, 288), despues(15, 2, 278)],
      280,
    )
    expect(c.posterior).toBe(-8)
    expect(c.correcto).toBe(16)
  })

  it('el producto que recibio un bulto: suelto + bulto, menos el exceso', () => {
    const natura: CorreccionDeStock = {
      nombre: 'Aceitunas Natura girasol 5 L',
      ticket: '1(1) x 19999,00 y 2(4) x 79996,00',
      unidadesTicket: 9,
      agregadoPorLaNormalizacion: 32,
      exceso: 24,
    }
    const c = cuentaDeStock(natura, [inicial(1, 1), normalizacion(7, 32, 1)], 33)
    expect(c).toMatchObject({ base: 1, correcto: 9 })
  })

  it('no corrige si la normalizacion no sumo lo que dice el manifiesto', () => {
    expect(() => cuentaDeStock(pure, [inicial(1, 24), normalizacion(9, 240, 24)], 264)).toThrow(
      'la normalización sumó 240',
    )
    expect(() => cuentaDeStock(pure, [inicial(1, 288)], 288)).toThrow('no tiene movimientos')
  })

  it('no corrige si el libro no explica el stock', () => {
    expect(() => cuentaDeStock(pure, [inicial(1, 24), normalizacion(9, 264, 24)], 290)).toThrow(
      'el libro suma 288',
    )
  })

  it('no deja stock negativo: si se vendio mas de lo que entro, queda para revisar', () => {
    expect(() =>
      cuentaDeStock(pure, [inicial(1, 24), normalizacion(9, 264, 24), despues(12, -30, 288)], 258),
    ).toThrow('quedaría en -6')
  })
})

describe('revisarManifiesto', () => {
  const base: Correcciones = { marca: 'm', stock: [], codigos: [], descripciones: [], nombres: [] }

  it('solo corrige codigos mal copiados, y por uno valido', () => {
    expect(() =>
      revisarManifiesto({
        ...base,
        codigos: [{ nombre: 'Monster', actual: '7798422620045', corregido: '7798422620045' }],
      }),
    ).toThrow('es válido')
    expect(() =>
      revisarManifiesto({
        ...base,
        codigos: [{ nombre: 'Monster', actual: '7798427620045', corregido: '7798427620045' }],
      }),
    ).toThrow('no es válido')
    expect(() =>
      revisarManifiesto({
        ...base,
        codigos: [{ nombre: 'Monster', actual: '7798427620045', corregido: '7798422620045' }],
      }),
    ).not.toThrow()
  })

  it('dos nombres corregidos no pueden quedar iguales, ni con tildes distintas', () => {
    expect(() =>
      revisarManifiesto({
        ...base,
        nombres: [
          { actual: 'Aceitunas Natura girasol 5 L', corregido: 'Aceite de girasol Natura 5 L' },
          { actual: 'Otro', corregido: 'aceite de girasol natura 5 l' },
        ],
      }),
    ).toThrow('mismo nombre')
  })
})
