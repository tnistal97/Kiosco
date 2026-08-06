export interface CashMovement {
  id: number
  amount: number
  paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago' | string
  description?: string
  date: string
  user: { id: number; name: string }
}
