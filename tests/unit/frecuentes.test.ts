/**
 * Lo mas vendido en esta caja: el ranking local del punto de venta.
 *
 * Es aritmetica pura sobre lo que hay en `localStorage`; el hook solo la
 * envuelve. Lo que se prueba es el orden y la memoria acotada.
 */

import { describe, it, expect } from 'vitest'
import { ordenarFrecuentes, registrarUso } from '@/components/venta/useFrecuentes'

describe('El ranking de esta caja', () => {
  it('cada venta suma una, y el mas vendido va primero', () => {
    let usos = {}
    usos = registrarUso(usos, 7, 1)
    usos = registrarUso(usos, 3, 2)
    usos = registrarUso(usos, 3, 3)
    expect(ordenarFrecuentes(usos)).toEqual([3, 7])
  })

  it('a igual cantidad, el mas reciente primero', () => {
    let usos = {}
    usos = registrarUso(usos, 1, 100)
    usos = registrarUso(usos, 2, 200)
    expect(ordenarFrecuentes(usos)).toEqual([2, 1])
  })

  it('devuelve como mucho el tope de la grilla', () => {
    let usos = {}
    for (let i = 1; i <= 40; i++) usos = registrarUso(usos, i, i)
    expect(ordenarFrecuentes(usos)).toHaveLength(24)
  })

  it('olvida los menos usados cuando la memoria se pasa', () => {
    let usos = {}
    for (let i = 1; i <= 205; i++) usos = registrarUso(usos, i, i)
    // Los 200 mas recientes se quedan; los cinco primeros --una sola vez cada
    // uno y mas viejos-- se olvidan.
    expect(Object.keys(usos)).toHaveLength(200)
    expect(usos).not.toHaveProperty('1')
    expect(usos).toHaveProperty('205')
  })
})
