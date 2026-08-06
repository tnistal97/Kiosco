'use client'

import React from 'react'
import { Product } from '@/types'
import { CartItem } from '@/types'
import { formatCurrency } from '@/lib/formatCurrency'

interface Props {
  product: Product
  quantityInCart: number
  addItem: (p: Product) => void
  updateQty: (productId: number, newQty: number) => void
  removeFromCart: (productId: number) => void
}

export default function ProductRow({
  product,
  quantityInCart,
  addItem,
  updateQty,
  removeFromCart,
}: Props) {
  const stock = product.totalStock
  const qty = quantityInCart

  return (
    <tr>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        {product.barcode ?? '-'}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        {product.name}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-right">
        {formatCurrency(product.price)}
      </td>
      <td
        className={`px-6 py-4 whitespace-nowrap text-sm text-center rounded ${
          stock < 10
            ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 font-semibold'
            : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {stock}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-center">
        {qty}
      </td>
      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 flex justify-center space-x-2">
        {qty > 0 ? (
          <>
            <button
              onClick={() => updateQty(product.id, qty - 1)}
              className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-base font-medium rounded-lg"
              aria-label={`Disminuir cantidad de ${product.name}`}
            >
              −
            </button>
            <button
              onClick={() => updateQty(product.id, qty + 1)}
              disabled={qty >= stock}
              className={`px-4 py-2 ${
                qty >= stock ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
              } text-white text-base font-medium rounded-lg`}
              aria-label={`Aumentar cantidad de ${product.name}`}
            >
              +
            </button>
          </>
        ) : (
          <button
            onClick={() => addItem(product)}
            disabled={stock === 0}
            className={`px-6 py-2 ${
              stock === 0 ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            } text-white text-base font-medium rounded-lg`}
            aria-label={`Agregar ${product.name} al carrito`}
          >
            Agregar
          </button>
        )}
        {qty > 0 && (
          <button
            onClick={() => removeFromCart(product.id)}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-base font-medium rounded-lg"
            aria-label={`Eliminar ${product.name} del carrito`}
          >
            ❌
          </button>
        )}
      </td>
    </tr>
  )
}
