'use client'

import { formatCurrency } from '@/lib/formatCurrency'
import { useCartStore } from '@/store/cart'
// Ahora importamos CartItem desde el store (que ya lo reexporta) o directamente desde '@/types':
import type { CartItem } from '@/store/cart'

interface CartItemRowProps {
  item: CartItem
}

export default function CartItemRow({ item }: CartItemRowProps) {
  const updateQty = useCartStore((s) => s.updateQuantity)
  const removeFromCart = useCartStore((s) => s.removeFromCart)

  return (
    <li className="flex justify-between items-center bg-gray-50 dark:bg-gray-700 rounded-lg p-3 shadow-sm">
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.product.name}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {item.quantity} × {formatCurrency(item.product.price)}
        </p>
      </div>
      <div className="flex items-center space-x-2">
        <button
          onClick={() => updateQty(item.product.id, item.quantity - 1)}
          className="w-8 h-8 flex items-center justify-center bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg"
          aria-label="Disminuir cantidad"
        >
          −
        </button>
        <span className="text-gray-900 dark:text-gray-100">{item.quantity}</span>
        <button
          onClick={() => updateQty(item.product.id, item.quantity + 1)}
          disabled={item.quantity >= item.product.totalStock}
          className={`w-8 h-8 flex items-center justify-center ${
            item.quantity >= item.product.totalStock
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
          } text-white rounded-lg`}
          aria-label="Aumentar cantidad"
        >
          +
        </button>
        <button
          onClick={() => removeFromCart(item.product.id)}
          className="w-8 h-8 flex items-center justify-center bg-red-600 hover:bg-red-700 text-white rounded-lg"
          aria-label="Eliminar artículo"
        >
          ❌
        </button>
      </div>
    </li>
  )
}
