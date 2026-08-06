// src/components/caja/ProductRow.tsx
'use client'

import { formatCurrency } from '@/lib/formatCurrency'
import { useCartStore } from '@/store/cart'
import type { Product } from '@/hooks/useProducts'

interface ProductRowProps {
  product: Product & { totalStock: number }
  quantityInCart: number
}

export default function ProductRow({
  product,
  quantityInCart,
}: ProductRowProps) {
  const addItem = useCartStore((s) => s.addToCart)
  const updateQty = useCartStore((s) => s.updateQuantity)
  const removeFromCart = useCartStore((s) => s.removeFromCart)

  const stock = product.totalStock
  const qty = quantityInCart

  // Helper para reenfocar el SearchBar
  const focusSearch = () => {
    document.getElementById('search-input')?.focus()
  }

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800 transition">
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        {product.barcode ?? '-'}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
        {product.name}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-right">
        {formatCurrency(product.price)}
      </td>
      <td
        className={`px-4 py-3 whitespace-nowrap text-sm text-center rounded ${
          stock < 10
            ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 font-semibold'
            : 'text-gray-900 dark:text-gray-100'
        }`}
      >
        {stock}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 text-center">
        {qty}
      </td>
      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 dark:text-gray-100 flex justify-center space-x-2">
        {qty > 0 ? (
          <>
            <button
              onClick={() => {
                updateQty(product.id, qty - 1)
                focusSearch()
              }}
              className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white font-medium rounded-lg"
              aria-label={`Disminuir cantidad de ${product.name}`}
            >
              −
            </button>
            <button
              onClick={() => {
                updateQty(product.id, qty + 1)
                focusSearch()
              }}
              disabled={qty >= stock}
              className={`px-3 py-1 ${
                qty >= stock
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-green-600 hover:bg-green-700'
              } text-white font-medium rounded-lg`}
              aria-label={`Aumentar cantidad de ${product.name}`}
            >
              +
            </button>
          </>
        ) : (
          <button
            onClick={() => {
              addItem(product)
              focusSearch()
            }}
            disabled={stock === 0}
            className={`px-4 py-2 ${
              stock === 0
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            } text-white font-medium rounded-lg`}
            aria-label={`Agregar ${product.name} al carrito`}
          >
            🛒 Agregar
          </button>
        )}
        {qty > 0 && (
          <button
            onClick={() => {
              removeFromCart(product.id)
              focusSearch()
            }}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg"
            aria-label={`Eliminar ${product.name} del carrito`}
          >
            ❌
          </button>
        )}
      </td>
    </tr>
  )
}
