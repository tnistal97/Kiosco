'use client'

import React from 'react'
import {
  ChevronDownIcon,
  ChevronUpIcon,
  CurrencyDollarIcon,
  CreditCardIcon,
  BanknotesIcon,
} from '@heroicons/react/24/outline'
import type { Sale } from '@/app/admin/sales/page'

interface Props {
  sale: Sale
  isExpanded: boolean
  onToggle: (id: number) => void
}

export default function SaleRow({ sale, isExpanded, onToggle }: Props) {
  const total = sale.items.reduce((sum, it) => sum + it.quantity * it.price, 0)
  const d = new Date(sale.date)
  const date = d.toLocaleDateString('es-AR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const time = d.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  // Icono según método. Una venta puede no tener movimiento de caja asociado,
  // en cuyo caso el metodo llega null.
  const ICONOS: Record<string, typeof BanknotesIcon> = {
    efectivo: BanknotesIcon,
    tarjeta: CreditCardIcon,
    mercado_pago: CurrencyDollarIcon,
  }
  const MethodIcon = (sale.paymentMethod ? ICONOS[sale.paymentMethod] : null) ?? BanknotesIcon
  const metodoTexto = sale.paymentMethod?.replace('_', ' ') ?? 'sin registrar'

  return (
    <tr
      className="bg-gray-800 hover:bg-gray-700 cursor-pointer transition-colors"
      onClick={() => onToggle(sale.id)}
    >
      <td className="px-4 py-3 text-gray-100">{sale.id}</td>
      <td className="px-4 py-3 text-gray-100">
        {date} {time}
      </td>
      <td className="px-4 py-3 text-gray-100">{sale.user.name}</td>
      <td className="px-4 py-3 text-gray-100 flex items-center gap-1">
        <MethodIcon className="w-5 h-5 text-gray-200" />
        <span className="capitalize">{metodoTexto}</span>
      </td>
      <td className="px-4 py-3 text-gray-100 text-right font-semibold">${total.toFixed(2)}</td>
      <td className="px-4 py-3 text-gray-100 text-center">
        {isExpanded ? (
          <ChevronUpIcon className="w-5 h-5 inline-block" />
        ) : (
          <ChevronDownIcon className="w-5 h-5 inline-block" />
        )}
      </td>
    </tr>
  )
}
