'use client'

import { useEffect, useState } from 'react'

interface Product {
  id: number
  name: string
  barcode?: string
}

interface Sale {
  id: number
  createdAt: string
  total: number
}

export default function HomeDashboard() {
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/products')
      .then(res => res.json())
      .then(setProducts)

    fetch('/api/sales/recent')
      .then(res => res.json())
      .then(setSales)
  }, [])

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.barcode?.includes(search)
  )

  return (
    <div className="min-h-screen p-6 bg-gray-50 dark:bg-black text-gray-900 dark:text-gray-100">
      <div className="max-w-6xl mx-auto space-y-10">

        <h1 className="text-3xl font-bold">Bienvenido 👋</h1>

        {/* Search bar */}
        <div className="relative">
          <input
            type="text"
            placeholder="Buscar productos por nombre o código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full p-4 pl-12 bg-white dark:bg-gray-800 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="absolute left-4 top-3.5 text-gray-400">🔍</span>
        </div>

        {/* Products */}
        <div>
          <h2 className="text-xl font-semibold mb-2">Productos</h2>
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {filteredProducts.map((p) => (
              <li key={p.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow hover:bg-gray-100 dark:hover:bg-gray-700 transition">
                <div className="font-medium">{p.name}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{p.barcode || '-'}</div>
              </li>
            ))}
            {filteredProducts.length === 0 && (
              <li className="col-span-full text-center text-gray-400">No se encontraron productos</li>
            )}
          </ul>
        </div>

        {/* Recent Sales */}
        <div>
          <h2 className="text-xl font-semibold mb-2">Ventas recientes</h2>
          <ul className="space-y-2">
            {sales.map((s) => (
              <li key={s.id} className="bg-white dark:bg-gray-800 p-4 rounded-xl shadow flex justify-between items-center">
                <span># {s.id} - {new Date(s.createdAt).toLocaleString()}</span>
                <span className="font-bold text-green-600 dark:text-green-400">${s.total.toFixed(2)}</span>
              </li>
            ))}
            {sales.length === 0 && (
              <li className="text-center text-gray-400">No hay ventas recientes</li>
            )}
          </ul>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
          <a href="/ventas" className="p-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 text-center font-semibold">🛒 Nueva venta</a>
          <a href="/stock" className="p-4 bg-yellow-500 text-white rounded-xl hover:bg-yellow-600 text-center font-semibold">📦 Stock</a>
          <a href="/productos" className="p-4 bg-purple-600 text-white rounded-xl hover:bg-purple-700 text-center font-semibold">📋 Productos</a>
          <a href="/usuarios" className="p-4 bg-gray-700 text-white rounded-xl hover:bg-gray-800 text-center font-semibold">👥 Usuarios</a>
        </div>
      </div>
    </div>
  )
}
