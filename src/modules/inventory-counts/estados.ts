/**
 * Vocabulario del inventario fisico.
 *
 * Un unico catalogo para el servidor, el navegador y la base. Este modulo NO
 * importa Prisma: lo usan las pantallas.
 *
 * Ver docs/PHYSICAL_INVENTORY.md.
 */

export const ESTADOS_DE_INVENTARIO = [
  'DRAFT',
  'COUNTING',
  'REVIEW',
  'APPLIED',
  'CANCELLED',
] as const

export type EstadoDeInventario = (typeof ESTADOS_DE_INVENTARIO)[number]

const ETIQUETAS: Record<EstadoDeInventario, string> = {
  DRAFT: 'Borrador',
  COUNTING: 'Contando',
  REVIEW: 'En revisión',
  APPLIED: 'Aplicado',
  CANCELLED: 'Cancelado',
}

const TONOS: Record<EstadoDeInventario, 'neutral' | 'info' | 'warning' | 'ok' | 'danger'> = {
  DRAFT: 'neutral',
  COUNTING: 'info',
  REVIEW: 'warning',
  APPLIED: 'ok',
  CANCELLED: 'danger',
}

export function etiquetaDeEstado(estado: string): string {
  return esEstadoValido(estado) ? ETIQUETAS[estado] : estado
}

export function tonoDeEstado(estado: string): 'neutral' | 'info' | 'warning' | 'ok' | 'danger' {
  return esEstadoValido(estado) ? TONOS[estado] : 'neutral'
}

export function esEstadoValido(estado: string): estado is EstadoDeInventario {
  return (ESTADOS_DE_INVENTARIO as readonly string[]).includes(estado)
}

/** Que se cuenta. NO hay ubicaciones: este sistema no tiene modelo de deposito. */
export const ALCANCES = ['ALL', 'CATEGORY', 'SELECTION'] as const
export type Alcance = (typeof ALCANCES)[number]

const ETIQUETAS_DE_ALCANCE: Record<Alcance, string> = {
  ALL: 'Todo el catálogo',
  CATEGORY: 'Una categoría',
  SELECTION: 'Una selección de productos',
}

export function etiquetaDeAlcance(alcance: string): string {
  return (ALCANCES as readonly string[]).includes(alcance)
    ? ETIQUETAS_DE_ALCANCE[alcance as Alcance]
    : alcance
}

/**
 * Los cuatro estados de una linea.
 *
 * `UNRESOLVED` es el caso del objetivo 31: aparecieron unidades fisicas de un
 * producto que exige lote y nadie sabe de que partida son. NO se inventa un
 * codigo, y la sesion no se puede aplicar hasta que alguien lo diga.
 */
export const ESTADOS_DE_LINEA = ['PENDING', 'COUNTED', 'RECOUNT', 'UNRESOLVED'] as const
export type EstadoDeLinea = (typeof ESTADOS_DE_LINEA)[number]

const ETIQUETAS_DE_LINEA: Record<EstadoDeLinea, string> = {
  PENDING: 'Sin contar',
  COUNTED: 'Contada',
  RECOUNT: 'Falta segundo conteo',
  UNRESOLVED: 'Sin resolver el lote',
}

export function etiquetaDeLinea(estado: string): string {
  return (ESTADOS_DE_LINEA as readonly string[]).includes(estado)
    ? ETIQUETAS_DE_LINEA[estado as EstadoDeLinea]
    : estado
}

// ---------------------------------------------------------------------------
// Transiciones
// ---------------------------------------------------------------------------

/** Se pueden cargar conteos. */
export function sePuedeContar(estado: string): boolean {
  return estado === 'DRAFT' || estado === 'COUNTING'
}

/** Se puede cerrar el conteo y pasar a revision. */
export function sePuedeRevisar(estado: string): boolean {
  return estado === 'COUNTING'
}

/** Se puede aplicar: convertir las diferencias en movimientos. */
export function sePuedeAplicar(estado: string): boolean {
  return estado === 'REVIEW'
}

/** Se puede cancelar. Una aplicada NO: ya movio stock. */
export function sePuedeCancelar(estado: string): boolean {
  return estado === 'DRAFT' || estado === 'COUNTING' || estado === 'REVIEW'
}

/** Se puede editar la configuracion. Solo el borrador. */
export function sePuedeConfigurar(estado: string): boolean {
  return estado === 'DRAFT'
}
