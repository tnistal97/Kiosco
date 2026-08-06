import { create } from 'zustand'
import { Product, CartItem } from '@/types'

interface CartState {
  items: CartItem[]
  addToCart: (p: Product) => void
  updateQuantity: (productId: number, quantity: number) => void
  removeFromCart: (productId: number) => void
  clearCart: () => void
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  addToCart: (product: Product) => {
    const items = get().items
    const exists = items.find((x: CartItem) => x.product.id === product.id)
    if (exists) {
      set({
        items: items.map((x: CartItem) =>
          x.product.id === product.id
            ? { ...x, quantity: x.quantity + 1 }
            : x
        ),
      })
    } else {
      set({ items: [...items, { product, quantity: 1 }] })
    }
  },
  updateQuantity: (productId: number, quantity: number) => {
    if (quantity <= 0) {
      set({ items: get().items.filter((x: CartItem) => x.product.id !== productId) })
    } else {
      set({
        items: get().items.map((x: CartItem) =>
          x.product.id === productId ? { ...x, quantity } : x
        ),
      })
    }
  },
  removeFromCart: (productId: number) => {
    set({ items: get().items.filter((x: CartItem) => x.product.id !== productId) })
  },
  clearCart: () => set({ items: [] }),
}))
