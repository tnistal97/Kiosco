/**
 * De donde vino un movimiento de stock.
 *
 * `referenceType` + `referenceId` es lo que permite que el historial diga
 * "Venta #4832" y enlace, en vez de guardar esa frase como texto --que fue
 * exactamente el problema que tenia `CashRegisterMovement.description` antes
 * de la Fase 3--.
 *
 * No es una clave foranea: apunta a tablas distintas segun el tipo, y una FK
 * polimorfica no se puede declarar. Se compensa con una lista blanca, un
 * indice `(referenceType, referenceId)` y la regla de que solo la escribe el
 * servidor.
 *
 * En su propio archivo, sin Prisma, porque lo necesitan las dos puntas: el
 * esquema de la consulta y la pantalla que arma el enlace.
 */

export const REFERENCIAS = [
  'Sale',
  'BranchStock',
  'Product',
  'PurchaseReceipt',
  'PurchaseReturn',
  'InventoryCountSession',
] as const

export type Referencia = (typeof REFERENCIAS)[number]

/**
 * A donde lleva el enlace del historial, o null si no lleva a ningun lado.
 *
 * La venta y la recepcion tienen pantalla propia. Un ajuste referencia su fila
 * de stock, que no es una pantalla: el movimiento ya cuenta todo lo que hay
 * que saber.
 *
 * Una entrada de mercaderia apunta a la RECEPCION y no a la orden: una orden
 * puede tener varias entregas, y con la orden como referencia el enlace no
 * llevaria a la que movio estas unidades. La pantalla de la recepcion vive
 * dentro del detalle de su orden, y el ancla la abre desplegada.
 */
export function enlaceDeReferencia(tipo: string | null, id: number | null): string | null {
  if (id === null) return null
  if (tipo === 'Sale') return `/ventas?venta=${String(id)}`
  if (tipo === 'PurchaseReceipt') return `/compras/recepcion/${String(id)}`
  if (tipo === 'PurchaseReturn') return `/devoluciones/${String(id)}`
  if (tipo === 'InventoryCountSession') return `/inventarios/${String(id)}`
  return null
}

/** Como se nombra la referencia en la pantalla. */
export function textoDeReferencia(tipo: string | null, id: number | null): string {
  if (tipo === null || id === null) return '—'
  if (tipo === 'Sale') return `Venta #${String(id)}`
  if (tipo === 'Product') return `Producto #${String(id)}`
  if (tipo === 'PurchaseReceipt') return `Recepción #${String(id)}`
  if (tipo === 'PurchaseReturn') return `Devolución #${String(id)}`
  if (tipo === 'InventoryCountSession') return `Inventario físico #${String(id)}`
  return `Ajuste #${String(id)}`
}
