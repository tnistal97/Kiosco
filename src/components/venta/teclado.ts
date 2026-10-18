import type { TeclaDelLector } from '@/components/ui/ScannerInput'

/**
 * La gramatica de teclado del punto de venta. UX V5 (sobre la V3).
 *
 * UNA maquina de estados con tres zonas, y cada tecla significa lo que la zona
 * dice que significa. Tres reglas que valen en todas partes:
 *
 *   - Las FLECHAS solo se mueven. Nunca cambian una cantidad.
 *   - ENTER confirma lo elegido o pasa a la etapa siguiente
 *     (producto -> ticket -> cobro). Nunca es "+1 unidad".
 *   - La cantidad se cambia a proposito: + y - (o los botones − y + de cada
 *     linea).
 *
 *   campo    se esta ESCRIBIENDO. ← → mueven el cursor; ↓ entra a la lista;
 *            Enter con digitos busca el codigo (el lector manda CODIGO+Enter
 *            y eso agrega); con texto elige el resultado marcado; vacio y
 *            con ticket pasa a revisar. + y - con el campo vacio cambian la
 *            cantidad de la linea elegida (la ultima agregada).
 *   lista    hay una fila ELEGIDA. ↑ ↓ ← → recorren, Enter la elige y vuelve
 *            al campo, + suma una unidad de ese producto y - resta una,
 *            Escape suelta la fila y vuelve a escribir.
 *   ticket   se esta REVISANDO. ↑ ↓ ← → eligen linea, + - cambian la
 *            cantidad, Supr quita, Enter abre el cobro, Escape vuelve.
 *
 * ELEGIR NO ES SUMAR (V5)
 * -----------------------
 * En la V3, → sobre la fila resaltada sumaba una unidad, y Enter despues
 * volvia a sumar: "→ y Enter" dejaba DOS unidades cuando se queria una. Y
 * Enter sobre un producto que ya estaba en el ticket sumaba otra. Ahora
 * elegir un producto que ya esta en el ticket solo selecciona su linea; para
 * llevar otra se aprieta +. El lector no cambia: cada lectura es un producto
 * fisico que paso por el mostrador, y dos lecturas son dos unidades.
 *
 * POR QUE TRES ZONAS Y NO UNA TABLA PLANA (V3)
 * --------------------------------------------
 * En la V2, ← y → cambiaban la cantidad siempre que el campo estuviera vacio.
 * Alcanzaba con que quedara una linea elegida para que ← dejara de mover el
 * cursor, y corregir "coca colaa" se volvia imposible sin mouse. Ahora ← y →
 * solo cambian cantidades cuando hay algo elegido a la vista, y para elegir
 * hay que haber presionado ↑ o ↓ a proposito.
 *
 * Y Enter ya no cobra desde el campo. Cobrar es dinero: hace falta pasar por
 * revisar --donde se ve el ticket entero-- y despues por el cobro, que ademas
 * exige un pago declarado. Dos Enter distraidos ya no registran una venta.
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
 * Donde esta puesta la atencion del teclado.
 *
 * NO es donde esta el foco del navegador: el foco vive siempre en el campo
 * --por eso el lector funciona sin tocar nada-- y esto dice a que responden
 * las flechas. La pantalla lo marca con la fila resaltada y con el ticket
 * senialado, no con un cartel de "modo".
 */
export type ZonaDelPos = 'campo' | 'lista' | 'ticket'

export type AccionDelPos =
  /** Enter con digitos: buscar ese codigo. */
  | 'buscar-codigo'
  /**
   * Enter con texto o en la lista: ELEGIR la fila resaltada. Si no esta en el
   * ticket se agrega una unidad; si ya esta, solo se selecciona su linea.
   */
  | 'elegir-resaltado'
  /** Enter con el campo vacio y ticket: pasar a revisar. NO cobra. */
  | 'revisar-ticket'
  /** Enter revisando: abrir el cobro. Tampoco cobra: eso lo decide el cobro. */
  | 'cobrar'
  /** ↓ desde el campo: la primera fila queda elegida. */
  | 'entrar-a-la-lista'
  | 'resultado-anterior'
  | 'resultado-siguiente'
  /** + sobre la fila elegida: una unidad mas de ese producto. */
  | 'sumar-resaltado'
  /** - sobre la fila elegida: una unidad menos; en cero, se quita. */
  | 'restar-resaltado'
  | 'linea-anterior'
  | 'linea-siguiente'
  | 'cantidad-mas'
  | 'cantidad-menos'
  | 'quitar-linea'
  | 'limpiar-campo'
  /** Escape desde la lista o el ticket: se suelta lo elegido, el texto queda. */
  | 'volver-al-campo'
  | 'cerrar-aviso'
  /** La tecla no significa nada aca: que haga lo suyo (mover el cursor, escribir). */
  | 'nada'

export interface ContextoDelPos {
  zona: ZonaDelPos
  texto: string
  /** Hay lineas en el ticket. */
  hayLineas: boolean
  /** Hay una linea del ticket elegida. */
  haySeleccion: boolean
  /** Hay filas en la lista de productos (resultados o catalogo). */
  hayResultados: boolean
  /** Indice de la fila elegida dentro de la lista. */
  resaltado: number
  /** Hay un bloque de "codigo no registrado" o similar en pantalla. */
  hayAviso: boolean
}

/**
 * `+` y `-` cambian cantidades solo con el campo vacio: dentro de
 * "coca-cola" el guion es una letra, no un boton de cantidad.
 */
function esTeclaDeCantidad(tecla: TeclaDelLector, modo: ModoDelCampo): boolean {
  return (tecla === '+' || tecla === '-') && modo === 'vacio'
}

export function accionDeTecla(tecla: TeclaDelLector, ctx: ContextoDelPos): AccionDelPos {
  const modo = modoDelCampo(ctx.texto)
  const { zona } = ctx

  // Escape es lo mismo en todas partes: un paso atras, sin perder nada.
  if (tecla === 'Escape') {
    if (zona !== 'campo') return 'volver-al-campo'
    if (modo !== 'vacio') return 'limpiar-campo'
    return ctx.hayAviso ? 'cerrar-aviso' : 'nada'
  }

  if (tecla === 'Enter') {
    if (zona === 'ticket') return ctx.hayLineas ? 'cobrar' : 'nada'
    if (zona === 'lista') return ctx.hayResultados ? 'elegir-resaltado' : 'nada'
    if (modo === 'codigo') return 'buscar-codigo'
    if (modo === 'busqueda') return ctx.hayResultados ? 'elegir-resaltado' : 'nada'
    // Campo vacio con ticket: revisar. Nunca cobrar directamente.
    return ctx.hayLineas ? 'revisar-ticket' : 'nada'
  }

  if (tecla === 'Delete') {
    // Solo donde se ve que hay una linea elegida. En el campo, Supr borra
    // texto; en la lista no hay nada que quitar.
    return zona === 'ticket' && ctx.haySeleccion ? 'quitar-linea' : 'nada'
  }

  switch (zona) {
    case 'campo':
      // ESTADO A: se escribe. Las flechas horizontales son del cursor y no se
      // tocan. ↓ es lo unico que saca del texto, y solo si hay lista.
      if (tecla === 'ArrowDown') return ctx.hayResultados ? 'entrar-a-la-lista' : 'nada'
      // Con el campo vacio, + y - corrigen la linea elegida --la ultima que
      // entro--: "escaneo, me piden dos, aprieto +".
      if (esTeclaDeCantidad(tecla, modo) && ctx.hayLineas && ctx.haySeleccion) {
        return tecla === '+' ? 'cantidad-mas' : 'cantidad-menos'
      }
      return 'nada'

    case 'lista':
      // ESTADO B: hay una fila elegida. Las cuatro flechas recorren; ninguna
      // cambia cantidades.
      if (!ctx.hayResultados) return 'nada'
      if (tecla === 'ArrowDown' || tecla === 'ArrowRight') return 'resultado-siguiente'
      // Desde la primera, ↑ suelta la fila y devuelve el control al texto: se
      // entro con ↓ y se sale por donde se entro.
      if (tecla === 'ArrowUp') return ctx.resaltado <= 0 ? 'volver-al-campo' : 'resultado-anterior'
      if (tecla === 'ArrowLeft') return ctx.resaltado <= 0 ? 'nada' : 'resultado-anterior'
      if (esTeclaDeCantidad(tecla, modo)) {
        return tecla === '+' ? 'sumar-resaltado' : 'restar-resaltado'
      }
      return 'nada'

    case 'ticket':
      if (!ctx.hayLineas) return 'nada'
      if (tecla === 'ArrowDown' || tecla === 'ArrowRight') return 'linea-siguiente'
      if (tecla === 'ArrowUp' || tecla === 'ArrowLeft') return 'linea-anterior'
      if (!ctx.haySeleccion) return 'nada'
      if (esTeclaDeCantidad(tecla, modo)) {
        return tecla === '+' ? 'cantidad-mas' : 'cantidad-menos'
      }
      return 'nada'
  }
}

/**
 * Que fila queda elegida al moverse por la lista.
 *
 * En los bordes no se da la vuelta: pasar de la ultima a la primera sin querer
 * es como se agrega el producto equivocado.
 */
export function moverResaltado(indice: number, delta: -1 | 1, total: number): number {
  if (total <= 0) return -1
  const actual = Math.min(total - 1, Math.max(0, indice))
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
 * lo que permite quitar tres lineas seguidas con tres Supr.
 */
export function seleccionTrasQuitar(ids: readonly number[], quitado: number): number | null {
  const indice = ids.indexOf(quitado)
  const restantes = ids.filter((id) => id !== quitado)
  if (restantes.length === 0) return null
  return restantes[Math.min(Math.max(indice, 0), restantes.length - 1)] ?? null
}

// ---------------------------------------------------------------------------
// El foco REAL dentro de la lista. Tab entra, y desde ahi las flechas mueven
// el foco de verdad --no la eleccion virtual del campo--. Es el camino de
// quien usa lector de pantalla; la aritmetica es la misma y vive aca para
// probarla sin DOM.
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
