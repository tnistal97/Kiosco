// src/types/index.ts

export interface Category {
  id: number
  name: string
}

export interface Product {
  id: number
  name: string
  barcode?: string | null
  description?: string | null
  price: number
  category: { id: number; name: string }
  totalStock: number
}

// Nuevo: representa un producto vendido en una venta
export interface SaleItem {
  id: number
  product: {
    id: number
    name: string
  }
  quantity: number
  price: number
}

export interface Sale {
  id: number
  createdAt: string // fecha ISO
  total: number // total de la venta
  user: {
    id: number
    name: string
  }
  items: SaleItem[] // 💡 los productos vendidos en esta venta
}

export interface CartItem {
  product: Product
  quantity: number
}

export interface CashMovement {
  id: number
  amount: number
  paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago' | string
  description?: string
  date: string
  user: { id: number; name: string }
}
