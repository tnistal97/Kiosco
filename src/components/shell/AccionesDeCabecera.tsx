'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** El lugar de la cabecera, al lado del titulo, donde van las acciones de una pantalla. */
export const ID_ACCIONES_DE_CABECERA = 'acciones-de-cabecera'

/**
 * Acciones de una pantalla, junto a su titulo. UX V5.
 *
 * El titulo lo dibuja la cabecera comun (`AppShell`), no la pantalla. Para que
 * "Ventas de hoy" quede pegado a "Vender" sin que cada pantalla tenga que
 * dibujar su propia cabecera, la pantalla la manda a ese lugar con un portal.
 * Fuera de la aplicacion --una prueba que monta la pantalla sola-- no hay
 * cabecera y no se dibuja nada.
 */
export function AccionesDeCabecera({ children }: { children: ReactNode }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null)

  useEffect(() => {
    setDestino(document.getElementById(ID_ACCIONES_DE_CABECERA))
  }, [])

  return destino ? createPortal(children, destino) : null
}
