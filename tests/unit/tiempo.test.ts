/**
 * El dia comercial.
 *
 * Estas pruebas existen por un error concreto: hasta la Fase 3C el rango del
 * dia se armaba en UTC y **toda venta posterior a las 21:00 desaparecia de su
 * dia**. Los casos de borde de abajo son exactamente ese error y sus vecinos.
 *
 * Ver docs/TIMEZONE_POLICY.md.
 */

import { describe, it, expect } from 'vitest'
import {
  ZONA_POR_DEFECTO,
  cantidadDeDias,
  diaDe,
  esFechaLocal,
  esZonaValida,
  finDelDia,
  hoyEn,
  inicioDelDia,
  rangoDeDias,
  sumarDias,
} from '@/lib/tiempo'

const AR = ZONA_POR_DEFECTO

describe('Los limites del dia en Buenos Aires', () => {
  it('el dia empieza a las 03:00 UTC y termina a las 02:59:59.999 del siguiente', () => {
    expect(inicioDelDia('2026-08-10', AR).toISOString()).toBe('2026-08-10T03:00:00.000Z')
    expect(finDelDia('2026-08-10', AR).toISOString()).toBe('2026-08-11T02:59:59.999Z')
  })

  /**
   * LOS CASOS DE BORDE DEL PEDIDO.
   *
   * Cada hora local se convierte al instante que le corresponde y se pregunta a
   * que dia pertenece. Con la convencion vieja --medianoche UTC-- las dos
   * ultimas habrian dado el dia siguiente.
   */
  const HORAS: Array<{ local: string; utc: string; dia: string }> = [
    { local: '00:00 del 10', utc: '2026-08-10T03:00:00.000Z', dia: '2026-08-10' },
    { local: '20:59 del 10', utc: '2026-08-10T23:59:00.000Z', dia: '2026-08-10' },
    { local: '21:00 del 10', utc: '2026-08-11T00:00:00.000Z', dia: '2026-08-10' },
    { local: '23:59 del 10', utc: '2026-08-11T02:59:00.000Z', dia: '2026-08-10' },
    { local: '00:00 del 11', utc: '2026-08-11T03:00:00.000Z', dia: '2026-08-11' },
  ]

  it.each(HORAS)('las $local pertenecen al $dia', ({ utc, dia }) => {
    expect(diaDe(new Date(utc), AR)).toBe(dia)
  })

  it('una venta de las 21:00 cae DENTRO del rango de su dia', () => {
    // Es el error de la Fase 3C, escrito como prueba. Con `T00:00:00Z` este
    // instante quedaba fuera del rango del 10 y aparecia en el del 11.
    const venta = new Date('2026-08-11T00:00:00.000Z') // 21:00 del 10, hora local
    const { desde, hasta } = rangoDeDias('2026-08-10', '2026-08-10', AR)

    expect(venta >= desde && venta <= hasta, 'la venta de las 21:00 se perdio').toBe(true)
  })

  it('una venta de las 23:59:59.999 todavia entra; la de las 00:00 ya no', () => {
    const { desde, hasta } = rangoDeDias('2026-08-10', '2026-08-10', AR)

    const ultimoInstante = new Date('2026-08-11T02:59:59.999Z')
    const primeroDelSiguiente = new Date('2026-08-11T03:00:00.000Z')

    expect(ultimoInstante <= hasta).toBe(true)
    expect(primeroDelSiguiente > hasta).toBe(true)
    expect(primeroDelSiguiente >= desde).toBe(true)
  })

  it('un rango de varios dias cubre los dos extremos completos', () => {
    const { desde, hasta } = rangoDeDias('2026-08-01', '2026-08-31', AR)
    expect(desde.toISOString()).toBe('2026-08-01T03:00:00.000Z')
    expect(hasta.toISOString()).toBe('2026-09-01T02:59:59.999Z')
  })
})

describe('La zona es una REGLA, no un numero', () => {
  it('diciembre de 2008 usa el horario de verano que regia entonces', () => {
    // Argentina tuvo horario de verano entre 2007 y 2009: UTC-2, no UTC-3.
    // Con un desfase fijo guardado en la base, todo ese verano quedaria corrido
    // una hora y no habria forma de arreglarlo despues.
    expect(inicioDelDia('2008-12-15', AR).toISOString()).toBe('2008-12-15T02:00:00.000Z')
    expect(finDelDia('2008-12-15', AR).toISOString()).toBe('2008-12-16T01:59:59.999Z')
  })

  it('un dia con cambio de horario dura 23 horas', () => {
    // Chile adelanta el reloj el primer domingo de septiembre: el 2026-09-06 a
    // las 00:00 el reloj salta a la 01:00, asi que las 00:00 de ese dia no
    // ocurrieron nunca y el dia dura 23 horas.
    const inicio = inicioDelDia('2026-09-06', 'America/Santiago')
    const fin = finDelDia('2026-09-06', 'America/Santiago')

    // Empieza cuando el dia empezo DE VERDAD: la 01:00, no las 00:00.
    expect(inicio.toISOString()).toBe('2026-09-06T04:00:00.000Z')
    expect((fin.getTime() - inicio.getTime() + 1) / 3_600_000).toBe(23)
  })

  it('los dias embaldosan la linea de tiempo: sin huecos y sin solapes', () => {
    // ES LA PROPIEDAD QUE IMPORTA, y la que estaba rota antes de esta prueba.
    //
    // Calculando el fin del dia por separado --"las 23:59:59.999 de este"-- el
    // 5 de septiembre en Santiago terminaba a las 03:59:59.999Z del 6 y el 6
    // empezaba a las 03:00:00Z: esa hora quedaba contada en LOS DOS DIAS, y una
    // venta hecha ahi aparecia dos veces. Definir el fin como un milisegundo
    // antes del inicio siguiente lo vuelve imposible por construccion.
    for (const zona of ['America/Santiago', 'America/Argentina/Buenos_Aires', 'Europe/Madrid']) {
      let dia = '2026-09-01'
      for (let i = 0; i < 40; i++) {
        const siguiente = sumarDias(dia, 1)
        expect(
          finDelDia(dia, zona).getTime() + 1,
          `${zona}: hueco o solape entre ${dia} y ${siguiente}`,
        ).toBe(inicioDelDia(siguiente, zona).getTime())
        dia = siguiente
      }
    }
  })

  it('ningun instante queda sin dia ni pertenece a dos', () => {
    // La otra cara de lo mismo, comprobada al reves: se recorre hora por hora
    // el cambio de horario y se exige que cada instante caiga en el rango de
    // exactamente un dia.
    const zona = 'America/Santiago'
    const dias = ['2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07']
    const rangos = dias.map((d) => rangoDeDias(d, d, zona))

    let t = inicioDelDia('2026-09-04', zona).getTime()
    const fin = finDelDia('2026-09-07', zona).getTime()
    while (t <= fin) {
      const instante = new Date(t)
      const cuantos = rangos.filter((r) => instante >= r.desde && instante <= r.hasta).length
      expect(cuantos, `${instante.toISOString()} pertenece a ${String(cuantos)} dias`).toBe(1)
      t += 900_000 // cada 15 minutos
    }
  })

  it('rechaza los desfases fijos y acepta los identificadores IANA', () => {
    for (const malo of ['UTC-3', 'GMT+3', '-03:00', '', 'Marte/Olympus']) {
      expect(esZonaValida(malo), `"${malo}" no deberia valer`).toBe(false)
    }
    for (const bueno of [AR, 'America/Santiago', 'Europe/Madrid', 'UTC']) {
      expect(esZonaValida(bueno), `"${bueno}" deberia valer`).toBe(true)
    }
  })
})

describe('Aritmetica de calendario', () => {
  it('sumarDias cruza fin de mes y anio bisiesto', () => {
    expect(sumarDias('2026-02-28', 1)).toBe('2026-03-01')
    expect(sumarDias('2024-02-28', 1)).toBe('2024-02-29')
    expect(sumarDias('2026-01-01', -1)).toBe('2025-12-31')
    expect(sumarDias('2026-08-10', -6)).toBe('2026-08-04')
  })

  it('cantidadDeDias cuenta los dos extremos y no divide milisegundos', () => {
    expect(cantidadDeDias('2026-08-10', '2026-08-10')).toBe(1)
    expect(cantidadDeDias('2026-08-01', '2026-08-31')).toBe(31)
    expect(cantidadDeDias('2026-01-01', '2026-12-31')).toBe(365)
    // Un mes que cruza un cambio de horario tiene un dia de 23 horas: la
    // division de milisegundos daria 30,96 y esto tiene que dar 31.
    expect(cantidadDeDias('2026-09-01', '2026-10-01')).toBe(31)
  })

  it('esFechaLocal rechaza lo que no es una fecha de calendario', () => {
    for (const buena of ['2026-08-10', '2024-02-29', '2026-12-31']) {
      expect(esFechaLocal(buena), buena).toBe(true)
    }
    for (const mala of ['2026-02-31', '2026-13-01', '2026-8-1', '10/08/2026', '', 'hoy']) {
      expect(esFechaLocal(mala), mala).toBe(false)
    }
  })

  it('hoyEn devuelve el dia del LOCAL, no el del proceso', () => {
    // A las 23:30 de Buenos Aires ya es el dia siguiente en Madrid.
    const instante = new Date('2026-08-11T02:30:00.000Z')
    expect(hoyEn(AR, instante)).toBe('2026-08-10')
    expect(hoyEn('Europe/Madrid', instante)).toBe('2026-08-11')
  })
})
