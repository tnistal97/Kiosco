// src/components/dashboard/CartItemRow.tsx
'use client'

import React from 'react'
import type { CartItem } from '@/types'
import { formatCurrency } from '@/lib/formatCurrency'

interface CartItemRowProps {
  item: CartItem
  onIncrease: (productId: number) => void
  onDecrease: (productId: number) => void
  onRemove: (productId: number) => void
}

export default function CartItemRow({
  item,
  onIncrease,
  onDecrease,
  onRemove,
}: CartItemRowProps) {
  const { product, quantity } = item
  const subtotal = product.price * quantity

  return (
    <li className="flex justify-between items-start py-4 border-b border-gray-200 dark:border-gray-700">
      {/* Product Info */}
      <div className="flex-1">
        <p className="font-medium text-gray-900 dark:text-gray-100">
          {product.name}
        </p>
        <p className="text-sm text-gray-700 dark:text-gray-300">
          {formatCurrency(product.price)} c/u
        </p>

        {/* Quantity Controls */}
        <div className="flex items-center gap-2 mt-2">
          <button
            onClick={() => onDecrease(product.id)}
            disabled={quantity <= 1}
            className={`
              flex items-center justify-center
              w-8 h-8 rounded-md
              bg-gray-200 dark:bg-gray-700
              text-gray-900 dark:text-gray-100
              hover:bg-gray-300 dark:hover:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-blue-300
              disabled:opacity-50 disabled:cursor-not-allowed
              transition
            `}
            aria-label={`Disminuir cantidad de ${product.name}`}
          >
            –
          </button>
          <span className="min-w-[2rem] text-center font-bold text-gray-900 dark:text-gray-100">
            {quantity}
          </span>
          <button
            onClick={() => onIncrease(product.id)}
            className="
              flex items-center justify-center
              w-8 h-8 rounded-md
              bg-gray-200 dark:bg-gray-700
              text-gray-900 dark:text-gray-100
              hover:bg-gray-300 dark:hover:bg-gray-600
              focus:outline-none focus:ring-2 focus:ring-blue-300
              transition
            "
            aria-label={`Aumentar cantidad de ${product.name}`}
          >
            +
          </button>
        </div>
      </div>

      {/* Subtotal and Remove Button */}
      <div className="flex flex-col items-end ml-4 space-y-1">
        <span className="font-bold text-gray-900 dark:text-gray-100">
          {formatCurrency(subtotal)}
        </span>
        <button
          onClick={() => onRemove(product.id)}
          className="
            text-sm font-bold text-red-600 dark:text-red-400
            hover:underline focus:outline-none focus:ring-2 focus:ring-red-300
            transition
          "
          aria-label={`Eliminar ${product.name} del carrito`}
        >
          Eliminar
        </button>
      </div>
    </li>
  )
}
