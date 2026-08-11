/**
 * Las reglas de lote que no necesitan base de datos.
 *
 * Tres módulos puros —`politicas`, `fefo` y la validación de `entrada`— que
 * concentran las decisiones de la fase: qué política admite qué, en qué orden
 * sale la mercadería, qué es vendible y qué reparto manual se acepta.
 *
 * Están acá y no en una prueba de integración por un motivo concreto: son
 * COMBINATORIAS. Tres políticas de lote por tres de vencimiento por partida
 * presente o ausente son dieciocho casos, y montarlos con una recepción real
 * cada uno costaría veinte segundos para probar lo mismo que una llamada a una
 * función pura prueba en un milisegundo.
 *
 * Lo que sí necesita base —que la recepción escriba lo que corresponde— está en
 * `tests/integration/lotes.test.ts`.
 */

import { describe, it, expect } from 'vitest'
import { cantidad as aCantidad } from '@/server/cantidad'
import { motivoDeLotesInvalidos, type ProductoParaEntrada } from '@/modules/lots/entrada'
import {
  motivoDeRepartoInvalido,
  ordenFEFO,
  repartir,
  separarVendible,
  totalDe,
  comoFechaDeBase,
  comoFechaLocal,
  type LoteDisponible,
} from '@/modules/lots/fefo'
import {
  diasHastaVencer,
  estadoDeVencimiento,
  normalizarCodigoDeLote,
  politicaDeLoteODefecto,
  politicaDeVencimientoODefecto,
} from '@/modules/lots/politicas'
import type { FechaLocal } from '@/lib/tiempo'

// ---------------------------------------------------------------------------
// Ayudantes
// ---------------------------------------------------------------------------

function lote(
  lotId: number,
  cantidad: string,
  vence: FechaLocal | null,
  estado: LoteDisponible['estado'] = 'OK',
): LoteDisponible {
  return {
    lotId,
    code: `L-${String(lotId)}`,
    expirationDate: vence,
    quantity: aCantidad(cantidad),
    dias: vence === null ? null : 10,
    estado,
  }
}

function producto(lotTracking: string, expirationTracking: string): ProductoParaEntrada {
  return { id: 1, name: 'Yogur', lotTracking, expirationTracking }
}

const c = (s: string) => aCantidad(s)

// ---------------------------------------------------------------------------
// Las tres políticas, y las nueve combinaciones
// ---------------------------------------------------------------------------

describe('Política de lote frente a lo que declara la recepción', () => {
  it('NONE sin partidas: pasa', () => {
    expect(motivoDeLotesInvalidos(producto('NONE', 'NONE'), undefined, c('10'))).toBeNull()
  })

  it('NONE CON partidas: se rechaza, y dice por qué', () => {
    const motivo = motivoDeLotesInvalidos(
      producto('NONE', 'NONE'),
      [{ code: 'A', quantity: '10.000' }],
      c('10'),
    )
    expect(motivo).toContain('no se sigue por lote')
  })

  it('OPTIONAL sin partidas: pasa. Es lo que significa opcional', () => {
    expect(motivoDeLotesInvalidos(producto('OPTIONAL', 'NONE'), undefined, c('10'))).toBeNull()
  })

  it('REQUIRED sin partidas: se rechaza', () => {
    const motivo = motivoDeLotesInvalidos(producto('REQUIRED', 'NONE'), undefined, c('10'))
    expect(motivo).toContain('hay que decir de qué partidas')
  })

  it('la suma tiene que cerrar EXACTA: todo o nada', () => {
    const motivo = motivoDeLotesInvalidos(
      producto('REQUIRED', 'NONE'),
      [{ code: 'A', quantity: '6.000' }],
      c('10'),
    )
    // El mensaje trae los DOS números: sin ellos, "no cierra" obliga a sumar a mano.
    expect(motivo).toContain('6.000')
    expect(motivo).toContain('10.000')
    expect(motivo).toContain('a medias')
  })

  it('dos partidas que suman lo recibido: pasa', () => {
    expect(
      motivoDeLotesInvalidos(
        producto('REQUIRED', 'NONE'),
        [
          { code: 'A', quantity: '6.000' },
          { code: 'B', quantity: '4.000' },
        ],
        c('10'),
      ),
    ).toBeNull()
  })

  it('la misma partida dos veces en la misma línea: se rechaza', () => {
    const motivo = motivoDeLotesInvalidos(
      producto('REQUIRED', 'NONE'),
      [
        { code: 'YG-1', quantity: '5.000' },
        // Mismo código con otra caja y espacios: se normaliza igual.
        { code: '  yg-1 ', quantity: '5.000' },
      ],
      c('10'),
    )
    expect(motivo).toContain('dos veces')
  })
})

describe('Política de vencimiento frente a la fecha declarada', () => {
  it('REQUIRED sin fecha: se rechaza, y nombra la partida', () => {
    const motivo = motivoDeLotesInvalidos(
      producto('REQUIRED', 'REQUIRED'),
      [{ code: 'YG-1', quantity: '10.000' }],
      c('10'),
    )
    expect(motivo).toContain('exige fecha de vencimiento')
    expect(motivo).toContain('YG-1')
  })

  it('NONE con fecha: también se rechaza', () => {
    // Es la mitad que se olvida. Un producto que no controla vencimiento y
    // recibe una fecha guardaría un dato que nadie va a mirar y que nadie va a
    // mantener: peor que no tenerlo.
    const motivo = motivoDeLotesInvalidos(
      producto('OPTIONAL', 'NONE'),
      [{ code: 'LV-1', quantity: '10.000', expirationDate: '2027-01-15' }],
      c('10'),
    )
    expect(motivo).toContain('no controla vencimiento')
  })

  it('OPTIONAL acepta con fecha y sin fecha', () => {
    const conFecha = motivoDeLotesInvalidos(
      producto('OPTIONAL', 'OPTIONAL'),
      [{ code: 'A', quantity: '10.000', expirationDate: '2027-01-15' }],
      c('10'),
    )
    const sinFecha = motivoDeLotesInvalidos(
      producto('OPTIONAL', 'OPTIONAL'),
      [{ code: 'A', quantity: '10.000' }],
      c('10'),
    )
    expect(conFecha).toBeNull()
    expect(sinFecha).toBeNull()
  })

  it('elaborada después de vencer: se rechaza', () => {
    const motivo = motivoDeLotesInvalidos(
      producto('OPTIONAL', 'OPTIONAL'),
      [
        {
          code: 'A',
          quantity: '10.000',
          expirationDate: '2026-01-15',
          manufacturedAt: '2026-06-01',
        },
      ],
      c('10'),
    )
    expect(motivo).toContain('elaborada después de su vencimiento')
  })
})

// ---------------------------------------------------------------------------
// FEFO
// ---------------------------------------------------------------------------

describe('El orden FEFO', () => {
  it('vence antes, sale antes', () => {
    const lista = [lote(1, '5', '2026-09-05'), lote(2, '3', '2026-08-18')]
    expect([...lista].sort(ordenFEFO).map((l) => l.lotId)).toEqual([2, 1])
  })

  it('lo que NO vence sale al final, no primero', () => {
    // Es la diferencia con FIFO, y la que decide el caso de la lavandina: una
    // partida sin fecha no es "urgente", es "no urgente nunca".
    const lista = [lote(1, '5', null), lote(2, '3', '2026-12-31')]
    expect([...lista].sort(ordenFEFO).map((l) => l.lotId)).toEqual([2, 1])
  })

  it('a igual fecha, el id decide: el orden es determinístico', () => {
    const misma = '2026-08-20' as FechaLocal
    const lista = [lote(9, '5', misma), lote(3, '3', misma), lote(7, '1', misma)]
    expect([...lista].sort(ordenFEFO).map((l) => l.lotId)).toEqual([3, 7, 9])
  })

  it('dos sin fecha también quedan en orden estable', () => {
    const lista = [lote(8, '5', null), lote(2, '3', null)]
    expect([...lista].sort(ordenFEFO).map((l) => l.lotId)).toEqual([2, 8])
  })
})

describe('Repartir una cantidad entre partidas', () => {
  it('el ejemplo del pedido: A tiene 3, B tiene 10, se venden 5', () => {
    const lista = [lote(1, '3', '2026-08-18'), lote(2, '10', '2026-09-05')]
    const reparto = repartir(lista, c('5'))

    expect(reparto).not.toBeNull()
    expect(reparto?.map((l) => [l.lotId, l.quantity.toString()])).toEqual([
      [1, '3'],
      [2, '2'],
    ])
  })

  it('cuando alcanza con la primera, no toca la segunda', () => {
    const lista = [lote(1, '10', '2026-08-18'), lote(2, '10', '2026-09-05')]
    expect(repartir(lista, c('4'))?.map((l) => l.lotId)).toEqual([1])
  })

  it('si NO alcanza devuelve null: no lanza y no reparte a medias', () => {
    // No lanza a propósito: quien llama tiene el nombre del producto y cuánto
    // había, y esta función no.
    const lista = [lote(1, '3', null), lote(2, '2', null)]
    expect(repartir(lista, c('10'))).toBeNull()
  })

  it('una partida en cero se saltea sin romper el reparto', () => {
    const lista = [lote(1, '0', '2026-08-01'), lote(2, '5', '2026-09-01')]
    expect(repartir(lista, c('3'))?.map((l) => l.lotId)).toEqual([2])
  })

  it('sumar las partidas de una lista', () => {
    expect(totalDe([lote(1, '3', null), lote(2, '4.5', null)]).toString()).toBe('7.5')
    expect(totalDe([]).toString()).toBe('0')
  })
})

describe('Vendible, vencido y disponible son TRES números', () => {
  it('el ejemplo del pedido: 10 en total, 7 vencidos, 3 vendibles', () => {
    const lista = [lote(1, '7', '2026-08-01', 'VENCIDO'), lote(2, '3', '2026-12-01')]
    const r = separarVendible(lista)

    expect(r.enLotes.toString()).toBe('10')
    expect(r.vencido.toString()).toBe('7')
    expect(r.vendible.toString()).toBe('3')
    // Y lo vencido NO entra en la lista que FEFO puede tomar.
    expect(r.lotes.map((l) => l.lotId)).toEqual([2])
  })

  it('sin nada vencido, vendible es todo', () => {
    const r = separarVendible([lote(1, '5', null), lote(2, '5', null)])
    expect(r.vencido.toString()).toBe('0')
    expect(r.vendible.toString()).toBe('10')
  })

  it('todo vencido: vendible es cero y la lista queda vacía', () => {
    const r = separarVendible([lote(1, '5', '2020-01-01', 'VENCIDO')])
    expect(r.vendible.toString()).toBe('0')
    expect(r.lotes).toEqual([])
  })
})

describe('El reparto elegido A MANO, comprobado por el servidor', () => {
  const disponibles = [lote(1, '10', '2026-09-01'), lote(2, '5', '2026-08-01', 'VENCIDO')]

  it('un reparto legítimo pasa', () => {
    expect(
      motivoDeRepartoInvalido(disponibles, [{ lotId: 1, quantity: c('4') }], c('4')),
    ).toBeNull()
  })

  it('vacío se rechaza', () => {
    expect(motivoDeRepartoInvalido(disponibles, [], c('4'))).toContain('ninguna línea')
  })

  it('el mismo lote dos veces se rechaza', () => {
    const motivo = motivoDeRepartoInvalido(
      disponibles,
      [
        { lotId: 1, quantity: c('2') },
        { lotId: 1, quantity: c('2') },
      ],
      c('4'),
    )
    expect(motivo).toContain('dos veces')
  })

  it('una cantidad de cero se rechaza', () => {
    expect(
      motivoDeRepartoInvalido(disponibles, [{ lotId: 1, quantity: c('0') }], c('0')),
    ).toContain('cantidad positiva')
  })

  it('un lote que no existe se rechaza', () => {
    expect(
      motivoDeRepartoInvalido(disponibles, [{ lotId: 99, quantity: c('1') }], c('1')),
    ).toContain('no tiene unidades disponibles')
  })

  it('un lote VENCIDO se rechaza aunque tenga unidades', () => {
    // El servidor no le cree al navegador: la pantalla no ofrece los vencidos,
    // pero eso no es una garantía.
    const motivo = motivoDeRepartoInvalido(disponibles, [{ lotId: 2, quantity: c('1') }], c('1'))
    expect(motivo).toContain('vencido')
  })

  it('pedir más de lo que tiene la partida se rechaza, con los dos números', () => {
    const motivo = motivoDeRepartoInvalido(disponibles, [{ lotId: 1, quantity: c('30') }], c('30'))
    expect(motivo).toContain('10.000')
    expect(motivo).toContain('30.000')
  })

  it('un reparto que no suma la cantidad pedida se rechaza', () => {
    const motivo = motivoDeRepartoInvalido(disponibles, [{ lotId: 1, quantity: c('3') }], c('5'))
    expect(motivo).toContain('3.000')
    expect(motivo).toContain('5.000')
  })
})

// ---------------------------------------------------------------------------
// Fechas: el error que las Fases 3C, 3D y 4A tuvieron que arreglar
// ---------------------------------------------------------------------------

describe('El vencimiento es una fecha de calendario, no un instante', () => {
  it('ida y vuelta sin correrse un día', () => {
    const original = '2026-08-18' as FechaLocal
    expect(comoFechaLocal(comoFechaDeBase(original))).toBe(original)
  })

  it('una columna DATE se lee por sus componentes UTC', () => {
    // Medianoche UTC es las 21:00 del día ANTERIOR en Argentina: leerla con
    // `getDate()` daría el 17.
    expect(comoFechaLocal(new Date('2026-08-18T00:00:00.000Z'))).toBe('2026-08-18')
  })

  it('null sigue siendo null', () => {
    expect(comoFechaLocal(null)).toBeNull()
  })
})

describe('Días hasta vencer, y el estado que se muestra', () => {
  it('vence hoy es CERO días, no uno', () => {
    // `cantidadDeDias` cuenta días INCLUSIVOS, así que hay que restar uno. Un
    // producto que vence hoy tiene que decir "vence hoy" y no "vence mañana".
    expect(diasHastaVencer('2026-08-11', '2026-08-11')).toBe(0)
  })

  it('ayer es negativo', () => {
    expect(diasHastaVencer('2026-08-11', '2026-08-10')).toBe(-1)
  })

  it('sin fecha no hay días', () => {
    expect(diasHastaVencer('2026-08-11', null)).toBeNull()
  })

  it('cada tramo tiene su estado, y los bordes caen del lado correcto', () => {
    expect(estadoDeVencimiento(-1)).toBe('VENCIDO')
    expect(estadoDeVencimiento(0)).toBe('VENCE_HOY')
    expect(estadoDeVencimiento(1)).toBe('SIETE_DIAS')
    expect(estadoDeVencimiento(7)).toBe('SIETE_DIAS')
    expect(estadoDeVencimiento(8)).toBe('TREINTA_DIAS')
    expect(estadoDeVencimiento(30)).toBe('TREINTA_DIAS')
    expect(estadoDeVencimiento(31)).toBe('OK')
    expect(estadoDeVencimiento(null)).toBe('SIN_FECHA')
  })
})

describe('Normalización del código de partida', () => {
  it('mayúsculas y espacios colapsados', () => {
    expect(normalizarCodigoDeLote('  yg-260801  ')).toBe('YG-260801')
    expect(normalizarCodigoDeLote('lote   a  1')).toBe('LOTE A 1')
  })

  it('es la misma que aplica el CHECK de la base', () => {
    // Si las dos se separan, el servidor escribe filas que la base rechaza.
    // La restricción hace `upper(regexp_replace(btrim(code), '\\s+', ' ', 'g'))`.
    for (const crudo of ['  a b  ', 'YG-1', 'yg 1', 'X_9/2-b']) {
      const normalizado = normalizarCodigoDeLote(crudo)
      expect(normalizado).toBe(crudo.trim().replace(/\s+/g, ' ').toUpperCase())
    }
  })
})

describe('Una política desconocida cae en la más restrictiva', () => {
  it('lo que no está en el catálogo es NONE, no un error', () => {
    // Una fila con un valor que el catálogo no conoce --de una migración a
    // medias, de una restauración vieja-- no puede tumbar la pantalla. Se lee
    // como "sin rastreo", que es el comportamiento anterior a la fase.
    expect(politicaDeLoteODefecto('CUALQUIERA')).toBe('NONE')
    expect(politicaDeLoteODefecto(null)).toBe('NONE')
    expect(politicaDeLoteODefecto(undefined)).toBe('NONE')
    expect(politicaDeVencimientoODefecto('OTRA')).toBe('NONE')
    expect(politicaDeLoteODefecto('REQUIRED')).toBe('REQUIRED')
  })
})
