/**
 * La politica de codigos de barras.
 *
 * Lo que se prueba no es el regex: es la DISTINCION que la Fase 5A.1 vino a
 * hacer posible. Un codigo que no existe y un codigo que no puede existir
 * llevan a caminos distintos --uno ofrece crear el producto y el otro pide
 * volver a leer-- y esa decision se toma con esta funcion.
 *
 * Y el caso que mas duele si se rompe: el cero inicial. `Number('0750123')` da
 * `750123`, y con eso el producto queda inalcanzable con su propia etiqueta.
 */

import { describe, it, expect } from 'vitest'
import {
  LARGO_MAXIMO_CODIGO,
  esCodigoValido,
  motivoDeCodigoInvalido,
  normalizarCodigo,
} from '@/modules/products/barcode'

describe('normalizarCodigo', () => {
  it('recorta los espacios de los extremos', () => {
    expect(normalizarCodigo('  7791234567890  ')).toBe('7791234567890')
  })

  it('NO toca las mayusculas', () => {
    // Para un lector, `AB-1` y `ab-1` son dos codigos distintos. Unificarlos
    // dejaria un producto que no se puede encontrar con su etiqueta.
    expect(normalizarCodigo('AB-1')).toBe('AB-1')
    expect(normalizarCodigo('ab-1')).toBe('ab-1')
  })

  it('conserva los ceros iniciales', () => {
    expect(normalizarCodigo('0000750123')).toBe('0000750123')
    expect(normalizarCodigo('007')).toBe('007')
  })

  it('nunca convierte a numero', () => {
    // La prueba que importa: si en algun momento alguien mete un `Number()`
    // aca, esto lo encuentra.
    const conCeros = '0750123'
    expect(normalizarCodigo(conCeros)).toBe(conCeros)
    expect(normalizarCodigo(conCeros)).not.toBe(String(Number(conCeros)))
  })
})

describe('motivoDeCodigoInvalido', () => {
  it('acepta los codigos reales', () => {
    for (const codigo of [
      '7791234567890', // EAN-13
      '012345678905', // UPC-A
      '0000750123', // interno con ceros
      'ABC-123', // Code 128 con guion
      '7', // uno solo: raro, pero la politica lo permite
    ]) {
      expect(motivoDeCodigoInvalido(codigo), codigo).toBeNull()
      expect(esCodigoValido(codigo), codigo).toBe(true)
    }
  })

  it('rechaza el vacio y lo que solo tiene espacios', () => {
    expect(motivoDeCodigoInvalido('')).toContain('vacío')
    expect(motivoDeCodigoInvalido('   ')).toContain('vacío')
  })

  it('nombra el espacio aparte: casi siempre es una lectura partida', () => {
    const motivo = motivoDeCodigoInvalido('77912 34567')
    expect(motivo).toContain('espacios')
    // El mensaje sugiere que hacer, no solo que esta mal.
    expect(motivo).toContain('partida')
  })

  it('rechaza los caracteres que ningun lector emite', () => {
    for (const codigo of ['779*12345', 'abc/def', '¿123?', '12.34']) {
      expect(motivoDeCodigoInvalido(codigo), codigo).not.toBeNull()
    }
  })

  it('rechaza lo mas largo que la columna', () => {
    expect(motivoDeCodigoInvalido('9'.repeat(LARGO_MAXIMO_CODIGO))).toBeNull()
    expect(motivoDeCodigoInvalido('9'.repeat(LARGO_MAXIMO_CODIGO + 1))).toContain(
      String(LARGO_MAXIMO_CODIGO),
    )
  })

  it('juzga el codigo YA RECORTADO', () => {
    // `  7791234567890  ` es valido: los espacios de los extremos los saca la
    // normalizacion. Los del medio no.
    expect(motivoDeCodigoInvalido('  7791234567890  ')).toBeNull()
    expect(motivoDeCodigoInvalido('779 1234567890')).not.toBeNull()
  })
})
