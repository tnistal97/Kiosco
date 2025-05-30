'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

import DashboardHeader from '@/components/dashboard/DashboardHeader'
import StatsPanel from '@/components/dashboard/StatsPanel'
import SearchBar from '@/components/dashboard/SearchBar'
import ProductCard from '@/components/dashboard/ProductCard'
import RecentSales from '@/components/dashboard/RecentSales'
import CartSidebar from '@/components/dashboard/CartSidebar'

import type { Product, Sale } from '@/types'

export default function DashboardPage() {
  const router = useRouter()
  const [products, setProducts] = useState<Product[]>([])
  const [sales, setSales] = useState<Sale[]>([])
  const [search, setSearch] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const totalHoy = sales.reduce((sum, s) => sum + s.total, 0)

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true)
        const [prodRes, salesRes] = await Promise.all([
          fetch('/api/products'),
          fetch('/api/sales/recent'),
        ])
        if (!prodRes.ok || !salesRes.ok) {
          throw new Error('Error al cargar datos')
        }
        const [prodData, salesData] = await Promise.all([
          prodRes.json(),
          salesRes.json(),
        ])
        setProducts(prodData)
        setSales(salesData)
      } catch (e) {
        console.error(e)
        setError('No se pudieron cargar los datos. Intentá nuevamente más tarde.')
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [])

  const filtered = products.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.barcode?.includes(search)
  )

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[color:var(--color-background)]">
        <div className="bg-white dark:bg-[color:var(--color-background)] p-6 rounded-lg shadow text-center max-w-md">
          <p className="text-xl mb-4">⚠️ {error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-[color:var(--color-background)]">
      <main className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
        <DashboardHeader />

        <StatsPanel
          isLoading={isLoading}
          totalProducts={products.length}
          recentSalesCount={sales.length}
          totalToday={totalHoy}
        />

        <SearchBar
          value={search}
          onChange={(q) => setSearch(q)}
          disabled={isLoading}
        />

        <section>
          <h2 className="text-xl font-semibold mb-3">Productos</h2>
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {Array(6).fill(null).map((_, i) => (
                <div key={i} className="h-32 rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse" />
              ))}
            </div>
          ) : filtered.length > 0 ? (
            <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {filtered.map((p) => (
                <li key={p.id}>
                  <ProductCard product={p} />
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl">
              <span className="text-4xl text-gray-400">🔍</span>
              <p className="mt-2 text-lg font-medium">No se encontraron productos</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Probá otra búsqueda</p>
            </div>
          )}
        </section>

        <RecentSales sales={sales} isLoading={isLoading} />
      </main>

      {/* Cart Sidebar (mobile fixed bottom, desktop static on right) */}
      <div className="block lg:hidden fixed bottom-0 left-0 w-full z-50">
        <CartSidebar />
      </div>

      <div className="hidden lg:block fixed top-0 right-0 h-full w-80 p-4 overflow-y-auto bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-700">
        <CartSidebar />
      </div>
    </div>
  )
}
