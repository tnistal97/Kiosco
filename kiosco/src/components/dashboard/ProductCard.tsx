'use client'
import { Product } from '@/types'
import { useCartStore } from '@/store/cart'

interface Props {
  product: Product
}

export default function ProductCard({ product }: Props) {
  const addToCart = useCartStore((state) => state.addToCart)

  return (
    <div
      onClick={() => addToCart(product)}
      className="bg-white dark:bg-[color:var(--color-background)] p-4 rounded-xl shadow hover:shadow-md transition-shadow cursor-pointer border border-gray-200 dark:border-gray-700 h-full"
    >
      <div className="font-semibold truncate">{product.name}</div>
      <div className="text-sm text-gray-500 dark:text-gray-400 mt-1">
        {product.barcode ?? 'Sin código'}
      </div>
      {product.stock !== undefined && product.stock < 5 && (
        <div className="text-xs text-red-500 mt-2">⚠️ Stock bajo ({product.stock})</div>
      )}
    </div>
  )
}
