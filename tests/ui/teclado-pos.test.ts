/**
 * La gramatica de teclado del punto de venta, tecla por tecla. V6.
 *
 * Es una funcion pura: no hace falta montar la pantalla para comprobar que
 * en productos ↑ ↓ solo elijan y ← → solo cambien cantidades, que Enter
 * avance una etapa y nunca sume, y que el Enter del lector agregue sin
 * cambiar de etapa.
 *
 * Las tres etapas y por que existen estan en `teclado.ts`. Lo que se prueba
 * aca es la tabla completa. Las pruebas de la V5 que decian lo contrario
 * --"→ y ← NUNCA cambian una cantidad", "Enter ELIGE el producto"-- se
 * reescribieron a proposito: la gramatica cambio por pedido del dueño.
 */

import { describe, it, expect } from 'vitest'
import {
  PAUSA_ENTRE_ETAPAS_MS,
  accionDeTecla,
  enterAvanza,
  esRepeticionIgnorada,
  esTeclaDeGrilla,
  esTeclaReservada,
  modoDelCampo,
  moverEnGrilla,
  moverResaltado,
  moverSeleccion,
  seleccionTrasQuitar,
  type ContextoDelPos,
} from '@/components/venta/teclado'

/** Productos, sin nada escrito, sin nada elegido y con el carrito vacio. */
const INICIO: ContextoDelPos = {
  etapa: 'productos',
  texto: '',
  hayLineas: false,
  haySeleccion: false,
  hayResultados: true,
  hayProductoElegido: false,
  hayAviso: false,
}

/** Escribiendo "coca": el primer resultado queda elegido solo. */
const BUSCANDO: ContextoDelPos = { ...INICIO, texto: 'coca', hayProductoElegido: true }

/** Con un producto elegido con ↑ ↓ y algo en el carrito. */
const ELIGIENDO: ContextoDelPos = {
  ...INICIO,
  hayProductoElegido: true,
  hayLineas: true,
  haySeleccion: true,
}

/** Revisando el carrito, con una linea elegida. */
const CARRITO: ContextoDelPos = {
  ...INICIO,
  etapa: 'carrito',
  hayLineas: true,
  haySeleccion: true,
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

describe('Etapa 1, productos: cada eje tiene una sola responsabilidad', () => {
  it('↑ ↓ eligen el producto anterior y el siguiente (caso 2)', () => {
    expect(accionDeTecla('ArrowUp', ELIGIENDO)).toBe('producto-anterior')
    expect(accionDeTecla('ArrowDown', ELIGIENDO)).toBe('producto-siguiente')
    // Tambien sin nada elegido: la primera flecha elige.
    expect(accionDeTecla('ArrowDown', INICIO)).toBe('producto-siguiente')
  })

  it('↑ ↓ NUNCA cambian una cantidad', () => {
    for (const ctx of [INICIO, BUSCANDO, ELIGIENDO]) {
      for (const flecha of ['ArrowUp', 'ArrowDown'] as const) {
        expect(accionDeTecla(flecha, ctx)).not.toMatch(/sumar|restar/)
      }
    }
  })

  it('→ suma una unidad del elegido y ← resta una (casos 3 a 5)', () => {
    expect(accionDeTecla('ArrowRight', ELIGIENDO)).toBe('sumar-producto')
    expect(accionDeTecla('ArrowLeft', ELIGIENDO)).toBe('restar-producto')
  })

  it('→ y ← NUNCA mueven la seleccion de productos', () => {
    for (const ctx of [INICIO, BUSCANDO, ELIGIENDO]) {
      for (const flecha of ['ArrowRight', 'ArrowLeft'] as const) {
        expect(accionDeTecla(flecha, ctx)).not.toMatch(/anterior|siguiente/)
      }
    }
  })

  it('escribiendo un nombre, → agrega el primer resultado: el que se ve elegido', () => {
    expect(accionDeTecla('ArrowRight', BUSCANDO)).toBe('sumar-producto')
  })

  it('sin producto elegido, → y ← no hacen nada: no se agrega lo que nadie eligio', () => {
    expect(accionDeTecla('ArrowRight', INICIO)).toBe('nada')
    expect(accionDeTecla('ArrowLeft', INICIO)).toBe('nada')
  })

  it('sin filas, ↑ ↓ no hacen nada', () => {
    const vacia: ContextoDelPos = { ...INICIO, hayResultados: false }
    expect(accionDeTecla('ArrowDown', vacia)).toBe('nada')
    expect(accionDeTecla('ArrowUp', vacia)).toBe('nada')
  })

  it('Enter pasa al carrito y NO suma ni resta (caso 7)', () => {
    expect(accionDeTecla('Enter', ELIGIENDO)).toBe('ir-al-carrito')
    // Tambien con un nombre escrito: Enter ya no "elige" ni agrega.
    expect(accionDeTecla('Enter', { ...BUSCANDO, hayLineas: true })).toBe('ir-al-carrito')
    for (const ctx of [INICIO, BUSCANDO, ELIGIENDO]) {
      expect(accionDeTecla('Enter', ctx)).not.toMatch(/sumar|restar/)
    }
  })

  it('Enter con el carrito vacio no avanza: avisa', () => {
    expect(accionDeTecla('Enter', INICIO)).toBe('carrito-vacio')
    expect(accionDeTecla('Enter', BUSCANDO)).toBe('carrito-vacio')
  })

  it('Supr no quita lineas en productos: ahi borra texto', () => {
    expect(accionDeTecla('Delete', ELIGIENDO)).toBe('nada')
  })
})

describe('El Enter del lector: agrega y no cambia de etapa (casos 13 y 14)', () => {
  it('con digitos, Enter es un codigo en productos', () => {
    expect(accionDeTecla('Enter', { ...INICIO, texto: '7790001000011' })).toBe('buscar-codigo')
    expect(accionDeTecla('Enter', { ...ELIGIENDO, texto: '7790001000011' })).toBe('buscar-codigo')
  })

  it('y tambien en el carrito: leer un producto no abre el cobro', () => {
    expect(accionDeTecla('Enter', { ...CARRITO, texto: '7790001000011' })).toBe('buscar-codigo')
  })
})

describe('Esc en productos (caso de la busqueda)', () => {
  it('con texto, limpia la busqueda y sigue en productos', () => {
    expect(accionDeTecla('Escape', BUSCANDO)).toBe('limpiar-busqueda')
    expect(accionDeTecla('Escape', { ...INICIO, texto: '123' })).toBe('limpiar-busqueda')
  })

  it('sin texto: cierra el aviso, despues suelta el elegido, despues nada', () => {
    expect(accionDeTecla('Escape', { ...ELIGIENDO, hayAviso: true })).toBe('cerrar-aviso')
    expect(accionDeTecla('Escape', ELIGIENDO)).toBe('soltar-producto')
    expect(accionDeTecla('Escape', INICIO)).toBe('nada')
  })

  it('nunca toca el carrito', () => {
    for (const ctx of [INICIO, BUSCANDO, ELIGIENDO]) {
      expect(accionDeTecla('Escape', ctx)).not.toMatch(/linea|cobro/)
    }
  })
})

describe('Etapa 2, carrito', () => {
  it('↑ ↓ eligen linea (caso 8)', () => {
    expect(accionDeTecla('ArrowDown', CARRITO)).toBe('linea-siguiente')
    expect(accionDeTecla('ArrowUp', CARRITO)).toBe('linea-anterior')
  })

  it('→ y ← cambian la cantidad de la linea elegida de a una (caso 9)', () => {
    expect(accionDeTecla('ArrowRight', CARRITO)).toBe('sumar-linea')
    expect(accionDeTecla('ArrowLeft', CARRITO)).toBe('restar-linea')
  })

  it('sin linea elegida, → y ← no hacen nada', () => {
    const sinSeleccion: ContextoDelPos = { ...CARRITO, haySeleccion: false }
    expect(accionDeTecla('ArrowRight', sinSeleccion)).toBe('nada')
    expect(accionDeTecla('ArrowLeft', sinSeleccion)).toBe('nada')
  })

  it('Enter abre el cobro (caso 10)', () => {
    expect(accionDeTecla('Enter', CARRITO)).toBe('ir-al-cobro')
  })

  it('Esc vuelve a productos, sin borrar nada (caso 12)', () => {
    expect(accionDeTecla('Escape', CARRITO)).toBe('volver-a-productos')
  })

  it('Supr quita la linea elegida, y solo esa', () => {
    expect(accionDeTecla('Delete', CARRITO)).toBe('quitar-linea')
    expect(accionDeTecla('Delete', { ...CARRITO, haySeleccion: false })).toBe('nada')
  })

  it('sin lineas no hay nada que recorrer ni cobrar', () => {
    const vacio: ContextoDelPos = { ...CARRITO, hayLineas: false, haySeleccion: false }
    expect(accionDeTecla('ArrowDown', vacio)).toBe('nada')
    expect(accionDeTecla('Enter', vacio)).toBe('nada')
  })
})

describe('+ y −: sinonimos de → y ←, solo con el buscador vacio', () => {
  it('en productos y en el carrito hacen lo mismo que las flechas', () => {
    expect(accionDeTecla('+', ELIGIENDO)).toBe('sumar-producto')
    expect(accionDeTecla('-', ELIGIENDO)).toBe('restar-producto')
    expect(accionDeTecla('+', CARRITO)).toBe('sumar-linea')
    expect(accionDeTecla('-', CARRITO)).toBe('restar-linea')
  })

  it('pero NO mientras se escribe: en "coca-cola" el guion es una letra', () => {
    expect(accionDeTecla('-', BUSCANDO)).toBe('nada')
    expect(accionDeTecla('+', BUSCANDO)).toBe('nada')
  })
})

describe('Teclas reservadas: en el buscador nunca hacen lo nativo', () => {
  it('las cuatro flechas, Enter y Esc son de la gramatica', () => {
    for (const t of [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Enter',
      'Escape',
    ] as const) {
      expect(esTeclaReservada(t)).toBe(true)
    }
  })

  it('Supr, + y - no: sin nada que hacer, borran o se escriben (caso 16)', () => {
    expect(esTeclaReservada('Delete')).toBe(false)
    expect(esTeclaReservada('+')).toBe(false)
    expect(esTeclaReservada('-')).toBe(false)
  })
})

describe('Teclas sostenidas (casos 17 y 18)', () => {
  it('Enter, → y ← sostenidos no se repiten', () => {
    for (const k of ['Enter', 'ArrowRight', 'ArrowLeft', '+', '-', '−', 'Delete']) {
      expect(esRepeticionIgnorada(k, true)).toBe(true)
      expect(esRepeticionIgnorada(k, false)).toBe(false)
    }
  })

  it('↑ ↓ si: recorrer una lista larga con la flecha apretada es normal', () => {
    expect(esRepeticionIgnorada('ArrowDown', true)).toBe(false)
    expect(esRepeticionIgnorada('ArrowUp', true)).toBe(false)
  })
})

describe('Doble Enter rapido: una etapa por vez (caso 19)', () => {
  it('el primer Enter siempre avanza', () => {
    expect(enterAvanza(1000, null)).toBe(true)
  })

  it('uno pegado al anterior no avanza otra etapa', () => {
    expect(enterAvanza(1000 + PAUSA_ENTRE_ETAPAS_MS - 1, 1000)).toBe(false)
    expect(enterAvanza(1040, 1000)).toBe(false)
  })

  it('pasada la pausa, si', () => {
    expect(enterAvanza(1000 + PAUSA_ENTRE_ETAPAS_MS, 1000)).toBe(true)
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

  it('sin nada elegido, cualquier flecha elige la primera fila', () => {
    expect(moverResaltado(-1, 1, 3)).toBe(0)
    expect(moverResaltado(-1, -1, 3)).toBe(0)
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

  it('en una sola columna ↑ ↓ mueven de a una fila', () => {
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
