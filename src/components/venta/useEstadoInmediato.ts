'use client'

import { useCallback, useRef, useState, type RefObject } from 'react'

/**
 * Estado que ADEMAS se puede leer en el acto, sin esperar el próximo render.
 *
 * En una caja las teclas llegan de a ráfagas: dos Escape seguidos, ↓ ↓ →, el
 * lector escupiendo trece dígitos en medio segundo. Cada manejador de tecla
 * lee el estado del render en el que se creó, y si la tecla siguiente llega
 * antes de que React vuelva a dibujar, lee el valor VIEJO: dos Escape hacían
 * un solo paso atrás, y ↓ ↓ → sumaba el producto equivocado.
 *
 * Esto guarda el mismo valor en dos lados: `useState` para dibujar y una
 * referencia para decidir. La referencia se actualiza en la misma línea en
 * que se pide el cambio, así que la tecla siguiente ya la ve.
 *
 * No reemplaza a `useState`: solo vale para lo que el teclado lee y escribe
 * en la misma ráfaga --la zona activa, la fila elegida, la línea del ticket--.
 * Para todo lo demás, el estado normal alcanza y es más simple.
 */
export function useEstadoInmediato<T>(
  inicial: T,
): [T, (valor: T | ((anterior: T) => T)) => void, RefObject<T>] {
  const [valor, setValor] = useState<T>(inicial)
  const ref = useRef<T>(inicial)

  const fijar = useCallback((siguiente: T | ((anterior: T) => T)) => {
    const nuevo =
      typeof siguiente === 'function' ? (siguiente as (anterior: T) => T)(ref.current) : siguiente
    ref.current = nuevo
    setValor(nuevo)
  }, [])

  return [valor, fijar, ref]
}
