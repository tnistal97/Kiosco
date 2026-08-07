/*
 * Aca vivia un tercer `formatCurrency(value: number)`.
 *
 * Se elimino junto con `src/lib/formatCurrency.ts`, que era un cuarto. Ninguno
 * se usaba, pero los dos tomaban un `number`: el dia que alguien los agarrara
 * por comodidad, el importe volveria a ser punto flotante. El unico formateo
 * de dinero del sistema es `formatearMonto` en `@/lib/money`, que parte de una
 * cadena decimal.
 */

export const formatDate = (
  date: Date | string,
  format: 'short' | 'long' | 'time' = 'short',
): string => {
  const d = typeof date === 'string' ? new Date(date) : date
  if (format === 'time')
    return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  if (format === 'long')
    return d.toLocaleDateString('es-AR', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })
  return d.toLocaleDateString('es-AR')
}
