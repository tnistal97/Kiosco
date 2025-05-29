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
      setCart([...cart, { ...product, quantity: 1, price: 100 }]) // Precio fijo por ahora
    }
  }

  const removeFromCart = (id: number) => {
    setCart(cart.filter((item) => item.id !== id))
  }

  const makeSale = async () => {
    const userId = 1
    const branchId = 1

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
    <div className="min-h-screen bg-[color:var(--color-background)] text-[color:var(--color-foreground)] p-6">
      <div className="max-w-6xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">🛒 Punto de Venta</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Lista de productos */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-xl font-semibold mb-4">📦 Productos</h2>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {products.map(p => (
                <div
                  key={p.id}
                  className="flex justify-between items-center px-4 py-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
                >
                  <span>{p.name}</span>
                  <button
                    onClick={() => addToCart(p)}
                    className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded transition"
                  >
                    Agregar
                  </button>
                </div>
              ))}
              {products.length === 0 && (
                <div className="text-zinc-400 text-center py-4">No hay productos</div>
              )}
            </div>
          </div>

          {/* Carrito */}
          <div className="bg-white dark:bg-zinc-900 rounded-2xl shadow-sm border border-zinc-200 dark:border-zinc-800 p-6">
            <h2 className="text-xl font-semibold mb-4">🧾 Carrito</h2>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {cart.map((c) => (
                <div key={c.id} className="flex justify-between items-center px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800">
                  <div className="flex flex-col">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-sm text-zinc-500">Cantidad: {c.quantity}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">${(c.quantity * c.price).toFixed(2)}</span>
                    <button
                      onClick={() => removeFromCart(c.id)}
                      className="text-xs bg-red-500 hover:bg-red-600 text-white px-2 py-1 rounded"
                    >
                      Quitar
                    </button>
                  </div>
                </div>
              ))}
              {cart.length === 0 && (
                <div className="text-zinc-400 text-center py-4">Carrito vacío</div>
              )}
            </div>

            {/* Total y botón */}
            <div className="mt-6 border-t dark:border-zinc-700 pt-4 text-right">
              <div className="text-lg font-bold mb-4">
                Total: ${cart.reduce((acc, c) => acc + c.quantity * c.price, 0).toFixed(2)}
              </div>
              <button
                onClick={makeSale}
                disabled={cart.length === 0}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-medium py-3 rounded-lg disabled:bg-gray-300 disabled:cursor-not-allowed transition"
              >
                Confirmar venta
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
