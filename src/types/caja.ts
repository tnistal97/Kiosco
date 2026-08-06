export interface CashMovement {
  id: number
  amount: number
  paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago' | string
  description?: string
  date: string
  type: string
  user: { id: number; name: string }
  /** Venta asociada, por clave foranea. null en movimientos manuales. */
  saleId: number | null
  /** "completed" | "canceled" | null si el movimiento no es de una venta. */
  saleStatus: string | null
}
