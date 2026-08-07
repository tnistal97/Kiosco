/**
 * Cantidades fraccionadas, unidades y rentabilidad.
 *
 * Las tres cosas que la Fase 3B agrega y que NO necesitan base de datos. Lo
 * que se comprueba aca es lo que despues sostiene todo lo demas: si `0.1 + 0.2`
 * no da `0.3` en este archivo, el libro de inventario rechaza filas en
 * produccion.
 */

import { describe, it, expect } from 'vitest'
import {
  CANTIDAD_MAX,
  aMilesimas,
  cantidad,
  cantidadDesdeTexto,
  cantidadODefecto,
  compararCantidades,
  desdeMilesimas,
  precioPorCantidad,
  restarCantidades,
  sumarCantidades,
} from '@/lib/cantidad'
import {
  POLITICA_DE_UNIDAD,
  UNIDADES_DE_COMPRA,
  UNIDADES_DE_VENTA,
  denominadorDePrecio,
  esFraccionable,
  esUnidadDeVenta,
  formatearCantidad,
  formatearCantidadConUnidad,
  motivoDeCantidadInvalida,
  unidadDeVentaODefecto,
} from '@/modules/products/units'
import { calcularRentabilidad, formatearPorcentaje, precioParaMargen } from '@/modules/products/margen' // prettier-ignore

describe('Aritmetica exacta de cantidades', () => {
  it('0,1 + 0,2 da 0,3, que es de lo que se trata todo esto', () => {
    // En punto flotante da 0.30000000000000004, y con eso la restriccion
    // `resultingQuantity = previousQuantity + quantity` de PostgreSQL rechaza
    // la fila. No es un numero feo: es una venta que no se puede registrar.
    expect(sumarCantidades('0.100', '0.200')).toBe('0.300')
  })

  it('el parseo es por cadena, no multiplicando por mil', () => {
    // `Number('0.425') * 1000` da 424.99999999999994.
    expect(aMilesimas('0.425')).toBe(425)
    expect(aMilesimas('1.999')).toBe(1999)
    expect(aMilesimas('0.001')).toBe(1)
  })

  it('ida y vuelta sin perdida', () => {
    for (const c of ['0.001', '0.425', '1.500', '999.999', '0.000']) {
      expect(desdeMilesimas(aMilesimas(c))).toBe(c)
    }
  })

  it('resta y comparacion sobre fracciones', () => {
    expect(restarCantidades('5.500', '0.250')).toBe('5.250')
    expect(compararCantidades('0.300', '0.300')).toBe(0)
    expect(compararCantidades('0.299', '0.300')).toBe(-1)
    expect(compararCantidades('0.301', '0.300')).toBe(1)
  })

  it('normaliza a tres decimales, venga como venga', () => {
    expect(cantidad('2')).toBe('2.000')
    expect(cantidad('0.5')).toBe('0.500')
    expect(cantidad(0.425)).toBe('0.425')
    expect(cantidadODefecto(undefined)).toBe('0.000')
    expect(cantidadODefecto('no es un numero')).toBe('0.000')
  })

  it('acepta coma y punto, que es lo que se tipea de verdad', () => {
    expect(cantidadDesdeTexto('0,425')).toBe('0.425')
    expect(cantidadDesdeTexto('0.425')).toBe('0.425')
    expect(cantidadDesdeTexto('  1,5 ')).toBe('1.500')
  })

  it('devuelve null y no cero cuando no es una cantidad', () => {
    // Un cero silencioso significa "peso cero", que es una afirmacion muy
    // distinta de "todavia no escribi nada".
    expect(cantidadDesdeTexto('')).toBeNull()
    expect(cantidadDesdeTexto('abc')).toBeNull()
    expect(cantidadDesdeTexto('1.2.3')).toBeNull()
    expect(cantidadDesdeTexto('0.4251'), 'cuatro decimales no existen').toBeNull()
    expect(cantidadDesdeTexto('-1'), 'una cantidad negativa no se tipea').toBeNull()
  })

  it('NO acepta separador de miles, a diferencia del dinero', () => {
    // `1.500` en un campo de peso significa kilo y medio, no mil quinientos.
    // Aceptar el separador de miles haria ambiguo el caso mas comun.
    expect(cantidadDesdeTexto('1.500')).toBe('1.500')
    expect(aMilesimas(cantidadDesdeTexto('1.500') ?? '0'), 'kilo y medio').toBe(1500)
  })

  it('el tope de la aplicacion es un millon', () => {
    expect(CANTIDAD_MAX).toBe(1_000_000)
  })
})

describe('Precio por cantidad', () => {
  it('el ejemplo del mostrador', () => {
    // $9.800/kg por 0,425 kg. En punto flotante `9800 * 0.425` da
    // 4164.999999999999 y el ticket mostraria un centavo menos que el que
    // despues cobra el servidor.
    expect(precioPorCantidad('9800.00', '0.425')).toBe('4165.00')
  })

  it.each([
    ['0.100', '980.00'],
    ['0.200', '1960.00'],
    ['0.333', '3263.40'],
    ['0.425', '4165.00'],
    ['1.999', '19590.20'],
  ])('9800,00 x %s = %s', (peso, esperado) => {
    expect(precioPorCantidad('9800.00', peso)).toBe(esperado)
  })

  it('nunca devuelve basura decimal', () => {
    for (const peso of ['0.001', '0.007', '0.333', '0.666', '1.111']) {
      const subtotal = precioPorCantidad('9800.00', peso)
      expect(subtotal, `${peso} kg dio ${subtotal}`).toMatch(/^\d+\.\d{2}$/)
    }
  })

  it('un producto por unidad da el mismo resultado que multiplicar', () => {
    expect(precioPorCantidad('4850.00', '3.000')).toBe('14550.00')
  })
})

describe('Unidades de medida', () => {
  it('las cinco de venta son un subconjunto de las de compra', () => {
    for (const u of UNIDADES_DE_VENTA) {
      expect(UNIDADES_DE_COMPRA as readonly string[]).toContain(u)
    }
  })

  it('PACK y BOX se compran pero NO se venden', () => {
    // La asimetria es la respuesta a si convenia agregarlas: como unidad de
    // venta no aportan nada --un six-pack que se vende entero se vende por
    // unidad-- y como unidad de compra son el unico modo de que
    // `unitsPerPurchaseUnit` se pueda leer.
    expect(UNIDADES_DE_COMPRA as readonly string[]).toContain('PACK')
    expect(UNIDADES_DE_COMPRA as readonly string[]).toContain('BOX')
    expect(esUnidadDeVenta('PACK')).toBe(false)
    expect(esUnidadDeVenta('BOX')).toBe(false)
  })

  it('las UNICAS fraccionables son el kilo y el litro', () => {
    // G y ML tienen paso 1 a proposito: medio gramo no lo pesa ninguna
    // balanza de mostrador. La consecuencia practica es que el dialogo de peso
    // se abre para dos casos, no para cinco.
    expect(UNIDADES_DE_VENTA.filter(esFraccionable)).toEqual(['KG', 'L'])
  })

  it('toda unidad tiene simbolo, nombre, paso y minimo', () => {
    for (const u of UNIDADES_DE_VENTA) {
      const p = POLITICA_DE_UNIDAD[u]
      expect(p.simbolo, u).not.toBe('')
      expect(p.nombre, u).not.toBe('')
      expect(aMilesimas(p.paso), u).toBeGreaterThan(0)
      expect(aMilesimas(p.minimo), u).toBeGreaterThan(0)
    }
  })

  it('una unidad desconocida no rompe: cae en UNIT', () => {
    expect(unidadDeVentaODefecto('TONELADA')).toBe('UNIT')
    expect(unidadDeVentaODefecto(null)).toBe('UNIT')
    expect(unidadDeVentaODefecto(undefined)).toBe('UNIT')
  })
})

describe('Regla de fraccionamiento', () => {
  it('UNIT solo acepta enteros, minimo 1', () => {
    expect(motivoDeCantidadInvalida('UNIT', '1.000')).toBeNull()
    expect(motivoDeCantidadInvalida('UNIT', '3.000')).toBeNull()
    expect(motivoDeCantidadInvalida('UNIT', '1.235')).toMatch(/entero/i)
    expect(motivoDeCantidadInvalida('UNIT', '0.500')).toMatch(/entero/i)
    expect(motivoDeCantidadInvalida('UNIT', '0.000')).toMatch(/mayor que cero/i)
  })

  it('KG acepta pasos de 0,001', () => {
    expect(motivoDeCantidadInvalida('KG', '0.001')).toBeNull()
    expect(motivoDeCantidadInvalida('KG', '0.425')).toBeNull()
    expect(motivoDeCantidadInvalida('KG', '1.375')).toBeNull()
    expect(motivoDeCantidadInvalida('KG', '0.000')).toMatch(/mayor que cero/i)
  })

  it('L acepta fracciones igual que KG', () => {
    expect(motivoDeCantidadInvalida('L', '0.500')).toBeNull()
    expect(motivoDeCantidadInvalida('L', '2.250')).toBeNull()
  })

  it('G y ML se comportan como UNIT', () => {
    expect(motivoDeCantidadInvalida('G', '250.000')).toBeNull()
    expect(motivoDeCantidadInvalida('G', '0.500')).toMatch(/entero/i)
    expect(motivoDeCantidadInvalida('ML', '500.000')).toBeNull()
    expect(motivoDeCantidadInvalida('ML', '0.500')).toMatch(/entero/i)
  })

  it('el mensaje dice QUE pasa, no solo que esta mal', () => {
    // "La cantidad no es valida" no le sirve a nadie: hay que poder saber si
    // sobra un decimal o si falta cantidad.
    expect(motivoDeCantidadInvalida('UNIT', '1.235')).not.toBe(
      motivoDeCantidadInvalida('UNIT', '0.000'),
    )
  })
})

describe('Formato de cantidades', () => {
  it('un producto por unidad no se muestra con tres decimales', () => {
    // "3,000 u." hace que la pantalla se lea como una balanza.
    expect(formatearCantidad('3.000', 'UNIT')).toBe('3')
    expect(formatearCantidadConUnidad('3.000', 'UNIT')).toBe('3 u.')
  })

  it('un producto por peso conserva los tres decimales', () => {
    expect(formatearCantidad('0.425', 'KG')).toBe('0,425')
    expect(formatearCantidadConUnidad('0.425', 'KG')).toBe('0,425 kg')
  })

  it('el denominador del precio solo aparece donde dice algo', () => {
    // "$1.200 / u." no le informa nada a nadie que no lo supiera ya.
    expect(denominadorDePrecio('UNIT')).toBe('')
    expect(denominadorDePrecio('KG')).toBe('/ kg')
    expect(denominadorDePrecio('L')).toBe('/ L')
  })
})

describe('Ganancia, margen y markup', () => {
  it('el ejemplo del pedido', () => {
    const r = calcularRentabilidad('1200.00', '750.00')
    expect(r.ganancia).toBe('450.00')
    expect(r.margen).toBe('37.50')
    expect(r.markup).toBe('60.00')
    expect(r.bajoCosto).toBe(false)
  })

  it('margen y markup NO son lo mismo, y por eso llevan nombres distintos', () => {
    // Es el error clasico: "le pongo 40 % arriba" es markup, y quien cree que
    // asi consigue un margen del 40 % se queda corto todos los meses.
    const r = calcularRentabilidad('1400.00', '1000.00')
    expect(r.markup).toBe('40.00')
    expect(r.margen).toBe('28.57')
  })

  it('sin costo cargado no se inventa nada', () => {
    const r = calcularRentabilidad('1200.00', null)
    expect(r.ganancia).toBeNull()
    expect(r.margen).toBeNull()
    expect(r.markup).toBeNull()
  })

  it('costo cero: margen 100 %, markup sin definir', () => {
    // Regalado no tiene sobreprecio. Dividir por cero daria Infinity, que en
    // pantalla se lee como un numero.
    const r = calcularRentabilidad('1200.00', '0.00')
    expect(r.margen).toBe('100.00')
    expect(r.markup).toBeNull()
  })

  it('precio cero: markup calculable, margen sin definir', () => {
    const r = calcularRentabilidad('0.00', '750.00')
    expect(r.margen).toBeNull()
    expect(r.markup).toBe('-100.00')
    expect(r.bajoCosto).toBe(true)
  })

  it('vender por debajo del costo se ve, no se esconde', () => {
    const r = calcularRentabilidad('600.00', '750.00')
    expect(r.ganancia).toBe('-150.00')
    expect(r.margen).toBe('-25.00')
    expect(r.markup).toBe('-20.00')
    expect(r.bajoCosto).toBe(true)
  })

  it('NUNCA devuelve Infinity ni NaN', () => {
    const casos: Array<[string, string | null]> = [
      ['0.00', '0.00'],
      ['0.00', null],
      ['1200.00', '0.00'],
      ['0.00', '750.00'],
      ['999999999.99', '0.01'],
    ]
    for (const [precio, costo] of casos) {
      const r = calcularRentabilidad(precio, costo)
      for (const valor of [r.margen, r.markup]) {
        expect(valor === null || /^-?\d+\.\d{2}$/.test(valor), `${precio}/${String(costo)}`).toBe(true) // prettier-ignore
      }
    }
  })

  it('sin dato se muestra un guion, no un cero', () => {
    expect(formatearPorcentaje(null)).toBe('—')
    expect(formatearPorcentaje('37.50')).toBe('37,50 %')
  })

  it('el precio para un margen buscado, o null si no existe', () => {
    expect(precioParaMargen('750.00', 37.5)).toBe('1200.00')
    expect(precioParaMargen('750.00', 100), 'un margen del 100 % no tiene precio').toBeNull()
    expect(precioParaMargen('750.00', 150)).toBeNull()
    expect(precioParaMargen('0.00', 40)).toBeNull()
  })
})
