import type { BadgeTone } from '@/components/ui'

/**
 * Como se nombra un inventario en la pantalla. UX V5.
 *
 * Son las palabras de quien cuenta, no las del modulo: "Para revisar" en vez
 * de "En revisión", "Terminado" en vez de "Aplicado". Viven aca y no en
 * `@/modules/inventory-counts/estados` para no cambiar lo que devuelve la API
 * (`statusLabel`), que tambien leen las pruebas y los reportes.
 */

const ESTADO: Record<string, { etiqueta: string; tono: BadgeTone; glifo: string }> = {
  DRAFT: { etiqueta: 'Sin empezar', tono: 'neutral', glifo: '○' },
  COUNTING: { etiqueta: 'Contando', tono: 'neutral', glifo: '●' },
  REVIEW: { etiqueta: 'Para revisar', tono: 'warning', glifo: '▲' },
  APPLIED: { etiqueta: 'Terminado', tono: 'success', glifo: '✓' },
  CANCELLED: { etiqueta: 'Cancelado', tono: 'neutral', glifo: '✕' },
}

export function estadoDeInventario(status: string): {
  etiqueta: string
  tono: BadgeTone
  glifo: string
} {
  return ESTADO[status] ?? { etiqueta: status, tono: 'neutral', glifo: '○' }
}

const ALCANCE: Record<string, string> = {
  ALL: 'Todo el negocio',
  CATEGORY: 'Una categoría',
  SELECTION: 'Algunos productos',
}

export function alcanceDeInventario(scope: string, categoria: string | null = null): string {
  if (scope === 'CATEGORY' && categoria) return `Categoría ${categoria}`
  return ALCANCE[scope] ?? scope
}

/** "17/10/26", la fecha corta con que se nombra un inventario. */
export function fechaDeInventario(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

/** Abierto = todavia se puede contar o revisar. */
export function inventarioAbierto(status: string): boolean {
  return status === 'DRAFT' || status === 'COUNTING' || status === 'REVIEW'
}
