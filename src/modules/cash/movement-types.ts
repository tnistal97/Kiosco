/**
 * Vocabulario de los movimientos de caja, para leer.
 *
 * Los tipos se guardan en minusculas y en dos idiomas --`sale`,
 * `customer_payment`, `ingreso`-- porque cada fase agrego los suyos. No se
 * migran: el historico es el historico. Lo que si se unifica es como se
 * MUESTRAN: una sola tabla, en un solo lugar, en vez de un diccionario parcial
 * dentro de un componente (que fue como `customer_payment` termino en pantalla
 * tal cual, en Caja y en Ventas; auditoria, H-05).
 *
 * Este modulo NO importa Prisma: lo usan las pantallas.
 */

export const TIPOS_DE_MOVIMIENTO_DE_CAJA = [
  'sale',
  'sale_cancel',
  'ingreso',
  'retiro',
  'deposito',
  'manual',
  'customer_payment',
  'supplier_payment',
] as const

export type TipoDeMovimientoDeCaja = (typeof TIPOS_DE_MOVIMIENTO_DE_CAJA)[number]

export interface DescripcionDeMovimiento {
  etiqueta: string
  /** El glifo va antes del texto y no es decorativo: sobrevive sin color. */
  glifo: string
  tono: 'success' | 'danger' | 'neutral' | 'warning'
}

/**
 * El signo del glifo sigue al signo del importe que registra el servidor:
 * flecha abajo entra al cajon, flecha arriba sale. El deposito conserva el
 * signo positivo que le da `src/modules/cash/service.ts`; esto solo lo
 * muestra, no lo decide.
 */
const DESCRIPCIONES: Record<TipoDeMovimientoDeCaja, DescripcionDeMovimiento> = {
  sale: { etiqueta: 'Venta', glifo: '↓', tono: 'success' },
  sale_cancel: { etiqueta: 'Venta anulada', glifo: '↺', tono: 'danger' },
  ingreso: { etiqueta: 'Ingreso', glifo: '↓', tono: 'success' },
  retiro: { etiqueta: 'Egreso', glifo: '↑', tono: 'warning' },
  deposito: { etiqueta: 'Depósito', glifo: '↓', tono: 'success' },
  manual: { etiqueta: 'Movimiento manual', glifo: '•', tono: 'neutral' },
  customer_payment: { etiqueta: 'Cobro a cliente', glifo: '↓', tono: 'success' },
  supplier_payment: { etiqueta: 'Pago a proveedor', glifo: '↑', tono: 'warning' },
}

export function esTipoDeMovimientoDeCaja(tipo: string): tipo is TipoDeMovimientoDeCaja {
  return (TIPOS_DE_MOVIMIENTO_DE_CAJA as readonly string[]).includes(tipo)
}

/**
 * Como se muestra un tipo. Un tipo desconocido --uno de una version futura--
 * se muestra tal cual, en gris: que diga `SOMETHING` es feo; que la fila quede
 * sin tipo hace que nadie se entere.
 */
export function describirMovimientoDeCaja(tipo: string): DescripcionDeMovimiento {
  if (esTipoDeMovimientoDeCaja(tipo)) return DESCRIPCIONES[tipo]
  return { etiqueta: tipo, glifo: '•', tono: 'neutral' }
}
