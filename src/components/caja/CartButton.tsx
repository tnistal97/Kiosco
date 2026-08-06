'use client'

import { ShoppingCartIcon } from '@heroicons/react/24/outline'
import { formatCurrency } from '@/lib/formatCurrency'

interface CartButtonProps {
  onClick: () => void
  total: number
}

export default function CartButton({ 
  onClick, 
  total 
}: CartButtonProps) {
  return (
    <button
      onClick={onClick}
      className="md:hidden flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg transition"
      aria-label="Abrir carrito"
    >
      <ShoppingCartIcon className="w-6 h-6" />
      <span className="font-medium">{formatCurrency(total)}</span>
    </button>
  )
}