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

  it('acepta fracciones de hasta tres decimales, en numero o en cadena', () => {
    // Cambio de la Fase 3B: 0,425 kg de queso es una linea de ticket valida.
    // La cadena es la forma preferida --un numero de JSON es un `double`-- y el
    // numero se sigue aceptando para no romper clientes anteriores.
    for (const valor of ['0.425', '1.5', '0.001', 0.425, 1.5]) {
      expect(esValido(quantitySchema, valor), `${String(valor)} deberia ser valido`).toBe(true)
    }
  })

  it('normaliza a cadena con tres decimales', () => {
    // Lo que sale del esquema tiene SIEMPRE la misma forma, venga como venga:
    // asi el servicio lo pasa a `Decimal` sin volver a tocarlo.
    expect(quantitySchema.parse(2)).toBe('2.000')
    expect(quantitySchema.parse('0.425')).toBe('0.425')
    expect(quantitySchema.parse('1.5')).toBe('1.500')
  })

  it('lo que el esquema NO comprueba es si la fraccion vale para su unidad', () => {
    // `1.235` es una cantidad bien formada; que no exista para un producto que
    // se vende por unidad lo decide el servicio, que es quien conoce el
    // producto. Ver `motivoDeCantidadInvalida`.
    expect(esValido(quantitySchema, '1.235')).toBe(true)
  })

  const rechazados: Array<[string, unknown]> = [
    ['cero', 0],
    ['negativo', -1],
    ['cuatro decimales', '0.4251'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
    ['cadena', 'dos'],
    ['cadena vacia', ''],
    ['null', null],
    ['undefined', undefined],
    ['objeto', {}],
    ['fuera de rango', 1_000_001],
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

  it('acepta la cadena decimal, que es como los manda la aplicacion', () => {
    expect(esValido(amountSchema, '0.00')).toBe(true)
    expect(esValido(amountSchema, '12500')).toBe(true)
    expect(esValido(amountSchema, '1234.56')).toBe(true)
  })

  it('normaliza a la forma canonica, venga como venga', () => {
    // Es lo que despues recibe el servicio para pasarlo a `Decimal`: siempre
    // la misma forma, con la escala completa.
    expect(amountSchema.parse('1234.5')).toBe('1234.50')
    expect(amountSchema.parse('1234')).toBe('1234.00')
    expect(amountSchema.parse(1234.56)).toBe('1234.56')
    expect(amountSchema.parse(0)).toBe('0.00')
  })

  it('rechaza cadenas que no son importes', () => {
    expect(esValido(amountSchema, '')).toBe(false)
    expect(esValido(amountSchema, 'mil pesos')).toBe(false)
    // Coma decimal: la convierte la pantalla, no el servidor. Aceptarla aca
    // obligaria a adivinar si "1,234" son mil doscientos o uno con coma.
    expect(esValido(amountSchema, '1,50')).toBe(false)
    expect(esValido(amountSchema, '10.001')).toBe(false)
    expect(esValido(amountSchema, '-5.00')).toBe(false)
  })

  it('rechaza un importe fuera de rango', () => {
    expect(esValido(amountSchema, '1000000001.00')).toBe(false)
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
