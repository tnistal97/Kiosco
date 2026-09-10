'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Como se vende en ESTE equipo: con el lector, o buscando por nombre. UX V3.
 *
 * No son dos pantallas ni dos campos: el campo es uno solo y el lector
 * funciona en los dos modos. Lo que cambia es lo que la caja da por sentado
 * --y por lo tanto lo que dice el campo, que es la mitad de la ayuda que
 * recibe alguien que recien empieza--:
 *
 *   lector   "Escaneá un código de barras". El equipo tiene lector; el
 *            cajero pasa productos y no toca el teclado.
 *   nombre   "Buscá un producto por nombre". No hay lector, o el producto no
 *            tiene codigo: se escribe y se elige de la lista.
 *
 * LA ELECCION ES DEL EQUIPO Y NO SE TOCA. Se guarda en este navegador y no
 * cambia sola: si alguien eligio "Nombre" y despues llega un lector, escanear
 * agrega el producto igual, pero el modo sigue siendo "Nombre" hasta que una
 * persona diga otra cosa. Una caja que cambia de modo sola es una caja en la
 * que no se puede confiar.
 *
 * Solo un equipo SIN preferencia hereda un valor por omision, y por el tipo
 * de puntero: con el dedo --telefono o tablet-- casi nunca hay lector, asi
 * que arranca en "Nombre"; con mouse, en "Lector".
 *
 * `localStorage` y no una columna en la base: es una preferencia de este
 * navegador, no del usuario ni del comercio, y no justifica una migracion.
 */

export type ModoDeVenta = 'lector' | 'nombre'

const CLAVE = 'kiosco:venta:modo'

function esModo(v: unknown): v is ModoDeVenta {
  return v === 'lector' || v === 'nombre'
}

/** Con el dedo casi nunca hay lector; con mouse, casi siempre. */
function porOmision(): ModoDeVenta {
  if (typeof window === 'undefined') return 'lector'
  try {
    return window.matchMedia('(pointer: coarse)').matches ? 'nombre' : 'lector'
  } catch {
    return 'lector'
  }
}

export function useModoDeVenta(): {
  modo: ModoDeVenta
  elegir: (modo: ModoDeVenta) => void
  /** Ya se leyo la preferencia del equipo. Antes de eso no hay que animar nada. */
  resuelto: boolean
} {
  // Arranca en null y no en 'lector': el servidor no tiene `localStorage` ni
  // puntero, y decidir en el primer render daria un HTML distinto al del
  // navegador.
  const [modo, setModo] = useState<ModoDeVenta | null>(null)

  useEffect(() => {
    let guardado: string | null = null
    try {
      guardado = localStorage.getItem(CLAVE)
    } catch {
      // Sin almacenamiento se usa el valor por omision en cada carga.
    }
    setModo(esModo(guardado) ? guardado : porOmision())
  }, [])

  const elegir = useCallback((nuevo: ModoDeVenta) => {
    setModo(nuevo)
    try {
      localStorage.setItem(CLAVE, nuevo)
    } catch {
      // No es grave: se pierde la preferencia, no la venta.
    }
  }, [])

  return { modo: modo ?? 'lector', elegir, resuelto: modo !== null }
}
