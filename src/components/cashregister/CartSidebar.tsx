'use client'

import React from 'react'
import { useCartStore } from '@/store/cart'
import CartItem from './CartItem'
import CartFooter from './CartFooter'

interface Props {
  confirmSale: (paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago') => void
}

export default function CartSidebar({ confirmSale }: Props) {
  const items = useCartStore((s) => s.items)
  const updateQty = useCartStore((s) => s.updateQuantity)
  const removeFromCart = useCartStore((s) => s.removeFromCart)
  const clearCart = useCartStore((s) => s.clearCart)

  const total = items.reduce((acc, i) => acc + i.product.price * i.quantity, 0)

  return (
    <aside className="hidden md:flex md:flex-col md:w-1/3 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 h-screen">
      <div className="flex flex-col h-full">
        <h2 className="px-6 pt-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Carrito de Ventas
        </h2>

        {/* Lista de Items */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {items.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400">
              No hay artículos en el carrito.
            </p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <CartItem
                  key={item.product.id}
                  item={item}
                  updateQty={updateQty}
                  removeFromCart={removeFromCart}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Footer siempre visible (Total + Botones + Selección método pago) */}
        <CartFooter
          total={total}
          itemsCount={items.length}
          clearCart={clearCart}
          confirmSale={confirmSale}
        />
      </div>
    </aside>
  )
}
