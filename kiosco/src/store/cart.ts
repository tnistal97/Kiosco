import { create } from 'zustand'
import type { Product, CartItem } from '@/types'

interface CartState {
  items: CartItem[]
  addToCart: (product: Product) => void
  updateQuantity: (productId: number, quantity: number) => void
  removeFromCart: (productId: number) => void
  clearCart: () => void
}

export const useCartStore = create<CartState>((set) => ({
  items: [],

  addToCart: (product: Product) =>
    set((state) => {
      const existing = state.items.find((i) => i.product.id === product.id)
      if (existing) {
        return {
          items: state.items.map((i) =>
            i.product.id === product.id
              ? { ...i, quantity: i.quantity + 1 }
              : i
          ),
        }
      }
      return { items: [...state.items, { product, quantity: 1 }] }
    }),

  updateQuantity: (productId: number, quantity: number) =>
    set((state) => ({
      items: state.items.map((i) =>
        i.product.id === productId
          ? { ...i, quantity: Math.max(1, quantity) }
          : i
      ),
    })),

  removeFromCart: (productId: number) =>
    set((state) => ({
      items: state.items.filter((i) => i.product.id !== productId),
    })),

  clearCart: () =>
    set(() => ({
      items: [],
    })),
}))
