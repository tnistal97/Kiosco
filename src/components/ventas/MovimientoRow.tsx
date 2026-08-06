'use client'

import React from 'react'
import clsx from 'clsx'
import type { CashMovement } from '@/types/caja'
import { formatCurrency } from '@/lib/formatCurrency'
import { ChevronDownIcon, ChevronUpIcon } from '@heroicons/react/24/outline'
import DeleteButton from './DeleteButton'

interface Linea {
  id: number
  product: { id: number; name: string }
  quantity: number
  price: number
}

interface Props {
  movimiento: CashMovement & {
    saleItems: Linea[] | null
  }
  index: number
  isExpanded: boolean
  onToggleExpand: (id: number) => void
  onDeleted: (id: number) => void
}

export default function MovimientoRow({
  movimiento: m,
  index,
  isExpanded,
  onToggleExpand,
  onDeleted,
}: Props) {
  const isSale = Array.isArray(m.saleItems) && m.saleItems.length > 0
  // Una venta ya anulada no se puede volver a anular.
  const sePuedeAnular = isSale && m.saleId !== null && m.saleStatus === 'completed'

  return (
    <>
      <tr
        className={clsx(
          index % 2 === 0 ? 'bg-gray-700' : 'bg-gray-800',
          'hover:bg-gray-600 transition-colors',
          isSale ? 'cursor-pointer' : '',
        )}
        onClick={() => isSale && onToggleExpand(m.id)}
      >
        {/* ID */}
        <td className="px-4 py-2 text-gray-100">{m.id}</td>

        {/* Método de pago */}
        <td className="px-4 py-2 text-gray-100 capitalize">{m.paymentMethod.replace('_', ' ')}</td>

        {/* Monto */}
        <td
          className={clsx(
            'px-4 py-2 text-right font-semibold',
            m.amount < 0 ? 'text-red-400' : 'text-green-400',
          )}
        >
          {formatCurrency(m.amount)}
        </td>

        {/* Descripción */}
        <td className="px-4 py-2 text-gray-100">{m.description || '—'}</td>

        {/* Fecha */}
        <td className="px-4 py-2 text-gray-100">
          {new Date(m.date).toLocaleString('es-AR', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </td>

        {/* Usuario */}
        <td className="px-4 py-2 text-gray-100">{m.user.name}</td>

        {/* Botón detalle */}
        <td className="px-4 py-2 text-center">
          {isSale ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand(m.id)
              }}
              className="p-1 rounded-full hover:bg-gray-600 text-gray-100 focus:outline-none"
              aria-label={isExpanded ? 'Ocultar detalle' : 'Mostrar detalle'}
            >
              {isExpanded ? (
                <ChevronUpIcon className="w-5 h-5" />
              ) : (
                <ChevronDownIcon className="w-5 h-5" />
              )}
            </button>
          ) : (
            <span className="text-gray-500">—</span>
          )}
        </td>

        {/* Anular venta */}
        <td className="px-4 py-2 text-center">
          {sePuedeAnular ? (
            <DeleteButton saleId={m.saleId!} onDeleted={onDeleted} />
          ) : m.saleStatus === 'canceled' ? (
            <span className="text-amber-400 text-xs font-medium">Anulada</span>
          ) : (
            <span className="text-gray-500">—</span>
          )}
        </td>
      </tr>
    </>
  )
}
