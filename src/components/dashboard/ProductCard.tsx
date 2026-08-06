// src/components/dashboard/ProductCard.tsx
'use client'

import React from 'react'
import type { Product } from '@/types'
import { formatCurrency } from '@/lib/formatCurrency'

interface ProductCardProps {
  product: Product
  quantityInCart: number
  onAdd: (product: Product) => void
  onIncrease: (productId: number) => void
  onDecrease: (productId: number) => void
}

export default function ProductCard({
  product,
  quantityInCart,
  onAdd,
  onIncrease,
  onDecrease,
}: ProductCardProps) {
  const inStock = product.totalStock > 0

  return (
    <div
      className={`
        relative flex flex-col justify-between
        rounded-2xl border
        bg-white dark:bg-gray-800
        border-gray-200 dark:border-gray-700
        p-4
        shadow-sm hover:shadow-md transition
        ${inStock ? '' : 'opacity-60 cursor-not-allowed'}
      `}
    >
      {/* Nombre y Código */}
      <div className="flex flex-col gap-1">
        <h3
          className="text-sm sm:text-base font-semibold text-gray-900 dark:text-gray-100 truncate"
          title={product.name}
        >
          {product.name}
        </h3>
        <p className="text-[10px] sm:text-xs text-gray-500 dark:text-gray-400">
          {product.barcode ?? '—'}
        </p>
      </div>

      {/* Precio y Stock */}
      <div className="mt-3 flex items-center justify-between">
        <span className="text-base sm:text-lg font-semibold text-green-600">
          {formatCurrency(product.price)}
        </span>
        <span
          className={`
            text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-full
            ${inStock ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-600'}
          `}
        >
          {inStock ? `Stock: ${product.totalStock}` : 'Sin stock'}
        </span>
      </div>

      {/* Selector de Cantidad o Botón Agregar */}
      <div className="mt-4">
        {inStock ? (
          quantityInCart > 0 ? (
            <div className="flex items-center justify-between bg-gray-50 dark:bg-gray-700 p-2 rounded-lg">
              <button
                onClick={() => onDecrease(product.id)}
                disabled={quantityInCart <= 1}
                className={`
                  w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center
                  rounded-md
                  bg-red-500 text-white
                  hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-300
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition
                `}
                aria-label={`Disminuir cantidad de ${product.name}`}
              >
                –
              </button>
              <span className="text-base sm:text-lg font-medium text-gray-900 dark:text-gray-100">
                {quantityInCart}
              </span>
              <button
                onClick={() => onIncrease(product.id)}
                className={`
                  w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center
                  rounded-md
                  bg-blue-600 text-white
                  hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300
                  transition
                `}
                aria-label={`Aumentar cantidad de ${product.name}`}
              >
                +
              </button>
            </div>
          ) : (
            <button
              onClick={() => onAdd(product)}
              aria-label={`Agregar ${product.name} al carrito`}
              className="
                w-full py-2 rounded-lg text-sm sm:text-base font-semibold
                bg-blue-600 text-white
                hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-300
                transition
              "
            >
              Agregar
            </button>
          )
        ) : (
          <button
            disabled
            className="
              w-full py-2 rounded-lg text-sm sm:text-base font-semibold
              bg-gray-300 text-gray-600 cursor-not-allowed
            "
          >
            Sin stock
          </button>
        )}
      </div>
    </div>
  )
}
