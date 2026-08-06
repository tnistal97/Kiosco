'use client'

import React from 'react'

interface Product {
  id: number
  name: string
}

interface SaleItem {
  id: number
  product: Product
  quantity: number
  price: number
}

interface Props {
  items: SaleItem[]
}

export default function SaleItemsRow({ items }: Props) {
  return (
    <tr>
      <td colSpan={6} className="bg-gray-700 px-4 py-3">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-left">
            <thead>
              <tr>
                <th className="px-3 py-2 text-gray-200">Producto</th>
                <th className="px-3 py-2 text-gray-200 text-center">Cantidad</th>
                <th className="px-3 py-2 text-gray-200 text-right">Precio U.</th>
                <th className="px-3 py-2 text-gray-200 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="odd:bg-gray-700 even:bg-gray-800">
                  <td className="px-3 py-2 text-gray-100">{it.product.name}</td>
                  <td className="px-3 py-2 text-gray-100 text-center">{it.quantity}</td>
                  <td className="px-3 py-2 text-gray-100 text-right">${it.price.toFixed(2)}</td>
                  <td className="px-3 py-2 text-gray-100 text-right font-semibold">
                    ${(it.quantity * it.price).toFixed(2)}
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
