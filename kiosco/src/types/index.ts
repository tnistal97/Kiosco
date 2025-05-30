export interface Product {
  id: number
  name: string
  barcode?: string
  stock?: number
  price: number
}

export interface Sale {
  id: number
  createdAt: string
  total: number
}

export interface CartItem {
  product: Product
  quantity: number
}
