/**
 * La aritmetica de una compra, sin base de datos.
 *
 * Lo que se comprueba aca, y no se puede comprobar en ningun otro lado:
 *
 *   1. la conversion de unidad de compra a unidad de stock es EXACTA;
 *   2. las dos implementaciones --la entera del navegador y la decimal del
 *      servidor-- dan el MISMO numero sobre la misma tabla de casos;
 *   3. el vocabulario de estados de TypeScript y el CHECK de PostgreSQL dicen
 *      lo mismo.
 *
 * La segunda es la que importa mas. Dos versiones de la misma cuenta que se
 * separan en silencio son peores que una sola imperfecta: la pantalla mostraria
 * un total y la base guardaria otro, y nadie sabria cual creer.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  cantidadDeStock,
  costoDeStockAproximado,
  descripcionDeConversion,
  motivoDeConversionInvalida,
  subtotalDeLinea,
} from '@/modules/purchases/conversion'
import {
  cantidadDeStock as cantidadDeStockD,
  costoDeStock as costoDeStockD,
  diferenciaDeCosto,
  pendienteComoTexto,
  subtotalDeLinea as subtotalDeLineaD,
  totalDeOrden,
} from '@/modules/purchases/calculo'
import { cantidad as aCantidad } from '@/server/cantidad'
import { aMonto, aMontoCosto, dinero } from '@/server/money'
import {
  ESTADOS_DE_COMPRA,
  esEstadoDeCompra,
  etiquetaDeEstado,
  sePuedeCancelar,
  sePuedeConfirmar,
  sePuedeEditar,
  sePuedeRecibir,
} from '@/modules/purchases/status'

// ---------------------------------------------------------------------------
// Conversion de cantidad
// ---------------------------------------------------------------------------

describe('Unidad de compra → unidad de stock', () => {
  it('5 cajas de 8 son 40 unidades', () => {
    expect(cantidadDeStock('5.000', '8.000')).toBe('40.000')
  })

  it('3 cajas de 8 son 24, y 2 mas son 16', () => {
    expect(cantidadDeStock('3.000', '8.000')).toBe('24.000')
    expect(cantidadDeStock('2.000', '8.000')).toBe('16.000')
  })

  it('con factor 1 la conversion es la identidad', () => {
    expect(cantidadDeStock('12.500', '1.000')).toBe('12.500')
    expect(cantidadDeStock('0.001', '1.000')).toBe('0.001')
  })

  it('una fraccion de caja tambien convierte exacto', () => {
    // Media caja de 8 son 4 unidades.
    expect(cantidadDeStock('0.500', '8.000')).toBe('4.000')
    // Un cuarto de caja de 12 son 3.
    expect(cantidadDeStock('0.250', '12.000')).toBe('3.000')
  })

  it('no reintroduce el error de punto flotante', () => {
    // 0.1 * 3 en punto flotante da 0.30000000000000004.
    expect(cantidadDeStock('0.100', '3.000')).toBe('0.300')
    // 1.1 * 3 da 3.3000000000000003.
    expect(cantidadDeStock('1.100', '3.000')).toBe('3.300')
  })
})

describe('Conversiones imposibles', () => {
  it('3 packs de 2,5 dan 7,5 unidades, y media unidad no existe', () => {
    const motivo = motivoDeConversionInvalida('UNIT', 'PACK', '3.000', '2.500')
    expect(motivo).not.toBeNull()
    // El mensaje nombra los TRES numeros: sin eso hay que adivinar cual esta mal.
    expect(motivo).toContain('3.000')
    expect(motivo).toContain('2.500')
    expect(motivo).toContain('7.500')
  })

  it('la misma conversion SI vale en un producto por kilo', () => {
    expect(motivoDeConversionInvalida('KG', 'PACK', '3.000', '2.500')).toBeNull()
  })

  it('un factor de cero se rechaza antes de dividir por el', () => {
    expect(motivoDeConversionInvalida('UNIT', 'BOX', '5.000', '0.000')).toContain(
      'al menos una unidad',
    )
  })

  it('4 packs de 2,5 SI dan un entero: 10 unidades', () => {
    expect(motivoDeConversionInvalida('UNIT', 'PACK', '4.000', '2.500')).toBeNull()
    expect(cantidadDeStock('4.000', '2.500')).toBe('10.000')
  })
})

// ---------------------------------------------------------------------------
// Costos
// ---------------------------------------------------------------------------

describe('Costo por unidad de compra → costo por unidad de stock', () => {
  it('$8.800 la caja de 8 son $1.100 la botella', () => {
    expect(costoDeStockAproximado('8800.00', '8.000')).toBe('1100.00')
    expect(aMontoCosto(costoDeStockD(dinero('8800'), aCantidad('8')))).toBe('1100.0000')
  })

  it('$8.900 la caja de 8 son $1.112,50', () => {
    expect(aMontoCosto(costoDeStockD(dinero('8900'), aCantidad('8')))).toBe('1112.5000')
  })

  it('una division que no cierra se guarda con cuatro decimales', () => {
    // $1.000 entre 3: el motivo de que la escala del costo sea 4 y no 2.
    expect(aMontoCosto(costoDeStockD(dinero('1000'), aCantidad('3')))).toBe('333.3333')
  })

  it('con factor 1 el costo no se toca', () => {
    expect(aMontoCosto(costoDeStockD(dinero('6200'), aCantidad('1')))).toBe('6200.0000')
  })
})

describe('Subtotal y total', () => {
  it('5 cajas a $8.800 son $44.000', () => {
    expect(subtotalDeLinea('5.000', '8800.00')).toBe('44000.00')
    expect(aMonto(subtotalDeLineaD(aCantidad('5'), dinero('8800')))).toBe('44000.00')
  })

  it('el total es la suma de los subtotales, sin centavo perdido', () => {
    const subtotales = ['0.10', '0.20', '0.30'].map((m) => dinero(m))
    expect(aMonto(totalDeOrden(subtotales)), 'en punto flotante daria 0.6000000000000001').toBe(
      '0.60',
    )
  })

  it('una cantidad fraccionada por un costo con decimales no pierde nada', () => {
    // 12,5 kg a $6.200 = $77.500.
    expect(subtotalDeLinea('12.500', '6200.00')).toBe('77500.00')
    expect(aMonto(subtotalDeLineaD(aCantidad('12.5'), dinero('6200')))).toBe('77500.00')
  })
})

// ---------------------------------------------------------------------------
// Las dos implementaciones tienen que coincidir
// ---------------------------------------------------------------------------

describe('El navegador y el servidor calculan lo mismo', () => {
  /** Casos que cubren caja, pack, kilo, fraccion y el borde de los decimales. */
  const CASOS: Array<[cantidad: string, factor: string, costo: string]> = [
    ['5.000', '8.000', '8800.00'],
    ['3.000', '8.000', '8800.00'],
    ['2.000', '8.000', '8900.00'],
    ['12.500', '1.000', '6200.00'],
    ['1.000', '6.000', '1234.56'],
    ['0.500', '8.000', '999.99'],
    ['4.000', '2.500', '100.00'],
    ['10.000', '12.000', '15000.00'],
    ['0.001', '1000.000', '0.01'],
    ['7.000', '3.000', '1.05'],
  ]

  it.each(CASOS)('cantidad %s × factor %s da lo mismo en los dos lados', (cant, factor) => {
    const enteros = cantidadDeStock(cant, factor)
    const decimal = cantidadDeStockD(aCantidad(cant), aCantidad(factor)).toFixed(3)
    expect(enteros).toBe(decimal)
  })

  it.each(CASOS)('subtotal de %s × %s a %s da lo mismo en los dos lados', (cant, _f, costo) => {
    const enteros = subtotalDeLinea(cant, costo)
    const decimal = aMonto(subtotalDeLineaD(aCantidad(cant), dinero(costo)))
    expect(enteros).toBe(decimal)
  })

  it('el costo por unidad de stock SI puede diferir, y solo en decimales', () => {
    // Es la unica cuenta aproximada del lado del navegador, y esta declarado:
    // la division no siempre cierra y el cliente trabaja en centavos.
    const aproximado = costoDeStockAproximado('1000.00', '3.000')
    const exacto = aMontoCosto(costoDeStockD(dinero('1000'), aCantidad('3')))

    expect(aproximado).toBe('333.33')
    expect(exacto).toBe('333.3333')
    // La diferencia es de una fraccion de centavo, no de un peso.
    expect(Math.abs(Number(aproximado) - Number(exacto))).toBeLessThan(0.01)
  })
})

// ---------------------------------------------------------------------------
// Diferencia entre lo pedido y lo recibido
// ---------------------------------------------------------------------------

describe('Diferencia de costo', () => {
  it('$8.800 pedidos y $8.900 recibidos son $100 y 1,14 %', () => {
    const d = diferenciaDeCosto(dinero('8800'), dinero('8900'))
    expect(d.diferencia).toBe('100.0000')
    expect(d.porcentaje).toBe('1.14')
    expect(d.hayDiferencia).toBe(true)
  })

  it('recibir mas barato da una diferencia negativa', () => {
    const d = diferenciaDeCosto(dinero('8800'), dinero('8000'))
    expect(d.diferencia).toBe('-800.0000')
    expect(d.porcentaje).toBe('-9.09')
  })

  it('sin diferencia lo dice, y el porcentaje es cero', () => {
    const d = diferenciaDeCosto(dinero('8800'), dinero('8800'))
    expect(d.hayDiferencia).toBe(false)
    expect(d.diferencia).toBe('0.0000')
    expect(d.porcentaje).toBe('0.00')
  })

  it('sobre un esperado de cero el porcentaje es null, NO Infinity', () => {
    // Mercaderia bonificada que llego facturada. La pantalla muestra el
    // importe, que es el dato que sirve.
    const d = diferenciaDeCosto(dinero('0'), dinero('500'))
    expect(d.porcentaje).toBeNull()
    expect(d.diferencia).toBe('500.0000')
    expect(Number.isFinite(Number(d.diferencia))).toBe(true)
  })
})

describe('Pendiente de una linea', () => {
  it('5 pedidas y 3 recibidas dejan 2', () => {
    expect(pendienteComoTexto(aCantidad('5'), aCantidad('3'))).toBe('2.000')
  })

  it('nunca es negativo', () => {
    expect(pendienteComoTexto(aCantidad('5'), aCantidad('7'))).toBe('0.000')
  })

  it('con fracciones tambien cierra', () => {
    expect(pendienteComoTexto(aCantidad('12.500'), aCantidad('4.250'))).toBe('8.250')
  })
})

// ---------------------------------------------------------------------------
// Vocabulario de estados
// ---------------------------------------------------------------------------

describe('Estados de una orden', () => {
  it('el catalogo de TypeScript y la restriccion de PostgreSQL dicen lo mismo', () => {
    // Dos definiciones de la misma verdad, en dos lenguajes. Si se separan, la
    // base rechaza estados que el servicio considera validos --o peor, al reves--.
    const sql = readFileSync(
      path.join(
        process.cwd(),
        'prisma/migrations/20260808110000_phase3_purchase_orders/migration.sql',
      ),
      'utf8',
    )
    const restriccion = sql.slice(
      sql.indexOf('PurchaseOrder_status_check'),
      sql.indexOf('PurchaseOrder_number_check'),
    )

    for (const estado of ESTADOS_DE_COMPRA) {
      expect(restriccion, `${estado} no figura en la restriccion de la base`).toContain(
        `'${estado}'`,
      )
    }

    // Y al reves: la restriccion no acepta ninguno que TypeScript no conozca.
    const enSql = [...restriccion.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1])
    for (const estado of enSql) {
      expect(
        esEstadoDeCompra(estado ?? ''),
        `la base acepta "${estado ?? ''}" y el codigo no`,
      ).toBe(true)
    }
  })

  it('un estado desconocido se muestra tal cual, no desaparece', () => {
    // Que en pantalla diga `SOMETHING` es feo; que la celda quede vacia hace
    // que nadie se entere.
    expect(etiquetaDeEstado('ALGO_NUEVO')).toBe('ALGO_NUEVO')
    expect(etiquetaDeEstado('RECEIVED')).toBe('Recibida')
  })

  it('solo un borrador se edita y se confirma', () => {
    expect(sePuedeEditar('DRAFT')).toBe(true)
    expect(sePuedeConfirmar('DRAFT')).toBe(true)
    for (const otro of ['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']) {
      expect(sePuedeEditar(otro), `${otro} no se edita`).toBe(false)
      expect(sePuedeConfirmar(otro), `${otro} no se confirma`).toBe(false)
    }
  })

  it('se recibe una pedida o una parcial, y ninguna otra', () => {
    expect(sePuedeRecibir('ORDERED')).toBe(true)
    expect(sePuedeRecibir('PARTIALLY_RECEIVED')).toBe(true)
    for (const otro of ['DRAFT', 'RECEIVED', 'CANCELLED']) {
      expect(sePuedeRecibir(otro), `${otro} no se recibe`).toBe(false)
    }
  })

  it('una parcial SI se cancela; una recibida no', () => {
    // Cancelar una parcial significa "el resto no va a llegar". Cancelar una
    // recibida solo borraria el rastro de que la compra se completo.
    expect(sePuedeCancelar('PARTIALLY_RECEIVED')).toBe(true)
    expect(sePuedeCancelar('RECEIVED')).toBe(false)
    expect(sePuedeCancelar('CANCELLED')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Texto para la pantalla
// ---------------------------------------------------------------------------

describe('Descripcion de la conversion', () => {
  it('dice cuanto entra en la unidad de venta', () => {
    expect(descripcionDeConversion('UNIT', 'BOX', '5.000', '8.000')).toBe('5.000 caja → 40 u.')
  })

  it('con factor 1 no dice nada: "12,500 kg × 1 = 12,500 kg" no aporta', () => {
    expect(descripcionDeConversion('KG', 'KG', '12.500', '1.000')).toBe('')
  })
})
