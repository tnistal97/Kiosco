'use client'

import React, { useState } from 'react'
import { formatCurrency } from '@/lib/formatCurrency'

interface Props {
  total: number
  itemsCount: number
  clearCart: () => void
  confirmSale: (paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago') => void
}

export default function CartFooter({ total, itemsCount, clearCart, confirmSale }: Props) {
  // Estado local del método de pago
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'tarjeta' | 'mercado_pago'>(
    'efectivo',
  )

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 px-6 py-4 space-y-4 bg-white dark:bg-gray-800">
      {/* 1) Selección de método de pago */}
      <div className="flex flex-col">
        <label className="text-sm text-gray-600 dark:text-gray-400 mb-1">Método de Pago</label>
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value as any)}
          className="w-full px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
        >
          <option value="efectivo">Efectivo</option>
          <option value="tarjeta">Tarjeta</option>
          <option value="mercado_pago">Mercado Pago</option>
        </select>
      </div>

      {/* 2) Total */}
      <div className="flex justify-between font-semibold text-gray-900 dark:text-gray-100 text-lg">
        <span>Total</span>
        <span className="text-green-600 dark:text-green-400">{formatCurrency(total)}</span>
      </div>

      {/* 3) Botones de acción */}
      <button
        onClick={() => confirmSale(paymentMethod)}
        disabled={itemsCount === 0}
        className="w-full py-4 rounded-lg bg-green-600 hover:bg-green-700 text-white text-lg font-semibold transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-green-400"
      >
        Confirmar Venta
      </button>
      <button
        onClick={clearCart}
        disabled={itemsCount === 0}
        className="w-full py-4 rounded-lg bg-red-600 hover:bg-red-700 text-white text-lg font-semibold transition disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-red-400"
      >
        Cancelar y Vaciar
      </button>
    </div>
  )
}
