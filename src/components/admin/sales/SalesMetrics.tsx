'use client'

import React, { useMemo } from 'react'
import { Sale } from '@/app/admin/sales/page'
import { formatCurrency } from '@/lib/formatCurrency'

interface Props {
  sales: Sale[]
}

export default function SalesMetrics({ sales }: Props) {
  const totals = useMemo(() => {
    return sales.reduce(
      (acc, sale) => {
        const amount = sale.items.reduce((s, it) => s + it.quantity * it.price, 0)
        acc[sale.paymentMethod] += amount
        acc.total += amount
        acc.count += 1
        return acc
      },
      {
        efectivo: 0,
        tarjeta: 0,
        mercado_pago: 0,
        total: 0,
        count: 0,
      }
    )
  }, [sales])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
      {/* Ventas totales */}
      <div className="bg-blue-700 p-6 rounded-lg shadow flex flex-col">
        <span className="text-sm text-blue-200">Ventas</span>
        <span className="mt-2 text-3xl font-bold">{totals.count}</span>
      </div>

      {/* Recaudación total */}
      <div className="bg-gray-700 p-6 rounded-lg shadow flex flex-col">
        <span className="text-sm text-gray-300">Recaudación Total</span>
        <span className="mt-2 text-3xl font-bold">
          {formatCurrency(totals.total)}
        </span>
      </div>

      {/* Efectivo */}
      <div className="bg-green-700 p-6 rounded-lg shadow flex flex-col">
        <span className="text-sm text-green-200">Efectivo</span>
        <span className="mt-2 text-3xl font-bold">
          {formatCurrency(totals.efectivo)}
        </span>
      </div>

      {/* Tarjeta */}
      <div className="bg-indigo-700 p-6 rounded-lg shadow flex flex-col">
        <span className="text-sm text-indigo-200">Tarjeta</span>
        <span className="mt-2 text-3xl font-bold">
          {formatCurrency(totals.tarjeta)}
        </span>
      </div>

      {/* Mercado Pago (se extiende) */}
      <div className="bg-yellow-700 p-6 rounded-lg shadow flex flex-col sm:col-span-2 lg:col-span-1">
        <span className="text-sm text-yellow-200">Mercado Pago</span>
        <span className="mt-2 text-3xl font-bold">
          {formatCurrency(totals.mercado_pago)}
        </span>
      </div>
    </div>
  )
}
