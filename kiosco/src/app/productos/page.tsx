'use client'
import { useEffect, useState } from 'react'

interface Category { id: number; name: string }
interface Product {
  id: number
  name: string
  barcode?: string
  description?: string
  price: number
  category?: { name: string }
}

export default function ProductosPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [name, setName] = useState('')
  const [barcode, setBarcode] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')

  useEffect(() => {
    fetch('/api/products').then(r => r.json()).then(setProducts)
    fetch('/api/categories').then(r => r.json()).then(setCategories)
  }, [])

  const createProduct = async () => {
    if (!name || !categoryId || !price) {
      return alert('Nombre, categoría y precio son obligatorios')
    }
    await fetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, barcode, categoryId: +categoryId,
        description, price: +price
      })
    })
    setName(''); setBarcode(''); setCategoryId(''); setDescription(''); setPrice('')
    const updated = await fetch('/api/products').then(r => r.json())
    setProducts(updated)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <h1 className="text-3xl font-extrabold text-gray-800 dark:text-gray-100">
          📦 Productos
        </h1>

        {/* Formulario */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200">
            Agregar producto
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <input
              className="border border-gray-300 dark:border-gray-600 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              placeholder="Nombre *"
              value={name}
              onChange={e => setName(e.target.value)}
            />
            <input
              className="border border-gray-300 dark:border-gray-600 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              placeholder="Código de barra"
              value={barcode}
              onChange={e => setBarcode(e.target.value)}
            />
            <select
              className="border border-gray-300 dark:border-gray-600 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
            >
              <option value="">Categoría *</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              className="border border-gray-300 dark:border-gray-600 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              placeholder="Descripción"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
            <input
              type="number"
              className="border border-gray-300 dark:border-gray-600 p-3 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              placeholder="Precio *"
              value={price}
              onChange={e => setPrice(e.target.value)}
            />
          </div>
          <button
            onClick={createProduct}
            className="mt-6 px-8 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full shadow transition"
          >
            Guardar producto
          </button>
        </div>

        {/* Lista */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg border border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold mb-4 text-gray-700 dark:text-gray-200">
            Todos los productos
          </h2>

          {/* Desktop Table */}
          <div className="hidden md:block overflow-auto">
            <table className="w-full text-sm text-left border-separate border-spacing-y-2">
              <thead className="sticky top-0 bg-gray-100 dark:bg-gray-700">
                <tr>
                  {['ID','Nombre','Código','Categoría','Descripción','Precio'].map(h => (
                    <th key={h} className="px-4 py-2 font-medium text-gray-600 dark:text-gray-300">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition">
                    <td className="px-4 py-3 font-medium">{p.id}</td>
                    <td className="px-4 py-3">{p.name}</td>
                    <td className="px-4 py-3">{p.barcode || '-'}</td>
                    <td className="px-4 py-3">{p.category?.name || '-'}</td>
                    <td className="px-4 py-3">{p.description || '-'}</td>
                    <td className="px-4 py-3 text-right">${p.price.toFixed(2)}</td>
                  </tr>
                ))}
                {products.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-gray-400 dark:text-gray-500">
                      No hay productos.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-4">
            {products.map(p => (
              <div
                key={p.id}
                className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg shadow hover:shadow-md transition"
              >
                <div className="flex justify-between items-center mb-2">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">
                    #{p.id} {p.name}
                  </span>
                  <span className="text-blue-600 dark:text-blue-400 font-medium">
                    ${p.price.toFixed(2)}
                  </span>
                </div>
                <p className="text-gray-600 dark:text-gray-400">
                  <strong>Categoría:</strong> {p.category?.name || '-'}
                </p>
                <p className="text-gray-600 dark:text-gray-400">
                  <strong>Código:</strong> {p.barcode || '-'}
                </p>
                {p.description && (
                  <p className="text-gray-600 dark:text-gray-400 mt-1">
                    <strong>Detalle:</strong> {p.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
