/**
 * Vocabulario de las devoluciones a proveedor.
 *
 * Un unico catalogo para el servidor, el navegador y la base. Los tres tienen
 * que decir lo mismo: las restricciones CHECK de PostgreSQL replican estas dos
 * listas, y hay una prueba que comprueba que no se separen --el mismo trato que
 * reciben los estados de una orden y los tipos de movimiento de stock--.
 *
 * Este modulo NO importa Prisma: lo usan las pantallas.
 * Ver docs/PURCHASE_RETURN_FLOW.md.
 */

export const ESTADOS_DE_DEVOLUCION = [
  /**
   * Se esta armando. NO MOVIO NADA: ni stock ni saldo.
   *
   * Por eso dos borradores pueden pedir la misma mercaderia sin chocar: el tope
   * de lo retornable se consume al confirmar, que es cuando la mercaderia sale.
   * Reservarlo en el borrador obligaria a liberar reservas abandonadas, que es
   * un problema entero para resolver algo que no ocurre: entre armar una
   * devolucion y confirmarla pasan minutos.
   */
  'DRAFT',
  /** Confirmada. Salio la mercaderia y se emitio el credito. Inmutable. */
  'CONFIRMED',
  /** Descartada antes de confirmar. Nunca movio nada. */
  'CANCELLED',
] as const

export type EstadoDeDevolucion = (typeof ESTADOS_DE_DEVOLUCION)[number]

export function esEstadoDeDevolucion(estado: string): estado is EstadoDeDevolucion {
  return (ESTADOS_DE_DEVOLUCION as readonly string[]).includes(estado)
}

const ETIQUETAS_DE_ESTADO: Record<EstadoDeDevolucion, string> = {
  DRAFT: 'Borrador',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
}

/**
 * Nombre para mostrar. Nunca se muestra el codigo crudo.
 *
 * Un estado desconocido --uno de una version futura-- se muestra tal cual en vez
 * de desaparecer: que en pantalla diga `SOMETHING` es feo; que la celda quede
 * vacia hace que nadie se entere.
 */
export function etiquetaDeEstadoDeDevolucion(estado: string): string {
  const conocido: string | undefined = esEstadoDeDevolucion(estado)
    ? ETIQUETAS_DE_ESTADO[estado]
    : undefined
  return conocido ?? estado
}

export const TONO_DE_DEVOLUCION: Record<EstadoDeDevolucion, 'neutral' | 'warning' | 'success'> = {
  DRAFT: 'warning',
  CONFIRMED: 'success',
  CANCELLED: 'neutral',
}

// ---------------------------------------------------------------------------
// Motivos
// ---------------------------------------------------------------------------

/**
 * Por que vuelve la mercaderia.
 *
 * Lista corta a proposito. Existe para poder PREGUNTAR --"cuanto devolvimos por
 * rotura este trimestre", "que proveedor nos manda mas producto equivocado"-- y
 * esa pregunta se contesta con cinco categorias, no con quince matices que nadie
 * elige igual dos veces.
 *
 * Y NO ALCANZA SOLO CON EL ENUM: la nota es parte del motivo, no un adorno. Con
 * el enum solo, todo lo que no encaja termina en 'OTHER' y el motivo real se
 * pierde; con la nota sola, la pregunta se contesta leyendo cien frases.
 */
export const MOTIVOS_DE_DEVOLUCION = [
  'DAMAGED',
  'WRONG_PRODUCT',
  'QUALITY',
  'OVER_DELIVERY',
  'OTHER',
] as const

export type MotivoDeDevolucion = (typeof MOTIVOS_DE_DEVOLUCION)[number]

export function esMotivoDeDevolucion(motivo: string): motivo is MotivoDeDevolucion {
  return (MOTIVOS_DE_DEVOLUCION as readonly string[]).includes(motivo)
}

const ETIQUETAS_DE_MOTIVO: Record<MotivoDeDevolucion, string> = {
  DAMAGED: 'Llegó dañada',
  WRONG_PRODUCT: 'Producto equivocado',
  QUALITY: 'Problema de calidad',
  OVER_DELIVERY: 'Entregaron de más',
  OTHER: 'Otro',
}

export function etiquetaDeMotivo(motivo: string): string {
  const conocido: string | undefined = esMotivoDeDevolucion(motivo)
    ? ETIQUETAS_DE_MOTIVO[motivo]
    : undefined
  return conocido ?? motivo
}

/**
 * Ayuda de cada motivo, para la pantalla.
 *
 * El texto importa: es lo que decide si una caja aplastada se carga como
 * `DAMAGED` o como `QUALITY`, y esa diferencia es el unico dato que despues
 * permite saber si el problema es del transporte o del producto.
 */
export const AYUDA_DE_MOTIVO: Record<MotivoDeDevolucion, string> = {
  DAMAGED: 'Rota, golpeada o mojada en el transporte',
  WRONG_PRODUCT: 'No es lo que se pidió',
  QUALITY: 'Vino mal de fábrica, no cumple lo pactado',
  OVER_DELIVERY: 'Llegó más de lo pedido',
  OTHER: 'Explicalo en la nota',
}

// ---------------------------------------------------------------------------
// Que se puede hacer en cada estado
//
// Las tres preguntas viven aca y no repartidas entre el servicio y los
// componentes. El servidor las usa para AUTORIZAR y la pantalla para decidir que
// botones dibuja; con dos copias, un boton habilitado terminaria pegando contra
// un 409 que el usuario no puede entender.
// ---------------------------------------------------------------------------

/** Solo un borrador se toca: todavia no salio nada del deposito. */
export function sePuedeEditarDevolucion(estado: string): boolean {
  return estado === 'DRAFT'
}

/** Confirmar saca la mercaderia y emite el credito. Es un camino de ida. */
export function sePuedeConfirmarDevolucion(estado: string): boolean {
  return estado === 'DRAFT'
}

/**
 * Cancelar es SOLO antes de confirmar.
 *
 * Una devolucion confirmada no se cancela: la mercaderia ya volvio al proveedor
 * y el credito ya esta en su cuenta. Si el proveedor la devuelve, eso es una
 * entrega nueva --con su recepcion, su costo y su cargo--, y no un boton que
 * borra la anterior.
 */
export function sePuedeCancelarDevolucion(estado: string): boolean {
  return estado === 'DRAFT'
}
