'use client'
import { useEffect, useState } from 'react'

interface Product {
  id: number
  name: string
  barcode?: string
}
interface CartItem extends Product {
  quantity: number
  price: number
}

export default function VentasPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [cart, setCart] = useState<CartItem[]>([])

  const fetchProducts = async () => {
    const res = await fetch('/api/products')
    const data = await res.json()
    setProducts(data)
  }

  const addToCart = (product: Product) => {
    const existing = cart.find((i) => i.id === product.id)
    if (existing) {
      setCart(cart.map((i) => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i))
    } else {
      setCart([...cart, { ...product, quantity: 1, price: 100 }]) // precio fijo por ahora
    }
  }

  const makeSale = async () => {
    const userId = 1 // reemplazar por ID real
    const branchId = 1 // reemplazar por ID real

    await fetch('/api/sales', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        branchId,
        items: cart.map(c => ({
          productId: c.id,
          quantity: c.quantity,
          price: c.price,
        }))
      }),
      headers: { 'Content-Type': 'application/json' }
    })

    setCart([])
  }

  useEffect(() => {
    fetchProducts()
  }, [])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Ventas</h1>

      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <h2 className="font-semibold mb-2">Productos</h2>
          <ul className="bg-white rounded shadow divide-y">
            {products.map(p => (
              <li key={p.id} className="p-2 flex justify-between items-center">
                <span>{p.name}</span>
                <button onClick={() => addToCart(p)} className="bg-blue-600 text-white px-2 py-1 rounded text-sm hover:bg-blue-700">Agregar</button>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="font-semibold mb-2">Carrito</h2>
          <ul className="bg-white rounded shadow divide-y">
            {cart.map(c => (
              <li key={c.id} className="p-2 flex justify-between">
                <span>{c.name} x {c.quantity}</span>
                <span>${c.quantity * c.price}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 text-right font-bold">Total: ${cart.reduce((acc, c) => acc + c.quantity * c.price, 0)}</div>
          <button onClick={makeSale} className="mt-4 w-full bg-green-600 text-white py-2 rounded hover:bg-green-700">Confirmar venta</button>
        </div>
      </div>
    </div>
  )
}
