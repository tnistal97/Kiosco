'use client'

import React, { useState } from 'react'
import type { Sale } from '@/app/admin/sales/page'
import SaleRow from './SaleRow'
import SaleItemsRow from './SaleItemsRow'

interface Props {
  sales: Sale[]
}

export default function SalesTable({ sales }: Props) {
  const [expanded, setExpanded] = useState<number[]>([])
  const toggle = (id: number) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 overflow-x-auto">
      <table className="min-w-full text-sm text-left">
        <thead className="bg-gray-700">
          <tr>
            <th className="px-4 py-3 text-gray-200">ID</th>
            <th className="px-4 py-3 text-gray-200">Fecha</th>
            <th className="px-4 py-3 text-gray-200">Usuario</th>
            <th className="px-4 py-3 text-gray-200">Método</th>
            <th className="px-4 py-3 text-gray-200 text-right">Total</th>
            <th className="px-4 py-3 text-gray-200 text-center">Detalle</th>
          </tr>
        </thead>
        <tbody>
          {sales.length === 0 && (
            <tr>
              <td colSpan={6} className="py-16 text-center text-gray-400">
                No hay ventas en este rango.
              </td>
            </tr>
          )}
          {sales.map((sale) => (
            <React.Fragment key={sale.id}>
              <SaleRow sale={sale} isExpanded={expanded.includes(sale.id)} onToggle={toggle} />
              {expanded.includes(sale.id) && <SaleItemsRow items={sale.items} />}
            </React.Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
