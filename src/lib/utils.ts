export const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(value)

export const formatDate = (
  date: Date | string,
  format: 'short' | 'long' | 'time' = 'short'
): string => {
  const d = typeof date === 'string' ? new Date(date) : date
  if (format === 'time') return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
  if (format === 'long') return d.toLocaleDateString('es-AR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  return d.toLocaleDateString('es-AR')
}
