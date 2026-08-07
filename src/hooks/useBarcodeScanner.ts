'use client'

import { useEffect, useRef } from 'react'

/**
 * Escucha el lector de codigo de barras en toda la ventana.
 *
 * Un lector USB es un teclado: escribe los digitos y manda Enter. La
 * diferencia con una persona es la velocidad. Un lector tarda entre 5 y 20 ms
 * por caracter; nadie escribe a ese ritmo de forma sostenida.
 *
 * Esta separacion importa porque el problema real no es leer el codigo: es NO
 * leerlo cuando no corresponde. El bug que motivo este componente era que el
 * escaner seguia agregando productos al carrito **con un dialogo abierto**,
 * detras del dialogo, mientras el usuario creia estar confirmando un cobro.
 *
 * Reglas:
 *
 *  - con `enabled` en false no escucha nada. La caja lo apaga cuando hay un
 *    dialogo abierto o cuando se esta editando una cantidad;
 *  - si el foco esta en un campo de texto, no roba nada. El unico campo que
 *    puede recibir la rafaga es el que se marca con `data-barcode-input`, y
 *    ese la maneja por su cuenta;
 *  - una vez detectada la rafaga, cancela las teclas siguientes para que los
 *    digitos no terminen escritos en la pantalla;
 *  - un codigo se entrega una sola vez: el buffer se vacia al entregarlo.
 */

/** Mas espacio que esto entre teclas y ya no es una rafaga. */
const PAUSA_MAXIMA_MS = 60

/** Promedio por caracter por debajo del cual se acepta como lector. */
const PROMEDIO_MAXIMO_MS = 45

/** Menos caracteres que esto no es un codigo de barras. */
const LARGO_MINIMO = 4

/** Con esto ya se sabe que es una rafaga y se pueden cancelar las teclas. */
const LARGO_PARA_CANCELAR = 3

function esCampoEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function esElCampoDeCodigo(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && el.dataset.barcodeInput !== undefined
}

export interface OpcionesEscaner {
  /** Se llama una vez por codigo completo. */
  onScan: (code: string) => void
  /** Con false el escaner no escucha. */
  enabled?: boolean
}

export function useBarcodeScanner({ onScan, enabled = true }: OpcionesEscaner): void {
  // El callback vive en una ref para que cambiarlo no vuelva a suscribir el
  // listener: reengancharlo en cada render perderia rafagas a medio leer.
  const alLeer = useRef(onScan)
  useEffect(() => {
    alLeer.current = onScan
  }, [onScan])

  useEffect(() => {
    if (!enabled) return

    let buffer = ''
    let ultimaTecla = 0
    let inicio = 0

    function vaciar() {
      buffer = ''
      ultimaTecla = 0
      inicio = 0
    }

    function esRafaga(): boolean {
      if (buffer.length < LARGO_MINIMO) return false
      const transcurrido = ultimaTecla - inicio
      const promedio = transcurrido / Math.max(1, buffer.length - 1)
      return promedio <= PROMEDIO_MAXIMO_MS
    }

    function alPresionar(e: KeyboardEvent) {
      // Un atajo con modificador nunca es parte de un codigo.
      if (e.ctrlKey || e.altKey || e.metaKey) {
        vaciar()
        return
      }

      // El campo de codigo se ocupa solo. Cualquier otro campo de texto es
      // territorio del usuario y no se toca.
      if (esCampoEditable(e.target) && !esElCampoDeCodigo(e.target)) {
        vaciar()
        return
      }
      if (esElCampoDeCodigo(e.target)) return

      const ahora = performance.now()

      if (e.key === 'Enter') {
        if (esRafaga()) {
          const codigo = buffer
          vaciar()
          e.preventDefault()
          e.stopPropagation()
          alLeer.current(codigo)
        } else {
          vaciar()
        }
        return
      }

      // Solo caracteres imprimibles sueltos: `key` de una tecla normal mide 1.
      if (e.key.length !== 1) {
        if (e.key !== 'Shift') vaciar()
        return
      }

      if (ultimaTecla !== 0 && ahora - ultimaTecla > PAUSA_MAXIMA_MS) {
        // Demasiado lento: lo que habia no era una rafaga. Se empieza de nuevo
        // con esta tecla, que si podria ser el principio de una.
        buffer = ''
        inicio = ahora
      }
      if (buffer === '') inicio = ahora

      buffer += e.key
      ultimaTecla = ahora

      // Ya se sabe que es un lector: a partir de aca las teclas no llegan a
      // ningun lado. Los primeros caracteres no se cancelan porque todavia
      // podrian ser una persona escribiendo, y cancelarlos romperia el
      // teclado normal.
      if (buffer.length > LARGO_PARA_CANCELAR) {
        e.preventDefault()
      }
    }

    document.addEventListener('keydown', alPresionar, true)
    return () => {
      document.removeEventListener('keydown', alPresionar, true)
    }
  }, [enabled])
}
