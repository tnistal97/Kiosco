import type { TeclaDelLector } from '@/components/ui/ScannerInput'

/**
 * La gramatica de teclado del punto de venta. V6 (sobre la V5).
 *
 * La venta tiene TRES ETAPAS y el teclado sabe siempre en cual esta:
 *
 *   1. productos  se busca y se agrega.
 *                   ↑ ↓    eligen el producto anterior / siguiente
 *                   →      suma EXACTAMENTE una unidad del elegido
 *                   ←      resta una, si esta en el carrito (si no, nada)
 *                   Enter  pasa al carrito. No suma ni resta nada
 *                   Esc    limpia la busqueda; sin busqueda, suelta el elegido
 *                   letras van al buscador, aunque el foco este en la lista
 *   2. carrito    se revisa.
 *                   ↑ ↓    eligen la linea anterior / siguiente
 *                   →      una unidad mas de esa linea
 *                   ←      una menos; en cero la linea se quita (con deshacer)
 *                   Enter  abre el cobro
 *                   Esc    vuelve a productos. El carrito no se toca
 *   3. cobro      el dialogo de cobro (`DialogoCobro`): forma de pago,
 *                 recibido, confirmar. Esc vuelve al carrito.
 *
 * UN EJE, UNA RESPONSABILIDAD. ↑ ↓ se mueven, ← → cambian cantidades, Enter
 * avanza una etapa, Esc retrocede una. Ninguna flecha avanza y ningun Enter
 * suma. La unica excepcion es la del lector: CODIGO + Enter es un producto
 * que paso por el mostrador, agrega una unidad y NO cambia de etapa.
 *
 * QUE CAMBIO DESDE LA V5
 * ----------------------
 * En la V5 las cuatro flechas solo recorrian y la cantidad se cambiaba con
 * + y -. Enter sobre un producto lo "elegia" y, segun estuviera o no en el
 * ticket, sumaba una unidad o solo marcaba su linea: la misma tecla hacia
 * dos cosas distintas, y habia que acordarse de cual. Ahora → es agregar y
 * ← es quitar, siempre, y Enter es siempre "siguiente etapa".
 *
 * Tampoco hay mas un estado "escribiendo" distinto de "eligiendo": en
 * productos siempre manda el producto marcado, y las flechas horizontales no
 * mueven el cursor del buscador. Para corregir lo escrito estan Retroceso y
 * Esc. Es lo que permite escribir "coca" y agregarla con → sin soltar el
 * teclado.
 *
 * + y - siguen funcionando como sinonimos de → y ←, solo con el buscador
 * vacio: dentro de "coca-cola" el guion es una letra.
 *
 * Es una funcion pura para poder probarla tecla por tecla sin montar la
 * pantalla. La pantalla ejecuta la accion; esto solo la nombra.
 */

export type ModoDelCampo = 'vacio' | 'codigo' | 'busqueda'

/**
 * Digitos son un codigo; cualquier otra cosa, una busqueda.
 *
 * Los espacios entre digitos no convierten al codigo en una busqueda: un
 * "779 12 34" tipeado a mano es un codigo invalido, y tiene que decirlo como
 * tal en vez de buscar productos que se llamen asi.
 */
export function modoDelCampo(texto: string): ModoDelCampo {
  const t = texto.trim()
  if (t === '') return 'vacio'
  return /^[0-9 ]+$/.test(t) ? 'codigo' : 'busqueda'
}

/**
 * En que etapa de la venta esta puesto el teclado.
 *
 * NO es donde esta el foco del navegador: el foco vive en el buscador --por
 * eso el lector funciona sin tocar nada-- y esto dice a que responden las
 * flechas. La tercera etapa, el cobro, es un dialogo con sus propias teclas.
 */
export type EtapaDelPos = 'productos' | 'carrito'

export type AccionDelPos =
  /** Enter con digitos (el lector, o un codigo tipeado): agregar ese codigo. */
  | 'buscar-codigo'
  /** Enter en productos, con algo en el carrito. */
  | 'ir-al-carrito'
  /** Enter en productos con el carrito vacio: no hay adonde ir, se avisa. */
  | 'carrito-vacio'
  /** Enter en el carrito: abre el cobro. Tampoco cobra: eso lo decide el cobro. */
  | 'ir-al-cobro'
  | 'producto-anterior'
  | 'producto-siguiente'
  /** → sobre el producto elegido: exactamente una unidad mas. */
  | 'sumar-producto'
  /** ← sobre el producto elegido: una menos, si esta en el carrito. */
  | 'restar-producto'
  | 'linea-anterior'
  | 'linea-siguiente'
  | 'sumar-linea'
  /** ← sobre la linea elegida: una menos; en cero se quita. */
  | 'restar-linea'
  | 'quitar-linea'
  /** Esc con algo escrito: se borra lo escrito y se sigue en productos. */
  | 'limpiar-busqueda'
  /** Esc sin nada escrito: se suelta el producto elegido (estado inicial). */
  | 'soltar-producto'
  | 'volver-a-productos'
  | 'cerrar-aviso'
  /** La tecla no significa nada aca. */
  | 'nada'

export interface ContextoDelPos {
  etapa: EtapaDelPos
  /** Lo escrito en el buscador. */
  texto: string
  /** Hay lineas en el carrito. */
  hayLineas: boolean
  /** Hay una linea del carrito elegida. */
  haySeleccion: boolean
  /** Hay filas en la lista de productos (resultados o catalogo). */
  hayResultados: boolean
  /** Hay un producto de la lista elegido (marcado). */
  hayProductoElegido: boolean
  /** Hay un bloque de "codigo no registrado" o similar en pantalla. */
  hayAviso: boolean
}

type TeclaSinAlias = Exclude<TeclaDelLector, '+' | '-'>

/**
 * + y - son → y ←, pero solo con el buscador vacio. Con algo escrito son
 * letras de la busqueda, y no significan nada para la gramatica.
 */
function sinAlias(tecla: TeclaDelLector, modo: ModoDelCampo): TeclaSinAlias | null {
  if (tecla === '+') return modo === 'vacio' ? 'ArrowRight' : null
  if (tecla === '-') return modo === 'vacio' ? 'ArrowLeft' : null
  return tecla
}

export function accionDeTecla(tecla: TeclaDelLector, ctx: ContextoDelPos): AccionDelPos {
  const modo = modoDelCampo(ctx.texto)
  const t = sinAlias(tecla, modo)
  if (t === null) return 'nada'

  // Escape: un paso atras, sin perder nada del carrito.
  if (t === 'Escape') {
    if (ctx.etapa === 'carrito') return 'volver-a-productos'
    if (modo !== 'vacio') return 'limpiar-busqueda'
    if (ctx.hayAviso) return 'cerrar-aviso'
    return ctx.hayProductoElegido ? 'soltar-producto' : 'nada'
  }

  if (t === 'Enter') {
    // Un codigo manda en las dos etapas y no cambia de etapa: el Enter del
    // lector nunca es un "siguiente".
    if (modo === 'codigo') return 'buscar-codigo'
    if (ctx.etapa === 'carrito') return ctx.hayLineas ? 'ir-al-cobro' : 'nada'
    return ctx.hayLineas ? 'ir-al-carrito' : 'carrito-vacio'
  }

  if (t === 'Delete') {
    // Solo donde se ve la linea elegida. En productos, Supr borra texto.
    return ctx.etapa === 'carrito' && ctx.haySeleccion ? 'quitar-linea' : 'nada'
  }

  if (ctx.etapa === 'productos') {
    switch (t) {
      case 'ArrowUp':
        return ctx.hayResultados ? 'producto-anterior' : 'nada'
      case 'ArrowDown':
        return ctx.hayResultados ? 'producto-siguiente' : 'nada'
      case 'ArrowRight':
        return ctx.hayProductoElegido ? 'sumar-producto' : 'nada'
      case 'ArrowLeft':
        return ctx.hayProductoElegido ? 'restar-producto' : 'nada'
    }
  }

  if (!ctx.hayLineas) return 'nada'
  switch (t) {
    case 'ArrowUp':
      return 'linea-anterior'
    case 'ArrowDown':
      return 'linea-siguiente'
    case 'ArrowRight':
      return ctx.haySeleccion ? 'sumar-linea' : 'nada'
    case 'ArrowLeft':
      return ctx.haySeleccion ? 'restar-linea' : 'nada'
  }
  return 'nada'
}

/**
 * Teclas que en el buscador NUNCA hacen lo nativo, signifiquen algo o no.
 *
 * Las flechas son de la gramatica aunque en ese momento no haya nada que
 * mover: si ← moviera el cursor cuando no hay producto elegido y restara
 * cuando lo hay, la misma tecla volveria a significar dos cosas. Enter y Esc
 * tampoco tienen nada nativo que hacer en un campo de una linea.
 */
export function esTeclaReservada(tecla: TeclaDelLector): boolean {
  return (
    tecla === 'ArrowUp' ||
    tecla === 'ArrowDown' ||
    tecla === 'ArrowLeft' ||
    tecla === 'ArrowRight' ||
    tecla === 'Enter' ||
    tecla === 'Escape'
  )
}

/**
 * Teclas que NO se repiten al dejarlas apretadas.
 *
 * Un → sostenido son treinta unidades por segundo; un Enter sostenido, tres
 * etapas y una venta confirmada sin querer. Un lector nunca repite una tecla
 * --cada caracter es una pulsacion nueva--, asi que ignorar la repeticion no
 * lo afecta. ↑ y ↓ si se repiten: recorrer una lista larga dejando la flecha
 * apretada es normal.
 */
const SIN_REPETICION = new Set(['Enter', 'ArrowLeft', 'ArrowRight', '+', '-', '−', 'Delete'])

export function esRepeticionIgnorada(key: string, repeat: boolean): boolean {
  return repeat && SIN_REPETICION.has(key)
}

/**
 * Cuanto tiene que pasar entre dos Enter para que el segundo avance otra
 * etapa.
 *
 * Un doble Enter rapido --un rebote del teclado, o un dedo impaciente-- no
 * puede llevar de productos al carrito, al cobro y a una venta registrada.
 * Cada Enter avanza UNA etapa, y el siguiente recien cuenta pasado este
 * tiempo. El del lector no se frena nunca: dos lecturas seguidas son dos
 * productos.
 */
export const PAUSA_ENTRE_ETAPAS_MS = 300

export function enterAvanza(ahora: number, ultimoEnter: number | null): boolean {
  return ultimoEnter === null || ahora - ultimoEnter >= PAUSA_ENTRE_ETAPAS_MS
}

/**
 * Que fila queda elegida al moverse por la lista.
 *
 * Sin nada elegido (-1), cualquiera de las dos flechas elige la primera. En
 * los bordes no se da la vuelta: pasar de la ultima a la primera sin querer
 * es como se agrega el producto equivocado.
 */
export function moverResaltado(indice: number, delta: -1 | 1, total: number): number {
  if (total <= 0) return -1
  if (indice < 0) return 0
  const actual = Math.min(total - 1, indice)
  return Math.min(total - 1, Math.max(0, actual + delta))
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
 * lo que permite quitar tres lineas seguidas con tres ←.
 */
export function seleccionTrasQuitar(ids: readonly number[], quitado: number): number | null {
  const indice = ids.indexOf(quitado)
  const restantes = ids.filter((id) => id !== quitado)
  if (restantes.length === 0) return null
  return restantes[Math.min(Math.max(indice, 0), restantes.length - 1)] ?? null
}

// ---------------------------------------------------------------------------
// El foco REAL dentro de la lista. Tab entra, y desde ahi ↑ ↓ mueven el foco
// de verdad --no la eleccion virtual del buscador--. Es el camino de quien
// usa lector de pantalla; ← → y Enter significan lo mismo que en el
// buscador. La aritmetica vive aca para probarla sin DOM.
// ---------------------------------------------------------------------------

export type TeclaDeGrilla = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'

const TECLAS_DE_GRILLA = new Set<string>([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
])

export function esTeclaDeGrilla(tecla: string): tecla is TeclaDeGrilla {
  return TECLAS_DE_GRILLA.has(tecla)
}

/**
 * Que tarjeta queda enfocada al moverse por la grilla.
 *
 * ← → van de a una; ↑ ↓ de a una fila, que son `columnas` tarjetas. Con una
 * sola columna --la lista de la V3-- las cuatro flechas mueven de a una. En
 * los bordes no se da la vuelta, y bajar desde una fila incompleta lleva a la
 * ultima tarjeta, que es a la que se queria llegar.
 */
export function moverEnGrilla(
  indice: number,
  tecla: TeclaDeGrilla,
  total: number,
  columnas: number,
): number {
  if (total <= 0) return -1
  const ultimo = total - 1
  const cols = Math.max(1, columnas)
  const actual = Math.min(ultimo, Math.max(0, indice))

  switch (tecla) {
    case 'ArrowLeft':
      return Math.max(0, actual - 1)
    case 'ArrowRight':
      return Math.min(ultimo, actual + 1)
    case 'ArrowUp':
      return actual - cols >= 0 ? actual - cols : actual
    case 'ArrowDown': {
      if (actual + cols <= ultimo) return actual + cols
      // Queda una fila incompleta abajo: se va a la ultima tarjeta. Si ya se
      // esta en la ultima fila, no hay adonde ir.
      const filaActual = Math.floor(actual / cols)
      const ultimaFila = Math.floor(ultimo / cols)
      return filaActual < ultimaFila ? ultimo : actual
    }
    case 'Home':
      return 0
    case 'End':
      return ultimo
  }
}
