// src/components/caja/PaymentMethodSelector.tsx
'use client'

import React from 'react'

interface Props {
  value: 'efectivo' | 'tarjeta' | 'mercado_pago'
  onChange: (value: 'efectivo' | 'tarjeta' | 'mercado_pago') => void
  className?: string // ✅ Agregado para que acepte className
}

export default function PaymentMethodSelector({
  value,
  onChange,
  className = '',
}: Props) {
  const options: { label: string; value: 'efectivo' | 'tarjeta' | 'mercado_pago' }[] = [
    { label: 'Efectivo', value: 'efectivo' },
    { label: 'Tarjeta', value: 'tarjeta' },
    { label: 'Mercado Pago', value: 'mercado_pago' },
  ]

  return (
    <div className={`flex gap-2 ${className}`}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`flex-1 px-3 py-2 rounded-lg font-medium border transition
            ${
              value === opt.value
                ? 'bg-blue-600 text-white border-blue-700'
                : 'bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-300 dark:hover:bg-gray-600'
            }`}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
