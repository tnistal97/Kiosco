/**
 * Donde esta el foco, y cuando se lo puede mover. UX V3.
 *
 * La regla del punto de venta, en una linea: EL FOCO VIVE EN EL CAMPO. Ahi
 * cae la rafaga del lector, ahi se escribe el nombre, y desde ahi mandan las
 * flechas --lo elegido en la lista y en el ticket es una marca, no un foco--.
 * Lo unico que se lo lleva es un dialogo, y cuando el dialogo se va, vuelve.
 *
 * SIN REINTENTOS (V3). La version anterior insistia en 0, 120, 260 y 420 ms
 * porque Headless UI devuelve el foco al elemento que abrio el dialogo recien
 * al TERMINAR la transicion de salida, y un unico `focus()` inmediato se
 * perdia. Costaba 320 ms estar listo para el proximo escaneo. Ahora se ataca
 * la causa: se enfoca el campo ANTES de abrir cualquier dialogo --asi el
 * elemento al que Headless UI va a devolver el foco ES el campo, se haya
 * llegado con el teclado o con el mouse-- y los dialogos de la caja salen sin
 * transicion. Un solo `focus()`, en el mismo cuadro.
 *
 * Lo que NO cambio: no se le saca el foco a alguien que ya esta escribiendo en
 * otro campo (auditoria, H-18).
 */

/** Un campo donde se escribe: input, textarea, select o contenteditable. */
export function esEditable(el: EventTarget | Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Si el elemento vive dentro de un dialogo o un cajon abierto. */
function enUnaCapa(el: Element | null): boolean {
  return el instanceof Element && el.closest('[role="dialog"]') !== null
}

/**
 * Lleva el foco al campo AHORA, en el mismo cuadro.
 *
 * Se usa en los dos extremos de cada dialogo: antes de abrirlo --para que
 * Headless UI lo tenga como elemento a restaurar-- y al cerrarlo.
 *
 * Si el foco esta en OTRO campo de texto de la pagina, no se lo toca: alguien
 * esta escribiendo ahi. Un campo de un dialogo que se esta cerrando no cuenta:
 * ese foco se va igual.
 */
export function enfocarCampo(campo: () => HTMLElement | null): void {
  const objetivo = campo()
  if (!objetivo) return
  const activo = document.activeElement
  if (activo === objetivo) return
  if (esEditable(activo) && !enUnaCapa(activo)) return
  objetivo.focus()
}
