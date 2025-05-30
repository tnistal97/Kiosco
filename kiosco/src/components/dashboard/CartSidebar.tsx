'use client'
import { useCartStore } from '@/store/cart'
import { CartItem } from '@/types'
import { formatCurrency } from '@/lib/utils'

export default function CartSidebar() {
  const items = useCartStore((state) => state.items)
  const updateQuantity = useCartStore((state) => state.updateQuantity)
  const removeFromCart = useCartStore((state) => state.removeFromCart)
  const clearCart = useCartStore((state) => state.clearCart)

  const total = items.reduce(
    (acc: number, item: CartItem) => acc + item.product.price * item.quantity,
    0
  )

  return (
    <aside className="fixed right-0 top-0 w-72 h-full bg-white dark:bg-[color:var(--color-background)] shadow-xl p-4 overflow-y-auto z-50">
      <h2 className="text-lg font-semibold mb-4">🛒 Carrito</h2>

      {items.length === 0 ? (
        <p className="text-gray-500">El carrito está vacío</p>
      ) : (
        <>
          <ul className="space-y-4">
            {items.map(({ product, quantity }: CartItem) => (
              <li key={product.id} className="flex justify-between items-center">
                <div>
                  <p className="font-medium">{product.name}</p>
                  <input
                    type="number"
                    value={quantity}
                    min={1}
                    onChange={(e) =>
                      updateQuantity(product.id, parseInt(e.target.value, 10))
                    }
                    className="w-16 p-1 border rounded mt-1"
                  />
                </div>
                <button
                  onClick={() => removeFromCart(product.id)}
                  className="text-red-500 ml-2"
                >
                  ✖
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-6 font-bold text-right">
            Total: {formatCurrency(total)}
          </div>
          <button
            onClick={clearCart}
            className="mt-4 w-full bg-red-600 text-white py-2 rounded hover:bg-red-700 transition"
          >
            Vaciar carrito
          </button>
        </>
      )}
    </aside>
  )
}
