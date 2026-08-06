'use client'

import React from 'react'
import { useCartStore } from '@/store/cart'
import { formatCurrency } from '@/lib/formatCurrency'

interface Props {
  onOpen: () => void
}

export default function CartButtonMobile({ onOpen }: Props) {
  const items = useCartStore((s) => s.items)
  const total = items.reduce((acc, i) => acc + i.product.price * i.quantity, 0)

  return (
    <div className="fixed inset-x-0 bottom-0 flex justify-center p-4 bg-transparent md:hidden">
      <button
        onClick={onOpen}
        className="relative flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-4 rounded-full shadow-lg transition focus:outline-none focus:ring-2 focus:ring-blue-400 w-full max-w-xs text-base"
      >
        <span>🛒</span>
        <span className="font-semibold">{items.length}</span>
        <span className="text-xs">·</span>
        <span className="font-bold text-base">{formatCurrency(total)}</span>
        {items.length > 0 && (
          <span className="absolute -top-2 -right-3 bg-red-600 text-white text-[12px] w-6 h-6 rounded-full flex items-center justify-center">
            {items.length}
          </span>
        )}
      </button>
    </div>
  )
}
