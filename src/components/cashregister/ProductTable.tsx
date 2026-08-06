'use client'

import React from 'react'
import { Product } from '@/types'
import ProductRow from './ProductRow'

interface Props {
  products: Product[]
  quantitiesMap: Record<number, number>
  addItem: (p: Product) => void
  updateQty: (productId: number, newQty: number) => void
  removeFromCart: (productId: number) => void
  isLoading: boolean
  search: string
}

export default function ProductTable({
  products,
  quantitiesMap,
  addItem,
  updateQty,
  removeFromCart,
  isLoading,
  search,
}: Props) {
  if (isLoading) {
    return (
      <div className="animate-pulse p-4">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-4" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 dark:bg-gray-700 rounded" />
          ))}
        </div>
      </div>
    )
  }

  if (products.length === 0) {
    return (
      <div className="col-span-full flex flex-col items-center justify-center py-16 border-2 border-gray-200 rounded-2xl bg-white dark:bg-gray-800 shadow-sm">
        <span className="text-6xl text-gray-400 dark:text-gray-500">🛒</span>
        <p className="mt-4 text-lg font-medium text-gray-900 dark:text-gray-100">
          No hay productos
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400">Ajusta tu búsqueda “{search}”</p>
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
        <thead className="bg-gray-50 dark:bg-gray-800">
          <tr>
            <th className="px-6 py-3 text-left text-sm font-medium text-gray-800 dark:text-gray-400 uppercase tracking-wider">
              Código
            </th>
            <th className="px-6 py-3 text-left text-sm font-medium text-gray-800 dark:text-gray-400 uppercase tracking-wider">
              Nombre
            </th>
            <th className="px-6 py-3 text-right text-sm font-medium text-gray-800 dark:text-gray-400 uppercase tracking-wider">
              Precio
            </th>
            <th className="px-6 py-3 text-center text-sm font-medium text-gray-800 dark:text-gray-400 uppercase tracking-wider">
              Stock
            </th>
            <th className="px-6 py-3 text-center text-sm font-medium text-gray-800 dark:text-gray-400 uppercase tracking-wider">
              Cant.
            </th>
            <th className="px-6 py-3 text-center text-sm font-medium text-gray-800 dark:text-gray-400 uppercase tracking-wider">
              Acciones
            </th>
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
          {products.map((p) => (
            <ProductRow
              key={p.id}
              product={p}
              quantityInCart={quantitiesMap[p.id] || 0}
              addItem={addItem}
              updateQty={updateQty}
              removeFromCart={removeFromCart}
            />
          ))}
        </tbody>
      </table>
    </div>
  )
}
