'use client'

import React from 'react'
import { CartItem as CIType } from '@/types'
import { formatCurrency } from '@/lib/formatCurrency'

interface Props {
  item: CIType
  updateQty: (productId: number, newQty: number) => void
  removeFromCart: (productId: number) => void
}

export default function CartItem({ item, updateQty, removeFromCart }: Props) {
  const { product, quantity } = item

  return (
    <li className="flex justify-between items-start py-4 border-b border-gray-200 dark:border-gray-700">
      <div className="flex-1">
        <p className="font-medium text-gray-800 dark:text-gray-100">{product.name}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {quantity} × {formatCurrency(product.price)}
        </p>
      </div>
      <div className="flex items-center space-x-2">
        {/* Botón + */}
        <button
          onClick={() => updateQty(product.id, quantity + 1)}
          disabled={quantity >= product.totalStock}
          className={`px-4 py-2 ${
            quantity >= product.totalStock
              ? 'bg-gray-400 cursor-not-allowed'
              : 'bg-green-600 hover:bg-green-700'
          } text-white text-base font-medium rounded-lg`}
          aria-label={`Aumentar cantidad de ${product.name}`}
        >
          +
        </button>
        {/* Botón − */}
        <button
          onClick={() => {
            const newQty = quantity - 1
            if (newQty <= 0) removeFromCart(product.id)
            else updateQty(product.id, newQty)
          }}
          className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-base font-medium rounded-lg"
          aria-label={`Disminuir cantidad de ${product.name}`}
        >
          −
        </button>
        {/* Botón ❌ */}
        <button
          onClick={() => removeFromCart(product.id)}
          className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-base font-medium rounded-lg"
          aria-label={`Eliminar ${product.name}`}
        >
          ❌
        </button>
      </div>
    </li>
  )
}
