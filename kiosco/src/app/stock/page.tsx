'use client'

import { useEffect, useState } from 'react'

interface StockItem {
  id: number
  quantity: number
  branch: { name: string }
  product: {
    name: string
    barcode?: string
  }
}

export default function StockPage() {
  const [stock, setStock] = useState<StockItem[]>([])

  const fetchStock = async () => {
    const res = await fetch('/api/stock')
    const data = await res.json()
    setStock(data)
  }

  useEffect(() => {
    fetchStock()
  }, [])

  return (
    <div className="min-h-screen bg-[color:var(--color-background)] text-[color:var(--color-foreground)] p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-blue-700 dark:text-blue-400">📦 Inventario por Sucursal</h1>

        <div className="bg-white dark:bg-zinc-900 p-6 rounded-xl shadow-sm border border-gray-200 dark:border-zinc-700 overflow-auto">
          <table className="w-full min-w-[700px] text-sm text-left">
            <thead>
              <tr className="bg-gray-100 dark:bg-zinc-800 text-gray-700 dark:text-gray-200 border-b">
                <th className="px-4 py-2">ID</th>
                <th className="px-4 py-2">Producto</th>
                <th className="px-4 py-2">Código</th>
                <th className="px-4 py-2">Sucursal</th>
                <th className="px-4 py-2">Cantidad</th>
              </tr>
            </thead>
            <tbody>
              {stock.map((item) => (
                <tr key={item.id} className="border-t hover:bg-gray-50 dark:hover:bg-zinc-800">
                  <td className="px-4 py-2">{item.id}</td>
                  <td className="px-4 py-2 font-medium">{item.product.name}</td>
                  <td className="px-4 py-2">{item.product.barcode || '-'}</td>
                  <td className="px-4 py-2">{item.branch.name}</td>
                  <td className="px-4 py-2 text-right">{item.quantity}</td>
                </tr>
              ))}
              {stock.length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-gray-400 py-6">
                    No hay datos de stock cargados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
