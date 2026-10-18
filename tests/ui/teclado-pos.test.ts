/**
 * La gramatica de teclado del punto de venta, tecla por tecla. UX V3.
 *
 * Es una funcion pura: no hace falta montar la pantalla para comprobar que
 * ← mueva el cursor mientras se escribe, que Enter no cobre desde el campo, y
 * que Supr solo quite con una linea a la vista.
 *
 * Las tres zonas y por que existen estan en `teclado.ts`. Lo que se prueba
 * aca es la tabla completa, incluidos los casos que la V2 hacia mal.
 */

import { describe, it, expect } from 'vitest'
import {
  accionDeTecla,
  esTeclaDeGrilla,
  modoDelCampo,
  moverEnGrilla,
  moverResaltado,
  moverSeleccion,
  seleccionTrasQuitar,
  type ContextoDelPos,
} from '@/components/venta/teclado'

/** Escribiendo, sin nada elegido y con el ticket vacio. */
const CAMPO: ContextoDelPos = {
  zona: 'campo',
  texto: '',
  hayLineas: false,
  haySeleccion: false,
  hayResultados: false,
  resaltado: 0,
  hayAviso: false,
}

/** Escribiendo "coca", con resultados a la vista. */
const ESCRIBIENDO: ContextoDelPos = { ...CAMPO, texto: 'coca', hayResultados: true }

/** Con una fila elegida --se apreto ↓--, todavia con "coca" escrito. */
const ELIGIENDO: ContextoDelPos = { ...ESCRIBIENDO, zona: 'lista', resaltado: 1 }

/** Revisando el ticket, con una linea elegida. */
const REVISANDO: ContextoDelPos = {
  ...CAMPO,
  zona: 'ticket',
  hayLineas: true,
  haySeleccion: true,
  hayResultados: true,
}

describe('Que es lo que hay escrito', () => {
  it('nada, un codigo o una busqueda', () => {
    expect(modoDelCampo('')).toBe('vacio')
    expect(modoDelCampo('   ')).toBe('vacio')
    expect(modoDelCampo('7790001000011')).toBe('codigo')
    expect(modoDelCampo('yerba')).toBe('busqueda')
    // Una letra entre digitos ya no es un codigo de barras; un espacio, si.
    expect(modoDelCampo('77900a')).toBe('busqueda')
    expect(modoDelCampo('779 12 34')).toBe('codigo')
  })
})

describe('Escribiendo: las flechas horizontales son del cursor', () => {
  it('← y → no tocan cantidades mientras se escribe, ni con ticket ni con seleccion', () => {
    // El caso que la V2 hacia mal: con el ticket armado, corregir "coca colaa"
    // era imposible porque ← restaba una unidad.
    const conTicket: ContextoDelPos = {
      ...ESCRIBIENDO,
      texto: 'coca colaa',
      hayLineas: true,
      haySeleccion: true,
    }
    expect(accionDeTecla('ArrowLeft', conTicket)).toBe('nada')
    expect(accionDeTecla('ArrowRight', conTicket)).toBe('nada')
  })

  it('tampoco con el campo vacio: sin nada elegido no hay a que sumarle', () => {
    const vacioConTicket: ContextoDelPos = { ...CAMPO, hayLineas: true, hayResultados: true }
    expect(accionDeTecla('ArrowLeft', vacioConTicket)).toBe('nada')
    expect(accionDeTecla('ArrowRight', vacioConTicket)).toBe('nada')
  })

  it('↓ es lo unico que saca del texto, y solo si hay lista', () => {
    expect(accionDeTecla('ArrowDown', ESCRIBIENDO)).toBe('entrar-a-la-lista')
    expect(accionDeTecla('ArrowDown', { ...CAMPO, hayResultados: true })).toBe('entrar-a-la-lista')
    expect(accionDeTecla('ArrowDown', CAMPO)).toBe('nada')
  })

  it('↑ no hace nada: se entra a la lista por abajo', () => {
    expect(accionDeTecla('ArrowUp', ESCRIBIENDO)).toBe('nada')
  })

  it('Supr borra texto, no lineas', () => {
    const conTicket: ContextoDelPos = { ...ESCRIBIENDO, hayLineas: true, haySeleccion: true }
    expect(accionDeTecla('Delete', conTicket)).toBe('nada')
  })
})

describe('Eligiendo un producto de la lista', () => {
  it('↑ y ↓ recorren; desde la primera, ↑ devuelve el mando al texto', () => {
    expect(accionDeTecla('ArrowDown', ELIGIENDO)).toBe('resultado-siguiente')
    expect(accionDeTecla('ArrowUp', ELIGIENDO)).toBe('resultado-anterior')
    expect(accionDeTecla('ArrowUp', { ...ELIGIENDO, resaltado: 0 })).toBe('volver-al-campo')
  })

  // V5: las flechas SOLO se mueven. En la V3, → sumaba una unidad y el Enter
  // de despues volvia a sumar: "→ y Enter" dejaba dos unidades.
  it('→ y ← tambien recorren: NUNCA cambian una cantidad', () => {
    expect(accionDeTecla('ArrowRight', ELIGIENDO)).toBe('resultado-siguiente')
    expect(accionDeTecla('ArrowLeft', ELIGIENDO)).toBe('resultado-anterior')
    expect(accionDeTecla('ArrowLeft', { ...ELIGIENDO, resaltado: 0 })).toBe('nada')
    for (const flecha of ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'] as const) {
      expect(accionDeTecla(flecha, ELIGIENDO)).not.toBe('sumar-resaltado')
      expect(accionDeTecla(flecha, ELIGIENDO)).not.toBe('restar-resaltado')
    }
  })

  it('Enter ELIGE el producto marcado (no es "+1")', () => {
    expect(accionDeTecla('Enter', ELIGIENDO)).toBe('elegir-resaltado')
  })

  it('Escape suelta la fila; el texto escrito no se pierde', () => {
    expect(accionDeTecla('Escape', ELIGIENDO)).toBe('volver-al-campo')
  })

  it('sin filas, las flechas no hacen nada', () => {
    expect(accionDeTecla('ArrowRight', { ...ELIGIENDO, hayResultados: false })).toBe('nada')
  })
})

describe('Enter no cobra: primero revisar', () => {
  it('con digitos busca el codigo', () => {
    expect(accionDeTecla('Enter', { ...CAMPO, texto: '7790001000011' })).toBe('buscar-codigo')
  })

  it('con letras elige el primer resultado, si hay', () => {
    expect(accionDeTecla('Enter', ESCRIBIENDO)).toBe('elegir-resaltado')
    expect(accionDeTecla('Enter', { ...CAMPO, texto: 'zzz' })).toBe('nada')
  })

  it('con el campo vacio y ticket pasa a revisar, NO al cobro', () => {
    const accion = accionDeTecla('Enter', { ...CAMPO, hayLineas: true })
    expect(accion).toBe('revisar-ticket')
    expect(accion).not.toBe('cobrar')
  })

  it('con el ticket vacio no hace nada', () => {
    expect(accionDeTecla('Enter', CAMPO)).toBe('nada')
  })

  it('recien el segundo Enter --ya revisando-- abre el cobro', () => {
    expect(accionDeTecla('Enter', REVISANDO)).toBe('cobrar')
  })
})

describe('Revisando el ticket', () => {
  it('↑ y ↓ eligen linea', () => {
    expect(accionDeTecla('ArrowDown', REVISANDO)).toBe('linea-siguiente')
    expect(accionDeTecla('ArrowUp', REVISANDO)).toBe('linea-anterior')
  })

  it('← y → tambien eligen linea; la cantidad se cambia con + y -', () => {
    expect(accionDeTecla('ArrowRight', REVISANDO)).toBe('linea-siguiente')
    expect(accionDeTecla('ArrowLeft', REVISANDO)).toBe('linea-anterior')
    expect(accionDeTecla('+', REVISANDO)).toBe('cantidad-mas')
    expect(accionDeTecla('-', REVISANDO)).toBe('cantidad-menos')
  })

  it('sin linea elegida, + y - no hacen nada', () => {
    expect(accionDeTecla('+', { ...REVISANDO, haySeleccion: false })).toBe('nada')
    expect(accionDeTecla('-', { ...REVISANDO, haySeleccion: false })).toBe('nada')
  })

  it('Supr quita la linea elegida, y solo esa', () => {
    expect(accionDeTecla('Delete', REVISANDO)).toBe('quitar-linea')
    expect(accionDeTecla('Delete', { ...REVISANDO, haySeleccion: false })).toBe('nada')
  })

  it('Escape vuelve al campo', () => {
    expect(accionDeTecla('Escape', REVISANDO)).toBe('volver-al-campo')
  })

  it('↑ NUNCA cambia la cantidad', () => {
    expect(accionDeTecla('ArrowUp', REVISANDO)).not.toBe('cantidad-mas')
    expect(accionDeTecla('ArrowDown', REVISANDO)).not.toBe('cantidad-menos')
  })
})

describe('Las teclas + y −: la unica forma de cambiar una cantidad con el teclado', () => {
  it('sobre una fila elegida de la lista, suman o restan ese producto', () => {
    expect(accionDeTecla('+', { ...ELIGIENDO, texto: '' })).toBe('sumar-resaltado')
    expect(accionDeTecla('-', { ...ELIGIENDO, texto: '' })).toBe('restar-resaltado')
  })

  it('con el campo vacio, corrigen la linea elegida del ticket (la ultima agregada)', () => {
    const conLinea: ContextoDelPos = { ...CAMPO, hayLineas: true, haySeleccion: true }
    expect(accionDeTecla('+', conLinea)).toBe('cantidad-mas')
    expect(accionDeTecla('-', conLinea)).toBe('cantidad-menos')
    expect(accionDeTecla('+', { ...conLinea, haySeleccion: false })).toBe('nada')
  })

  it('pero NO mientras se escribe: en "coca-cola" el guion es una letra', () => {
    expect(accionDeTecla('-', ELIGIENDO)).toBe('nada')
    expect(accionDeTecla('+', ELIGIENDO)).toBe('nada')
    expect(accionDeTecla('-', ESCRIBIENDO)).toBe('nada')
  })
})

describe('Escape, un paso por vez', () => {
  it('primero suelta lo elegido, despues limpia el campo, despues cierra el aviso', () => {
    expect(accionDeTecla('Escape', ELIGIENDO)).toBe('volver-al-campo')
    expect(accionDeTecla('Escape', ESCRIBIENDO)).toBe('limpiar-campo')
    expect(accionDeTecla('Escape', { ...CAMPO, hayAviso: true })).toBe('cerrar-aviso')
    expect(accionDeTecla('Escape', CAMPO)).toBe('nada')
  })
})

describe('Donde queda lo elegido', () => {
  const IDS = [10, 20, 30]

  it('la fila de la lista no da la vuelta en los bordes', () => {
    expect(moverResaltado(0, 1, 3)).toBe(1)
    expect(moverResaltado(2, 1, 3)).toBe(2)
    expect(moverResaltado(0, -1, 3)).toBe(0)
    expect(moverResaltado(9, -1, 3)).toBe(1)
    expect(moverResaltado(0, 1, 0)).toBe(-1)
  })

  it('sin seleccion, abajo elige la primera linea y arriba la ultima', () => {
    expect(moverSeleccion(IDS, null, 1)).toBe(10)
    expect(moverSeleccion(IDS, null, -1)).toBe(30)
  })

  it('en los bordes no da la vuelta', () => {
    expect(moverSeleccion(IDS, 30, 1)).toBe(30)
    expect(moverSeleccion(IDS, 10, -1)).toBe(10)
    expect(moverSeleccion(IDS, 10, 1)).toBe(20)
  })

  it('sin lineas no hay seleccion', () => {
    expect(moverSeleccion([], null, 1)).toBeNull()
  })

  it('al quitar, pasa a la que ocupaba su lugar; si era la ultima, a la anterior', () => {
    expect(seleccionTrasQuitar(IDS, 20)).toBe(30)
    expect(seleccionTrasQuitar(IDS, 30)).toBe(20)
    expect(seleccionTrasQuitar(IDS, 10)).toBe(20)
    expect(seleccionTrasQuitar([10], 10)).toBeNull()
  })
})

describe('El foco real dentro de la lista', () => {
  // Siete tarjetas en tres columnas: dos filas enteras y una de una sola.
  //   0 1 2
  //   3 4 5
  //   6
  const T = 7
  const C = 3

  it('izquierda y derecha van de a una, sin dar la vuelta', () => {
    expect(moverEnGrilla(0, 'ArrowRight', T, C)).toBe(1)
    expect(moverEnGrilla(1, 'ArrowLeft', T, C)).toBe(0)
    expect(moverEnGrilla(0, 'ArrowLeft', T, C)).toBe(0)
    expect(moverEnGrilla(6, 'ArrowRight', T, C)).toBe(6)
  })

  it('arriba y abajo van de a una fila', () => {
    expect(moverEnGrilla(0, 'ArrowDown', T, C)).toBe(3)
    expect(moverEnGrilla(3, 'ArrowDown', T, C)).toBe(6)
    expect(moverEnGrilla(4, 'ArrowUp', T, C)).toBe(1)
    expect(moverEnGrilla(1, 'ArrowUp', T, C)).toBe(1)
  })

  it('bajar desde una fila incompleta lleva a la ultima tarjeta', () => {
    expect(moverEnGrilla(4, 'ArrowDown', T, C)).toBe(6)
    expect(moverEnGrilla(5, 'ArrowDown', T, C)).toBe(6)
    expect(moverEnGrilla(6, 'ArrowDown', T, C)).toBe(6)
  })

  it('en una sola columna las cuatro flechas mueven de a una fila', () => {
    expect(moverEnGrilla(3, 'ArrowDown', T, 1)).toBe(4)
    expect(moverEnGrilla(3, 'ArrowUp', T, 1)).toBe(2)
  })

  it('Inicio y Fin van a los extremos; sin tarjetas no hay foco', () => {
    expect(moverEnGrilla(4, 'Home', T, C)).toBe(0)
    expect(moverEnGrilla(0, 'End', T, C)).toBe(6)
    expect(moverEnGrilla(0, 'ArrowDown', 0, C)).toBe(-1)
  })

  it('un indice fuera de rango se acota antes de moverse', () => {
    expect(moverEnGrilla(99, 'ArrowLeft', T, C)).toBe(5)
    expect(moverEnGrilla(-5, 'ArrowRight', T, C)).toBe(1)
  })

  it('sabe cuales son sus teclas', () => {
    expect(esTeclaDeGrilla('ArrowDown')).toBe(true)
    expect(esTeclaDeGrilla('Enter')).toBe(false)
  })
})
