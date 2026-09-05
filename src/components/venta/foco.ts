/**
 * Donde esta el foco, y cuando se lo puede mover.
 *
 * La regla del punto de venta: el cursor vuelve al campo de escaneo despues
 * de cada dialogo, pero NUNCA se lo saca a alguien que ya lo puso en otro
 * campo. La version anterior insistia durante 600 ms sin mirar, y una
 * busqueda tipeada en ese lapso terminaba en el campo de codigo como un
 * "codigo no registrado" falso (auditoria, H-18).
 */

/** Un campo donde se escribe: input, textarea, select o contenteditable. */
export function esEditable(el: EventTarget | Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Momentos, en ms, en los que se vuelve a intentar enfocar tras cerrar un dialogo. */
const INTENTOS_MS = [0, 120, 260, 420] as const

/**
 * Devuelve el foco al campo, con reintentos cortos y una sola condicion.
 *
 * Headless UI devuelve el foco al elemento que abrio el dialogo al TERMINAR
 * la transicion de salida, no al desmontar, asi que un unico `focus()`
 * inmediato se pierde. Se reintenta unas pocas veces, y en cada intento se
 * comprueba: si el foco ya esta en un campo de texto --el usuario hizo clic
 * en otro lado y esta escribiendo--, no se lo toca. Un boton o el `body` no
 * cuentan como "en uso": de ahi si se lo trae.
 */
export function devolverFocoA(campo: () => HTMLElement | null): void {
  for (const ms of INTENTOS_MS) {
    setTimeout(() => {
      const objetivo = campo()
      if (!objetivo) return
      const activo = document.activeElement
      if (activo === objetivo) return
      if (esEditable(activo)) return
      objetivo.focus()
    }, ms)
  }
}
