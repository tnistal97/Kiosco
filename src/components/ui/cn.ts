import clsx, { type ClassValue } from 'clsx'

/**
 * Une clases condicionales.
 *
 * No resuelve conflictos entre utilidades de Tailwind: si dos clases pelean,
 * el problema es el componente, no la funcion. Cada componente define su
 * aspecto y expone `className` para agregar, no para reescribir.
 */
export function cn(...values: ClassValue[]): string {
  return clsx(values)
}
