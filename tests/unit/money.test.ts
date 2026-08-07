/**
 * Aritmetica de dinero: lo que se rompia.
 *
 * Cada caso de aca es una cuenta que en punto flotante da mal. No son pruebas
 * de una biblioteca ajena: son las cuentas concretas que hace el almacen --el
 * total de un ticket, el vuelto, el reparto de un pago combinado, la reversion
 * de una anulacion-- escritas con los numeros que las hacen fallar.
 *
 * La regla que verifican todas juntas: NO PUEDE HABER UN CENTAVO DE DIFERENCIA
 * entre la suma de las lineas, el total de la venta, la suma de los pagos, el
 * movimiento de caja y su reversion.
 */

import { describe, it, expect } from 'vitest'
import {
  CERO,
  aCentavos,
  absMonto,
  compararMontos,
  desdeCentavos,
  esCero,
  esNegativo,
  formatearMonto,
  maxMonto,
  minMonto,
  monto,
  montoODefecto,
  montoOpcional,
  multiplicarMonto,
  negarMonto,
  restarMontos,
  sumarMontos,
} from '@/lib/money'
import {
  CERO_D,
  aCentavosExactos,
  aMonto,
  aMontoCosto,
  aMontoOpcional,
  comparar,
  desdeCentavosD,
  dinero,
  dividir,
  esPositivo,
  multiplicar,
  redondearCosto,
  redondearPesos,
  restar,
  sumar,
  sumaODefecto,
} from '@/server/money'

describe('El caso que da nombre al problema', () => {
  it('0,1 + 0,2 da exactamente 0,30 en el navegador', () => {
    // En punto flotante: 0.30000000000000004
    expect(0.1 + 0.2).not.toBe(0.3)
    expect(sumarMontos('0.10', '0.20')).toBe('0.30')
  })

  it('0,1 + 0,2 da exactamente 0,30 en el servidor', () => {
    expect(aMonto(sumar(dinero('0.10'), dinero('0.20')))).toBe('0.30')
  })

  it('99,99 + 0,01 da exactamente 100,00 y no 99,99999999999999', () => {
    expect(sumarMontos('99.99', '0.01')).toBe('100.00')
    expect(aMonto(sumar(dinero('99.99'), dinero('0.01')))).toBe('100.00')
  })

  it('la resta que deberia dar cero, da cero', () => {
    // 1.1 - 1.0 en punto flotante da 0.10000000000000009
    expect(restarMontos('1.10', '1.00')).toBe('0.10')
    expect(esCero(restarMontos('32000.00', '32000.00'))).toBe(true)
  })
})

describe('Centavos exactos', () => {
  it('parsea por cadena y no multiplicando por cien', () => {
    // Number('1.15') * 100 === 114.99999999999999
    expect(aCentavos('1.15')).toBe(115)
    expect(aCentavos('0.07')).toBe(7)
    expect(aCentavos('1234.56')).toBe(123456)
    expect(aCentavos('-90.00')).toBe(-9000)
  })

  it('acepta un importe sin decimales y uno sin enteros', () => {
    expect(aCentavos('4850')).toBe(485000)
    expect(aCentavos('0.5')).toBe(50)
  })

  it('redondea medio hacia arriba lo que exceda dos decimales', () => {
    expect(aCentavos('1.005')).toBe(101)
    expect(aCentavos('1.004')).toBe(100)
    expect(aCentavos('1543.1250')).toBe(154313)
  })

  it('redondea el negativo por su valor absoluto: dos simetricos siguen siendolo', () => {
    expect(aCentavos('-1.005')).toBe(-101)
    expect(aCentavos('-1.005')).toBe(-aCentavos('1.005'))
  })

  it('rechaza lo que no es un importe', () => {
    expect(() => aCentavos('abc')).toThrow(/no es un importe/i)
    expect(() => aCentavos('')).toThrow()
    expect(() => aCentavos('1,50')).toThrow()
    expect(() => aCentavos('1.2.3')).toThrow()
  })

  it('vuelve desde centavos con la escala fija', () => {
    expect(desdeCentavos(123456)).toBe('1234.56')
    expect(desdeCentavos(7)).toBe('0.07')
    expect(desdeCentavos(0)).toBe('0.00')
    expect(desdeCentavos(-9000)).toBe('-90.00')
    expect(desdeCentavos(100)).toBe('1.00')
  })

  it('rechaza centavos que no sean enteros', () => {
    expect(() => desdeCentavos(10.5)).toThrow(/enteros/i)
  })
})

describe('Normalizacion en el borde de entrada', () => {
  it('acepta cadena y numero y devuelve siempre la misma forma', () => {
    expect(monto('1234.5')).toBe('1234.50')
    expect(monto('1234')).toBe('1234.00')
    expect(monto(1234.5)).toBe('1234.50')
    expect(monto(0)).toBe('0.00')
  })

  it('devuelve null en vez de lanzar cuando la respuesta viene mal', () => {
    expect(montoOpcional(null)).toBeNull()
    expect(montoOpcional(undefined)).toBeNull()
    expect(montoOpcional('sin sentido')).toBeNull()
    expect(montoOpcional({})).toBeNull()
    expect(montoOpcional('12.30')).toBe('12.30')
  })

  it('cae al valor por omision cuando no hay nada', () => {
    expect(montoODefecto(undefined)).toBe(CERO)
    expect(montoODefecto('x', '5.00')).toBe('5.00')
    expect(montoODefecto('9.90')).toBe('9.90')
  })
})

describe('Un ticket con centavos', () => {
  // Precios elegidos porque su suma en punto flotante NO da el total redondo.
  const lineas = [
    { precio: '19.99', cantidad: 3 },
    { precio: '0.07', cantidad: 7 },
    { precio: '1234.56', cantidad: 1 },
  ]

  it('la suma de subtotales es igual al total, sin diferencia de un centavo', () => {
    const subtotales = lineas.map((l) => multiplicarMonto(l.precio, l.cantidad))
    expect(subtotales).toEqual(['59.97', '0.49', '1234.56'])

    const total = sumarMontos(...subtotales)
    expect(total).toBe('1295.02')

    // La misma cuenta en el servidor tiene que dar identico.
    const totalServidor = sumar(...lineas.map((l) => multiplicar(dinero(l.precio), l.cantidad)))
    expect(aMonto(totalServidor)).toBe(total)
  })

  it('en punto flotante, un subtotal de esa misma cuenta ya sale mal', () => {
    // 0,49000000000000005. Que el TOTAL de este ticket termine dando bien es
    // pura casualidad aritmetica: los errores de tres lineas se cancelaron.
    // Esa casualidad es exactamente el problema --funciona hasta que no--.
    expect(0.07 * 7).not.toBe(0.49)
    expect(multiplicarMonto('0.07', 7)).toBe('0.49')
  })

  it('multiplica por una cantidad fraccionaria redondeando una sola vez', () => {
    // 0,425 kg de queso a $9.800 el kilo.
    expect(multiplicarMonto('9800.00', 0.425)).toBe('4165.00')
    // 1,375 kg: 13.475 exactos.
    expect(multiplicarMonto('9800.00', 1.375)).toBe('13475.00')
    // Uno que no cierra: 0,333 kg a $10,00 -> 3,33.
    expect(multiplicarMonto('10.00', 0.333)).toBe('3.33')
  })

  it('redondea el producto negativo simetricamente', () => {
    expect(multiplicarMonto('-10.00', 0.333)).toBe('-3.33')
  })
})

describe('Vuelto', () => {
  it('recibido menos total, exacto', () => {
    expect(restarMontos('15000.00', '12000.00')).toBe('3000.00')
    expect(restarMontos('100.00', '99.99')).toBe('0.01')
  })

  it('no hay vuelto cuando se paga justo', () => {
    expect(esCero(restarMontos('4850.00', '4850.00'))).toBe(true)
  })

  it('recibir de menos da negativo, y se nota', () => {
    const falta = restarMontos('90.00', '100.00')
    expect(falta).toBe('-10.00')
    expect(esNegativo(falta)).toBe(true)
    expect(absMonto(falta)).toBe('10.00')
    expect(negarMonto(falta)).toBe('10.00')
  })
})

describe('Pago combinado', () => {
  it('la suma de los pagos es exactamente el total', () => {
    const total = '32000.00'
    const pagos = ['12000.00', '20000.00']

    expect(sumarMontos(...pagos)).toBe(total)
    expect(compararMontos(sumarMontos(...pagos), total)).toBe(0)
    expect(esCero(restarMontos(total, sumarMontos(...pagos)))).toBe(true)
  })

  it('tres metodos con centavos tambien cierran', () => {
    const total = '1295.02'
    const pagos = ['1000.00', '295.01', '0.01']
    expect(sumarMontos(...pagos)).toBe(total)
  })

  it('el restante baja hasta cero sin quedarse en un centavo fantasma', () => {
    const total = '100.00'
    let restante = total
    for (const pago of ['33.33', '33.33', '33.34']) {
      restante = restarMontos(restante, pago)
    }
    expect(restante).toBe('0.00')
    expect(esCero(restante)).toBe(true)
  })

  it('detecta que falta un centavo, que es lo que el POS tiene que impedir', () => {
    const restante = restarMontos('32000.00', sumarMontos('12000.00', '19999.99'))
    expect(restante).toBe('0.01')
    expect(esCero(restante)).toBe(false)
  })

  it('esa misma cuenta en punto flotante no da un centavo redondo', () => {
    // 0,00999999999839929. Comparar eso contra 0.01 para decidir si el pago
    // esta completo es exactamente lo que no se puede hacer.
    expect(32000 - 12000 - 19999.99).not.toBe(0.01)
  })
})

describe('Anulacion', () => {
  it('el contramovimiento deja el saldo exactamente como estaba', () => {
    const saldoAntes = dinero('71000.00')
    const venta = dinero('1295.02')

    const conVenta = sumar(saldoAntes, venta)
    const anulada = restar(conVenta, venta)

    expect(aMonto(anulada)).toBe(aMonto(saldoAntes))
    expect(comparar(anulada, saldoAntes)).toBe(0)
  })

  it('anular tres ventas seguidas tampoco deja residuo', () => {
    let saldo = dinero('0.00')
    const ventas = ['19.99', '0.07', '1234.56']
    for (const v of ventas) saldo = sumar(saldo, dinero(v))
    for (const v of ventas) saldo = restar(saldo, dinero(v))
    expect(aMonto(saldo)).toBe('0.00')
    expect(saldo.isZero()).toBe(true)
  })
})

describe('Cantidades grandes', () => {
  it('un total de mil millones con centavos sigue siendo exacto', () => {
    const grande = '999999999.99'
    expect(sumarMontos(grande, '0.01')).toBe('1000000000.00')
    expect(aMonto(sumar(dinero(grande), dinero('0.01')))).toBe('1000000000.00')
  })

  it('sumar diez mil lineas de un centavo da exactamente cien pesos', () => {
    const lineas = Array.from({ length: 10_000 }, () => '0.01')
    expect(sumarMontos(...lineas)).toBe('100.00')
  })

  it('la misma suma en punto flotante se desvia', () => {
    let f = 0
    for (let i = 0; i < 10_000; i++) f += 0.01
    expect(f).not.toBe(100)
  })

  it('avisa antes de desbordar en vez de devolver un numero inventado', () => {
    expect(() => desdeCentavos(Number.MAX_SAFE_INTEGER + 100)).toThrow(/fuera de rango/i)
  })
})

describe('Descuentos y porcentajes', () => {
  it('un 10 % sobre un importe con centavos redondea una sola vez', () => {
    // 1295,02 * 0,10 = 129,502 -> 129,50
    expect(aMonto(multiplicar(dinero('1295.02'), '0.10'))).toBe('129.50')
    // 1295,02 * 0,15 = 194,253 -> 194,25
    expect(aMonto(multiplicar(dinero('1295.02'), '0.15'))).toBe('194.25')
  })

  it('el importe con descuento mas el descuento vuelve al original', () => {
    const total = dinero('1295.02')
    const descuento = redondearPesos(multiplicar(total, '0.10'))
    const conDescuento = restar(total, descuento)
    expect(aMonto(sumar(conDescuento, descuento))).toBe('1295.02')
  })
})

describe('Costos unitarios, con cuatro decimales', () => {
  it('una caja de 8 a $12.345 da un costo unitario sin perdida', () => {
    const unitario = dividir(dinero('12345.00'), 8)
    expect(aMontoCosto(redondearCosto(unitario))).toBe('1543.1250')
  })

  it('reconstruir la caja desde el costo unitario devuelve el total exacto', () => {
    const unitario = redondearCosto(dividir(dinero('12345.00'), 8))
    expect(aMonto(multiplicar(unitario, 8))).toBe('12345.00')
  })

  it('con dos decimales, esa misma reconstruccion pierde cuatro centavos', () => {
    const truncado = redondearPesos(dividir(dinero('12345.00'), 8))
    expect(aMonto(multiplicar(truncado, 8))).toBe('12345.04')
  })

  it('se niega a dividir por cero en vez de devolver infinito', () => {
    expect(() => dividir(dinero('100.00'), 0)).toThrow(/division por cero/i)
  })
})

describe('Serializacion hacia la API', () => {
  it('siempre dos decimales, tambien cuando son redondos', () => {
    expect(aMonto(dinero('6540'))).toBe('6540.00')
    expect(aMonto(dinero(0))).toBe('0.00')
    expect(aMonto(dinero('-90'))).toBe('-90.00')
  })

  it('redondea medio hacia arriba, como una calculadora', () => {
    expect(aMonto(dinero('1.005'))).toBe('1.01')
    expect(aMonto(dinero('1.004'))).toBe('1.00')
    expect(aMonto(dinero('2.5'))).toBe('2.50')
    expect(aMonto(redondearPesos(dinero('2.555')))).toBe('2.56')
  })

  it('no usa redondeo al par: 2,345 y 2,355 suben los dos', () => {
    expect(aMonto(dinero('2.345'))).toBe('2.35')
    expect(aMonto(dinero('2.355'))).toBe('2.36')
  })

  it('lo que sale del servidor lo entiende el navegador sin perder nada', () => {
    const enElServidor = sumar(dinero('19.99'), dinero('0.07'))
    const enElCable = aMonto(enElServidor)
    expect(aCentavos(enElCable)).toBe(2006)
    expect(sumarMontos(enElCable, '0.01')).toBe('20.07')
  })

  it('admite la ausencia sin inventar un cero', () => {
    expect(aMontoOpcional(null)).toBeNull()
    expect(aMontoOpcional(undefined)).toBeNull()
    expect(aMontoOpcional(dinero('5'))).toBe('5.00')
  })

  it('una agregacion vacia de Prisma cae en cero y no en null', () => {
    expect(aMonto(sumaODefecto(null))).toBe('0.00')
    expect(aMonto(sumaODefecto(undefined))).toBe('0.00')
    expect(aMonto(sumaODefecto(dinero('12.34')))).toBe('12.34')
  })
})

describe('Ida y vuelta entre servidor y navegador', () => {
  it('centavos exactos en los dos lados dan el mismo entero', () => {
    for (const v of ['0.00', '0.01', '1.15', '1234.56', '-90.00', '999999999.99']) {
      expect(aCentavosExactos(dinero(v))).toBe(aCentavos(v))
    }
  })

  it('reconstruir desde centavos devuelve el mismo importe', () => {
    for (const v of ['0.00', '0.07', '1234.56', '-90.00']) {
      expect(aMonto(desdeCentavosD(aCentavos(v)))).toBe(v)
    }
  })
})

describe('Comparaciones', () => {
  it('ordena bien, incluido el cero y los negativos', () => {
    expect(compararMontos('1.00', '2.00')).toBe(-1)
    expect(compararMontos('2.00', '1.00')).toBe(1)
    expect(compararMontos('1.00', '1.000')).toBe(0)
    expect(compararMontos('-1.00', '0.00')).toBe(-1)

    expect(comparar(dinero('1'), dinero('2'))).toBe(-1)
    expect(comparar(dinero('1.00'), dinero('1'))).toBe(0)
  })

  it('el cero no es ni positivo ni negativo', () => {
    expect(esCero(CERO)).toBe(true)
    expect(esNegativo(CERO)).toBe(false)
    expect(esPositivo(CERO_D)).toBe(false)
    expect(CERO_D.isZero()).toBe(true)
  })

  it('maximo y minimo', () => {
    expect(maxMonto('10.00', '9.99')).toBe('10.00')
    expect(minMonto('10.00', '9.99')).toBe('9.99')
  })
})

describe('Formato', () => {
  it('un solo formato en todo el sistema', () => {
    // El separador que pone `Intl` para es-AR es un espacio duro (U+00A0),
    // no uno comun. Se compara escapandolo: pegado literal en el archivo es
    // invisible, y ESLint lo rechaza justamente por eso.
    const normal = (texto: string) => texto.replace(/\u00a0/g, ' ')
    expect(normal(formatearMonto('1234.56'))).toBe('$ 1.234,56')
    expect(normal(formatearMonto('0.00'))).toBe('$ 0,00')
  })
  it('no pierde centavos al formatear un importe grande', () => {
    expect(formatearMonto('999999999.99')).toContain('999.999.999,99')
  })
})
