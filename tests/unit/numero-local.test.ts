/**
 * Numeros escritos por una persona.
 *
 * La tabla de esta suite ES el contrato del campo numerico: lo que alguien
 * puede tipear sin que el sistema le pida que lo escriba de otra manera.
 *
 * El caso que la motivo: "0" no entraba donde el sistema mostraba "0,00". Para
 * quien esta del otro lado del mostrador son el mismo numero, y la ultima
 * comprobacion de este archivo es exactamente esa: producen el MISMO Decimal.
 */

import { describe, it, expect } from 'vitest'
import {
  REGLAS_DE_CANTIDAD,
  REGLAS_DE_COSTO,
  REGLAS_DE_DINERO,
  filtrarTecleoNumerico,
  leerNumeroLocal,
  mensajeDeNumeroInvalido,
  textoLocalDeNumero,
} from '@/lib/numero-local'
import { aCentavos, montoDesdeTexto } from '@/lib/money'
import { aMilesimas, cantidadDesdeTexto } from '@/lib/cantidad'

/** Lo leido, o `null`. Para las tablas, donde el motivo no interesa. */
function leer(entrada: string, reglas = REGLAS_DE_DINERO): string | null {
  const r = leerNumeroLocal(entrada, reglas)
  return r.estado === 'ok' ? r.valor : null
}

describe('Lo que se puede tipear en un campo de dinero', () => {
  it.each([
    ['0', '0.00'],
    ['0,0', '0.00'],
    ['0,00', '0.00'],
    ['0.0', '0.00'],
    ['0.00', '0.00'],
    ['1', '1.00'],
    ['1,5', '1.50'],
    ['1,50', '1.50'],
    ['1.5', '1.50'],
    ['1.50', '1.50'],
    ['25', '25.00'],
    ['25,25', '25.25'],
    ['25.25', '25.25'],
    ['1500', '1500.00'],
    ['1500,25', '1500.25'],
    ['1500.25', '1500.25'],
    ['1.500,25', '1500.25'],
  ])('%s vale %s', (escrito, canonico) => {
    expect(leer(escrito)).toBe(canonico)
  })

  it('"1.500" en un importe son mil quinientos', () => {
    // La decision esta documentada en el modulo: un importe no tiene tres
    // decimales, asi que el punto solo con tres digitos detras es de miles.
    // Es lo que se teclea todos los dias en la caja.
    expect(leer('1.500')).toBe('1500.00')
    expect(leer('15.000')).toBe('15000.00')
    expect(leer('1.234.567')).toBe('1234567.00')
  })

  it('acepta lo que sale de pegar un importe formateado', () => {
    expect(leer('$ 1.500,00')).toBe('1500.00')
    expect(leer('1.500,00')).toBe('1500.00')
    expect(leer('1500,00')).toBe('1500.00')
    expect(leer('1500.00')).toBe('1500.00')
    expect(leer(' 1 500 ')).toBe('1500.00')
    // Formateado en ingles: el ultimo separador manda.
    expect(leer('1,500.25')).toBe('1500.25')
  })

  it('los ceros de relleno no rompen nada', () => {
    expect(leer('00')).toBe('0.00')
    expect(leer('000')).toBe('0.00')
    expect(leer('000,50')).toBe('0.50')
    expect(leer('007')).toBe('7.00')
  })

  it('tolera el separador colgando, que es como queda a mitad de escribir', () => {
    expect(leer('1,')).toBe('1.00')
    expect(leer('1.')).toBe('1.00')
    expect(leer(',50')).toBe('0.50')
  })

  it('el campo vacio no es un cero', () => {
    expect(leerNumeroLocal('', REGLAS_DE_DINERO)).toEqual({ estado: 'vacio' })
    expect(leerNumeroLocal('   ', REGLAS_DE_DINERO)).toEqual({ estado: 'vacio' })
    expect(leerNumeroLocal('$', REGLAS_DE_DINERO)).toEqual({ estado: 'vacio' })
  })

  it.each(['1,2,3', '1..2', 'abc', '--', ',', '.', '1-2', '1,2.3,4'])(
    '%s no es un numero',
    (basura) => {
      expect(leerNumeroLocal(basura, REGLAS_DE_DINERO).estado).toBe('invalido')
    },
  )

  it('mas de dos decimales se rechaza diciendo por que', () => {
    const r = leerNumeroLocal('10,555', REGLAS_DE_DINERO)
    expect(r).toEqual({ estado: 'invalido', motivo: 'demasiados-decimales' })
    expect(mensajeDeNumeroInvalido('demasiados-decimales')).toContain('dos decimales')
  })

  it('el signo lo decide el campo, no el parser', () => {
    expect(leer('-100')).toBe('-100.00')
    expect(leerNumeroLocal('-100', REGLAS_DE_CANTIDAD)).toEqual({
      estado: 'invalido',
      motivo: 'negativo',
    })
    // El menos tipografico de un copiar y pegar tambien.
    expect(leer('−100')).toBe('-100.00')
  })

  it('un cero no tiene signo', () => {
    expect(leer('-0')).toBe('0.00')
    expect(leer('-0,00')).toBe('0.00')
  })

  it('un numero absurdamente largo no llega a la aritmetica', () => {
    expect(leerNumeroLocal('9'.repeat(20), REGLAS_DE_DINERO)).toEqual({
      estado: 'invalido',
      motivo: 'fuera-de-rango',
    })
  })
})

describe('Lo que se puede tipear en un campo de cantidad', () => {
  it.each([
    ['0', '0.000'],
    ['0,0', '0.000'],
    ['0.00', '0.000'],
    ['1', '1.000'],
    ['1,5', '1.500'],
    ['1,50', '1.500'],
    ['1.5', '1.500'],
    ['15', '15.000'],
    ['0,425', '0.425'],
  ])('%s vale %s', (escrito, canonico) => {
    expect(leer(escrito, REGLAS_DE_CANTIDAD)).toBe(canonico)
  })

  it('"1.500" en una cantidad es uno y medio, no mil quinientos', () => {
    // Es lo que escribe una balanza y lo que se teclea para medio kilo. La
    // decision contraria a la del dinero, y esta documentada en el modulo.
    expect(leer('1.500', REGLAS_DE_CANTIDAD)).toBe('1.500')
    expect(aMilesimas(leer('1.500', REGLAS_DE_CANTIDAD) ?? '0')).toBe(1500)
  })

  it('con coma no hay ambiguedad y el punto vuelve a ser de miles', () => {
    expect(leer('1.500,250', REGLAS_DE_CANTIDAD)).toBe('1500.250')
  })

  it('cuatro decimales no existen en una cantidad', () => {
    expect(leerNumeroLocal('0,4251', REGLAS_DE_CANTIDAD).estado).toBe('invalido')
    expect(mensajeDeNumeroInvalido('demasiados-decimales', 'cantidad')).toContain('tres decimales')
  })

  it('el costo unitario si llega a cuatro, que es como se guarda', () => {
    expect(leer('1543,125', REGLAS_DE_COSTO)).toBe('1543.1250')
    expect(leer('1543,1255', REGLAS_DE_COSTO)).toBe('1543.1255')
  })
})

describe('Escribir es lo contrario de leer', () => {
  it('el importe se ve como en el resto de la aplicacion', () => {
    expect(textoLocalDeNumero('1500.25', { decimales: 2, decimalesMinimos: 2 })).toBe('1.500,25')
    expect(textoLocalDeNumero('0.00', { decimales: 2, decimalesMinimos: 2 })).toBe('0,00')
    expect(textoLocalDeNumero('1234567.00', { decimales: 2, decimalesMinimos: 2 })).toBe(
      '1.234.567,00',
    )
    expect(textoLocalDeNumero('-90.00', { decimales: 2, decimalesMinimos: 2 })).toBe('-90,00')
  })

  it('la cantidad se escribe sin punto de miles', () => {
    // Si lo llevara, el propio campo se leeria mal al reabrirlo: "1.500"
    // volveria a entrar como uno y medio.
    expect(textoLocalDeNumero('1500.000', { decimales: 0, miles: false })).toBe('1500')
    expect(textoLocalDeNumero('1.500', { decimales: 3, decimalesMinimos: 3, miles: false })).toBe(
      '1,500',
    )
    expect(textoLocalDeNumero('0.425', { decimales: 3, miles: false })).toBe('0,425')
  })

  it('lo que escribe el campo, el campo lo vuelve a leer igual', () => {
    for (const canonico of ['0.00', '1.50', '1500.25', '134600.00', '1234567.89']) {
      const escrito = textoLocalDeNumero(canonico, { decimales: 2, decimalesMinimos: 2 })
      expect(leer(escrito), escrito).toBe(canonico)
    }
    for (const canonico of ['0.000', '1.500', '1500.250', '0.425']) {
      const escrito = textoLocalDeNumero(canonico, {
        decimales: 3,
        decimalesMinimos: 3,
        miles: false,
      })
      expect(leer(escrito, REGLAS_DE_CANTIDAD), escrito).toBe(canonico)
    }
  })
})

describe('Mientras se escribe', () => {
  it('solo se filtra lo que no puede formar parte de un numero', () => {
    expect(filtrarTecleoNumerico('1a5')).toBe('15')
    expect(filtrarTecleoNumerico('$ 1.500,00')).toBe('1.500,00')
    expect(filtrarTecleoNumerico('1,')).toBe('1,')
    expect(filtrarTecleoNumerico('-5')).toBe('5')
    expect(filtrarTecleoNumerico('-5', { negativos: true })).toBe('-5')
    expect(filtrarTecleoNumerico('5-3', { negativos: true })).toBe('53')
  })
})

describe('El cero escrito a mano y el cero del sistema son el mismo numero', () => {
  it('"0" y "0,00" dan exactamente el mismo importe', () => {
    expect(montoDesdeTexto('0')).toBe(montoDesdeTexto('0,00'))
    expect(aCentavos(montoDesdeTexto('0') ?? '')).toBe(aCentavos(montoDesdeTexto('0,00') ?? ''))
    expect(aCentavos(montoDesdeTexto('0') ?? '')).toBe(0)
  })

  it('"5" y "5,00" tambien', () => {
    expect(montoDesdeTexto('5')).toBe(montoDesdeTexto('5,00'))
    expect(aCentavos(montoDesdeTexto('5') ?? '')).toBe(500)
  })

  it('y en cantidades, "1" y "1,000"', () => {
    expect(cantidadDesdeTexto('1')).toBe(cantidadDesdeTexto('1,000'))
    expect(aMilesimas(cantidadDesdeTexto('1') ?? '')).toBe(1000)
  })

  it('ningun campo obliga a escribir ",00" para aceptar un entero', () => {
    for (const entero of ['0', '1', '5', '25', '1500', '20000']) {
      expect(montoDesdeTexto(entero), entero).not.toBeNull()
      expect(cantidadDesdeTexto(entero), entero).not.toBeNull()
    }
  })
})
