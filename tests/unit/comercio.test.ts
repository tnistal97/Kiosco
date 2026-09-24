/**
 * El nombre del comercio, leido al atender (P0-A).
 *
 * Salia de `NEXT_PUBLIC_COMMERCE_NAME` en paginas de cliente, que Next congela
 * al construir: cambiarlo pedia recompilar. Ahora lo lee el servidor en cada
 * peticion desde `COMMERCE_NAME`.
 */

import { describe, it, expect } from 'vitest'
import { NOMBRE_MAX, NOMBRE_POR_DEFECTO, nombreDelComercio } from '@/server/comercio'

describe('nombreDelComercio', () => {
  it('sin configurar, el nombre generico', () => {
    expect(nombreDelComercio({})).toBe(NOMBRE_POR_DEFECTO)
  })

  it('COMMERCE_NAME manda', () => {
    expect(
      nombreDelComercio({
        COMMERCE_NAME: 'Almacén Don Pepe',
        NEXT_PUBLIC_COMMERCE_NAME: 'Otro nombre',
      }),
    ).toBe('Almacén Don Pepe')
  })

  it('la variable vieja sirve de respaldo, para no dejar sin nombre a quien ya la tiene', () => {
    expect(nombreDelComercio({ NEXT_PUBLIC_COMMERCE_NAME: 'Kiosco Norte' })).toBe('Kiosco Norte')
  })

  it('limpia los espacios de sobra', () => {
    expect(nombreDelComercio({ COMMERCE_NAME: '   Almacén    Don   Pepe  ' })).toBe(
      'Almacén Don Pepe',
    )
  })

  it('vacio o solo espacios cuenta como no configurado', () => {
    expect(nombreDelComercio({ COMMERCE_NAME: '   ' })).toBe(NOMBRE_POR_DEFECTO)
  })

  it(`no pasa de ${String(NOMBRE_MAX)} caracteres`, () => {
    const largo = nombreDelComercio({ COMMERCE_NAME: 'x'.repeat(200) })
    expect(largo.length).toBe(NOMBRE_MAX)
  })

  it('se lee en cada llamada: cambiar el entorno cambia el nombre sin reiniciar el modulo', () => {
    const entorno: Record<string, string | undefined> = { COMMERCE_NAME: 'Primero' }
    expect(nombreDelComercio(entorno)).toBe('Primero')
    entorno.COMMERCE_NAME = 'Segundo'
    expect(nombreDelComercio(entorno)).toBe('Segundo')
  })
})
