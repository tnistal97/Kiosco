'use client'

import { formatCurrency } from '@/lib/utils'

interface StatsPanelProps {
  isLoading: boolean
  totalProducts: number
  recentSalesCount: number
  totalToday: number // ✅ AGREGADO
}

export default function StatsPanel({
  isLoading,
  totalProducts,
  recentSalesCount,
  totalToday, // ✅ AGREGADO
}: StatsPanelProps) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      {isLoading
        ? Array(3).fill(0).map((_, i) => (
            <div
              key={i}
              className="h-24 rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse"
            />
          ))
        : (
          <>
            <div className="bg-white dark:bg-[color:var(--color-background)] p-4 rounded-xl shadow">
              <p className="text-sm text-gray-500 dark:text-gray-400">Ventas de hoy</p>
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                {formatCurrency(totalToday)}
              </p>
            </div>
            <div className="bg-white dark:bg-[color:var(--color-background)] p-4 rounded-xl shadow">
              <p className="text-sm text-gray-500 dark:text-gray-400">Productos totales</p>
              <p className="text-2xl font-bold">{totalProducts}</p>
            </div>
            <div className="bg-white dark:bg-[color:var(--color-background)] p-4 rounded-xl shadow">
              <p className="text-sm text-gray-500 dark:text-gray-400">Ventas recientes</p>
              <p className="text-2xl font-bold">{recentSalesCount}</p>
            </div>
          </>
        )
      }
    </section>
  )
}
