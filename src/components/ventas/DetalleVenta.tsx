'use client'

import React from 'react'
import clsx from 'clsx'
import { formatCurrency } from '@/lib/formatCurrency'

interface LineaProps {
  id: number
  product: { id: number; name: string }
  quantity: number
  price: number
}

interface Props {
  saleItems: LineaProps[]
}

export default function DetalleVenta({ saleItems }: Props) {
  return (
    <tr>
      <td colSpan={8} className="bg-gray-900 px-4 py-2">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left border-collapse">
            <thead className="bg-gray-700">
              <tr>
                <th className="px-3 py-2 font-medium text-gray-100 uppercase tracking-wider">
                  Producto
                </th>
                <th className="px-3 py-2 font-medium text-gray-100 uppercase tracking-wider text-center">
                  Cantidad
                </th>
                <th className="px-3 py-2 font-medium text-gray-100 uppercase tracking-wider text-right">
                  Precio U.
                </th>
                <th className="px-3 py-2 font-medium text-gray-100 uppercase tracking-wider text-right">
                  Subtotal
                </th>
              </tr>
            </thead>
            <tbody>
              {saleItems.map((line, idx) => (
                <tr key={line.id} className={clsx(idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-900')}>
                  <td className="px-3 py-2 text-gray-100 whitespace-nowrap">{line.product.name}</td>
                  <td className="px-3 py-2 text-gray-100 text-center">{line.quantity}</td>
                  <td className="px-3 py-2 text-gray-100 text-right">
                    {formatCurrency(line.price)}
                  </td>
                  <td className="px-3 py-2 text-gray-100 text-right font-semibold">
                    {formatCurrency(line.quantity * line.price)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </td>
    </tr>
  )
}
