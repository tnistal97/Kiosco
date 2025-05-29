'use client'
import { useEffect, useState } from 'react'

interface Product {
  id: number
  name: string
  barcode?: string
  category?: string
  description?: string
}

export default function ProductosPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [name, setName] = useState('')
  const [barcode, setBarcode] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')

  const fetchProducts = async () => {
    const res = await fetch('/api/products')
    const data = await res.json()
    setProducts(data)
  }

  const createProduct = async () => {
    await fetch('/api/products', {
      method: 'POST',
      body: JSON.stringify({ name, barcode, category, description }),
      headers: { 'Content-Type': 'application/json' },
    })
    setName('')
    setBarcode('')
    setCategory('')
    setDescription('')
    fetchProducts()
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Productos</h1>

      <div className="bg-white p-4 rounded shadow mb-6">
        <h2 className="text-lg font-semibold mb-2">Nuevo producto</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input className="border p-2 rounded" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="border p-2 rounded" placeholder="Código de barra" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
          <input className="border p-2 rounded" placeholder="Categoría" value={category} onChange={(e) => setCategory(e.target.value)} />
          <input className="border p-2 rounded" placeholder="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button onClick={createProduct} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">Guardar</button>
      </div>

      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-left">
              <th className="px-4 py-2">ID</th>
              <th className="px-4 py-2">Nombre</th>
              <th className="px-4 py-2">Código</th>
              <th className="px-4 py-2">Categoría</th>
              <th className="px-4 py-2">Descripción</th>
            </tr>
          </thead>
          <tbody>
            {products.map(p => (
              <tr key={p.id} className="border-t">
                <td className="px-4 py-2">{p.id}</td>
                <td className="px-4 py-2">{p.name}</td>
                <td className="px-4 py-2">{p.barcode || '-'}</td>
                <td className="px-4 py-2">{p.category || '-'}</td>
                <td className="px-4 py-2">{p.description || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
