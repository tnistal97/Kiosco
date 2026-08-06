/**
 * Pruebas unitarias de la validacion de entrada.
 *
 * Cada caso corresponde a un valor que hoy llega hasta Prisma sin control.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  quantitySchema,
  amountSchema,
  idSchema,
  shortText,
  paymentMethodSchema,
  parseWith,
} from '@/server/http/validate'
import { AppError } from '@/server/http/errors'

function esValido(schema: z.ZodType<unknown>, valor: unknown): boolean {
  return schema.safeParse(valor).success
}

describe('Cantidades', () => {
  it('acepta enteros positivos', () => {
    expect(esValido(quantitySchema, 1)).toBe(true)
    expect(esValido(quantitySchema, 250)).toBe(true)
  })

  const rechazados: Array<[string, unknown]> = [
    ['cero', 0],
    ['negativo', -1],
    ['decimal', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['cadena numerica', '5'],
    ['cadena', 'dos'],
    ['null', null],
    ['undefined', undefined],
    ['objeto', {}],
    ['fuera de rango', 100_001],
  ]

  for (const [nombre, valor] of rechazados) {
    it(`rechaza ${nombre}`, () => {
      expect(esValido(quantitySchema, valor)).toBe(false)
    })
  }
})

describe('Importes', () => {
  it('acepta importes con dos decimales', () => {
    expect(esValido(amountSchema, 0)).toBe(true)
    expect(esValido(amountSchema, 12500)).toBe(true)
    expect(esValido(amountSchema, 1234.56)).toBe(true)
  })

  it('rechaza mas de dos decimales', () => {
    expect(esValido(amountSchema, 10.001)).toBe(false)
  })

  it('rechaza negativos, NaN e infinitos', () => {
    expect(esValido(amountSchema, -1)).toBe(false)
    expect(esValido(amountSchema, Number.NaN)).toBe(false)
    expect(esValido(amountSchema, Number.POSITIVE_INFINITY)).toBe(false)
  })
})

describe('Identificadores', () => {
  it('acepta enteros positivos, tambien como texto', () => {
    expect(idSchema.parse(7)).toBe(7)
    expect(idSchema.parse('7')).toBe(7)
  })

  it('rechaza cero, negativos, decimales y basura', () => {
    expect(esValido(idSchema, 0)).toBe(false)
    expect(esValido(idSchema, -3)).toBe(false)
    expect(esValido(idSchema, 1.5)).toBe(false)
    expect(esValido(idSchema, 'abc')).toBe(false)
    expect(esValido(idSchema, '')).toBe(false)
  })

  it('rechaza valores mayores que un entero de 32 bits', () => {
    expect(esValido(idSchema, 2_147_483_648)).toBe(false)
  })
})

describe('Texto', () => {
  it('exige contenido y recorta espacios', () => {
    expect(shortText().parse('  Fernet  ')).toBe('Fernet')
    expect(esValido(shortText(), '   ')).toBe(false)
    expect(esValido(shortText(), '')).toBe(false)
  })

  it('aplica longitud maxima', () => {
    expect(esValido(shortText(10), 'a'.repeat(11))).toBe(false)
  })
})

describe('Medio de pago', () => {
  it('solo acepta los tres del sistema', () => {
    expect(esValido(paymentMethodSchema, 'efectivo')).toBe(true)
    expect(esValido(paymentMethodSchema, 'tarjeta')).toBe(true)
    expect(esValido(paymentMethodSchema, 'mercado_pago')).toBe(true)
    expect(esValido(paymentMethodSchema, 'trueque')).toBe(false)
    expect(esValido(paymentMethodSchema, 'EFECTIVO')).toBe(false)
  })
})

describe('Asignacion masiva', () => {
  const usuario = z
    .object({
      username: shortText(50),
      name: shortText(100),
    })
    .strict()

  it('rechaza propiedades no declaradas', () => {
    expect(
      esValido(usuario, { username: 'juan', name: 'Juan', roleId: 1 }),
      'Un campo extra deberia hacer fallar la validacion, no colarse hasta Prisma',
    ).toBe(false)
  })

  it('acepta exactamente los campos declarados', () => {
    expect(esValido(usuario, { username: 'juan', name: 'Juan' })).toBe(true)
  })
})

/**
 * Ejecuta `fn` y devuelve lo que haya lanzado.
 *
 * Evita poner `expect` dentro de un `catch`: si la funcion no llegara a
 * lanzar, ese bloque no se ejecuta y la prueba pasa sin haber comprobado
 * nada. Aca la ausencia de excepcion es un fallo explicito.
 */
function loQueLanza(fn: () => unknown): unknown {
  try {
    fn()
  } catch (e) {
    return e
  }
  throw new Error('Se esperaba una excepcion y la funcion termino sin lanzar')
}

describe('parseWith', () => {
  it('lanza AppError de validacion con el detalle del campo', () => {
    const err = loQueLanza(() =>
      parseWith(z.object({ cantidad: quantitySchema }), { cantidad: -1 }),
    )

    expect(err).toBeInstanceOf(AppError)
    expect((err as AppError).code).toBe('VALIDATION')
    expect((err as AppError).status).toBe(400)
    expect(JSON.stringify((err as AppError).details)).toContain('cantidad')
  })

  it('no incluye el valor recibido en el mensaje de error', () => {
    const err = loQueLanza(() =>
      parseWith(z.object({ password: shortText(5) }), { password: 'secreto-real-del-usuario' }),
    )

    // Un detalle de validacion se registra y a veces se muestra: si copiara
    // el valor recibido, una contrasena terminaria en el log del servidor.
    const texto = JSON.stringify(err instanceof AppError ? err.details : err)
    expect(texto).not.toContain('secreto-real-del-usuario')
  })
})
