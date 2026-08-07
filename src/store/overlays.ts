import { create } from 'zustand'

/**
 * Cuantas capas hay abiertas encima de la pantalla.
 *
 * Existe por un motivo concreto: el escaner de codigo de barras escucha el
 * teclado de toda la ventana. Con un dialogo abierto tiene que callarse, o
 * agrega productos al carrito detras del dialogo mientras el usuario cree
 * estar confirmando otra cosa. Ese fue un bug real.
 *
 * Se cuenta en vez de guardar un booleano porque las capas se anidan: un
 * dialogo de confirmacion sobre un cajon lateral. Con un booleano, cerrar el
 * de arriba reactivaria el escaner con el de abajo todavia abierto.
 *
 * Lo registran `Dialog` y `Drawer` solos. Ninguna pantalla llama a esto a
 * mano: si hiciera falta, seria un componente nuevo, no una llamada suelta.
 */
interface EstadoCapas {
  abiertas: number
  registrar: () => () => void
}

export const useOverlays = create<EstadoCapas>((set) => ({
  abiertas: 0,
  registrar: () => {
    set((s) => ({ abiertas: s.abiertas + 1 }))
    let liberado = false
    return () => {
      if (liberado) return
      liberado = true
      set((s) => ({ abiertas: Math.max(0, s.abiertas - 1) }))
    }
  },
}))

/** `true` si hay al menos un dialogo o cajon abierto. */
export function useHayCapaAbierta(): boolean {
  return useOverlays((s) => s.abiertas > 0)
}
