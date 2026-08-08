/**
 * Vocabulario de los estados de una orden de compra.
 *
 * Un unico catalogo para el servidor, el navegador y la base. Los tres tienen
 * que decir lo mismo: la restriccion CHECK de PostgreSQL replica esta lista, y
 * hay una prueba que comprueba que no se separen --el mismo trato que reciben
 * los tipos de movimiento de stock--.
 *
 * Este modulo NO importa Prisma: lo usan las pantallas de compras.
 * Ver docs/PURCHASE_FLOW.md.
 */

export const ESTADOS_DE_COMPRA = [
  /** Se esta armando. Todavia no se le pidio nada a nadie. */
  'DRAFT',
  /** Confirmada y enviada al proveedor. Puede recibirse. */
  'ORDERED',
  /** Llego una parte. Puede volver a recibirse. */
  'PARTIALLY_RECEIVED',
  /** Llego todo. */
  'RECEIVED',
  /** No se recibe mas. Lo ya recibido NO se revierte. */
  'CANCELLED',
] as const

export type EstadoDeCompra = (typeof ESTADOS_DE_COMPRA)[number]

export function esEstadoDeCompra(estado: string): estado is EstadoDeCompra {
  return (ESTADOS_DE_COMPRA as readonly string[]).includes(estado)
}

const ETIQUETAS: Record<EstadoDeCompra, string> = {
  DRAFT: 'Borrador',
  ORDERED: 'Pedida',
  PARTIALLY_RECEIVED: 'Parcial',
  RECEIVED: 'Recibida',
  CANCELLED: 'Cancelada',
}

/**
 * Nombre para mostrar. Nunca se muestra el codigo crudo.
 *
 * Un estado desconocido --uno de una version futura-- se muestra tal cual en
 * vez de desaparecer: que en pantalla diga `SOMETHING` es feo; que la celda
 * quede vacia hace que nadie se entere.
 */
export function etiquetaDeEstado(estado: string): string {
  const conocido: string | undefined = esEstadoDeCompra(estado) ? ETIQUETAS[estado] : undefined
  return conocido ?? estado
}

/**
 * Tono del distintivo en la pantalla.
 *
 * `PARTIALLY_RECEIVED` es el unico que llama la atencion, y es a proposito: es
 * el estado accionable. Una orden pedida y todavia sin entregar es lo normal;
 * una a medio entregar hace una semana es la que hay que perseguir.
 */
export const TONO_DE_ESTADO: Record<EstadoDeCompra, 'neutral' | 'primary' | 'warning' | 'success'> =
  {
    DRAFT: 'neutral',
    ORDERED: 'primary',
    PARTIALLY_RECEIVED: 'warning',
    RECEIVED: 'success',
    CANCELLED: 'neutral',
  }

// ---------------------------------------------------------------------------
// Que se puede hacer en cada estado
//
// Las cuatro preguntas viven aca y no repartidas entre el servicio y los
// componentes. El servidor las usa para AUTORIZAR y la pantalla para decidir
// que botones dibuja; con dos copias, un boton habilitado terminaria pegando
// contra un 409 que el usuario no puede entender.
// ---------------------------------------------------------------------------

/** Solo un borrador se toca libremente: todavia no se le pidio nada a nadie. */
export function sePuedeEditar(estado: string): boolean {
  return estado === 'DRAFT'
}

/** Confirmar convierte el borrador en un pedido. Es un camino de ida. */
export function sePuedeConfirmar(estado: string): boolean {
  return estado === 'DRAFT'
}

export function sePuedeRecibir(estado: string): boolean {
  return estado === 'ORDERED' || estado === 'PARTIALLY_RECEIVED'
}

/**
 * Una orden parcialmente recibida SI se puede cancelar.
 *
 * Cancelar significa "el resto no va a llegar", no "esto nunca paso": llegaron
 * 3 de 5 cajas y el proveedor avisa que las otras 2 no las consigue. Lo ya
 * recibido no se revierte --la mercaderia esta en el deposito-- y las
 * recepciones, el stock, los costos y el historial quedan intactos.
 *
 * Una orden RECEIVED no se cancela: no queda nada por llegar, y marcarla
 * cancelada solo borraria el rastro de que la compra se completo.
 */
export function sePuedeCancelar(estado: string): boolean {
  return estado === 'DRAFT' || estado === 'ORDERED' || estado === 'PARTIALLY_RECEIVED'
}

/**
 * Solo un borrador se borra de verdad.
 *
 * Una orden confirmada se cancela: alguien la mando, y que no haya llegado
 * nada no significa que no haya existido.
 */
export function sePuedeBorrar(estado: string): boolean {
  return estado === 'DRAFT'
}
