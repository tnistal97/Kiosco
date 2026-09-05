import type { TeclaDelLector } from '@/components/ui/ScannerInput'

/**
 * La gramatica de teclado del punto de venta. UX V2, Fase 1.
 *
 * Una sola tabla, sin excepciones, que responde "que hace esta tecla ahora":
 *
 *   ↑ ↓      mueven la seleccion: entre resultados si se esta buscando, entre
 *            lineas del ticket si el campo esta vacio
 *   ← →      cambian la cantidad de la linea seleccionada (tambien + y −)
 *   Enter    lo evidente: busca el codigo, agrega el resultado elegido, o abre
 *            el cobro si el campo esta vacio y hay ticket
 *   Escape   vuelve un nivel: vacia el campo, deselecciona, cierra el aviso
 *   Supr     quita la linea seleccionada
 *
 * Antes ↑ subia la cantidad y F12 era la unica forma de cobrar sin mouse
 * (auditoria, H-06 y H-07). F12, Alt+N y Ctrl+K siguen funcionando como
 * alias, pero no son la gramatica.
 *
 * Es una funcion pura para que se pueda probar tecla por tecla sin montar la
 * pantalla. La pantalla ejecuta la accion; esto solo la nombra.
 */

export type ModoDelCampo = 'vacio' | 'codigo' | 'busqueda'

/** Digitos son un codigo; cualquier otra cosa, una busqueda. */
export function modoDelCampo(texto: string): ModoDelCampo {
  const t = texto.trim()
  if (t === '') return 'vacio'
  return /^[0-9]+$/.test(t) ? 'codigo' : 'busqueda'
}

export type AccionDelPos =
  | 'buscar-codigo'
  | 'agregar-resultado'
  | 'cobrar'
  | 'resultado-anterior'
  | 'resultado-siguiente'
  | 'linea-anterior'
  | 'linea-siguiente'
  | 'cantidad-menos'
  | 'cantidad-mas'
  | 'quitar-linea'
  | 'limpiar-campo'
  | 'deseleccionar'
  | 'cerrar-aviso'
  | 'nada'

export interface ContextoDelPos {
  texto: string
  hayLineas: boolean
  haySeleccion: boolean
  hayResultados: boolean
  /** Hay un bloque de "codigo no registrado" o similar en pantalla. */
  hayAviso: boolean
}

export function accionDeTecla(tecla: TeclaDelLector, ctx: ContextoDelPos): AccionDelPos {
  const modo = modoDelCampo(ctx.texto)

  switch (tecla) {
    case 'Enter':
      if (modo === 'codigo') return 'buscar-codigo'
      if (modo === 'busqueda') return ctx.hayResultados ? 'agregar-resultado' : 'nada'
      return ctx.hayLineas ? 'cobrar' : 'nada'

    case 'Escape':
      if (modo !== 'vacio') return 'limpiar-campo'
      if (ctx.haySeleccion) return 'deseleccionar'
      return ctx.hayAviso ? 'cerrar-aviso' : 'nada'

    case 'ArrowUp':
      if (modo === 'busqueda') return ctx.hayResultados ? 'resultado-anterior' : 'nada'
      if (modo === 'vacio') return ctx.hayLineas ? 'linea-anterior' : 'nada'
      return 'nada'

    case 'ArrowDown':
      if (modo === 'busqueda') return ctx.hayResultados ? 'resultado-siguiente' : 'nada'
      if (modo === 'vacio') return ctx.hayLineas ? 'linea-siguiente' : 'nada'
      return 'nada'

    case 'ArrowLeft':
    case '-':
      return modo === 'vacio' && ctx.haySeleccion ? 'cantidad-menos' : 'nada'

    case 'ArrowRight':
    case '+':
      return modo === 'vacio' && ctx.haySeleccion ? 'cantidad-mas' : 'nada'

    case 'Delete':
      return modo === 'vacio' && ctx.haySeleccion ? 'quitar-linea' : 'nada'
  }
}

/**
 * Que linea queda seleccionada al moverse.
 *
 * Sin seleccion, ↓ elige la primera y ↑ la ultima. En los bordes no se da la
 * vuelta: en un ticket largo, pasar de la ultima a la primera sin querer es
 * como se quita la linea equivocada.
 */
export function moverSeleccion(
  ids: readonly number[],
  actual: number | null,
  delta: -1 | 1,
): number | null {
  if (ids.length === 0) return null
  const indice = actual === null ? -1 : ids.indexOf(actual)
  if (indice === -1) return (delta === 1 ? ids[0] : ids[ids.length - 1]) ?? null
  const siguiente = Math.min(ids.length - 1, Math.max(0, indice + delta))
  return ids[siguiente] ?? null
}

/**
 * Tras quitar una linea, la seleccion pasa a la que ocupaba su lugar, o a la
 * anterior si era la ultima. Nunca queda en la nada mientras haya ticket: es
 * lo que permite quitar tres lineas seguidas con tres Supr.
 */
export function seleccionTrasQuitar(ids: readonly number[], quitado: number): number | null {
  const indice = ids.indexOf(quitado)
  const restantes = ids.filter((id) => id !== quitado)
  if (restantes.length === 0) return null
  return restantes[Math.min(Math.max(indice, 0), restantes.length - 1)] ?? null
}
