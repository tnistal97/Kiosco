'use client'

import CartItemRow from './CartItemRow'
import { formatCurrency } from '@/lib/formatCurrency'
import { useCartStore } from '@/store/cart'

interface CartSidebarProps {
  onConfirm: () => void
  onClear: () => void
}

export default function CartSidebar({ onConfirm, onClear }: CartSidebarProps) {
  const items = useCartStore((s) => s.items)
  const total = items.reduce((acc, i) => acc + i.product.price * i.quantity, 0)

  return (
    <aside className="hidden md:flex md:flex-col md:w-1/3 bg-white dark:bg-gray-800 border-l border-gray-200 dark:border-gray-700 sticky top-4 h-[90vh] rounded-xl shadow-lg">
      <div className="flex flex-col h-full">
        <h2 className="px-6 pt-6 text-2xl font-bold text-gray-900 dark:text-gray-100">
          🛒 Carrito
        </h2>
        <div className="flex-1 overflow-auto px-6 py-4">
          {items.length === 0 ? (
            <p className="text-center text-gray-500 dark:text-gray-400">No hay artículos</p>
          ) : (
            <ul className="space-y-3">
              {items.map((item) => (
                <CartItemRow key={item.product.id} item={item} />
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 space-y-4">
          <div className="flex justify-between font-semibold text-gray-900 dark:text-gray-100 text-lg">
            <span>Total:</span>
            <span className="text-green-600 dark:text-green-400">{formatCurrency(total)}</span>
          </div>
          <button
            onClick={onConfirm}
            disabled={items.length === 0}
            className="w-full py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white text-lg font-semibold transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-400"
          >
            Confirmar Venta
          </button>
          <button
            onClick={onClear}
            disabled={items.length === 0}
            className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-700 text-white text-lg font-semibold transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400"
          >
            Cancelar / Vaciar
          </button>
        </div>
      </div>
    </aside>
  )
}
