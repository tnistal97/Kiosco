'use client'
import { useRouter } from 'next/navigation'
import { Sale } from '@/types'
import { formatCurrency, formatDate } from '@/lib/utils'

interface Props {
  isLoading: boolean
  sales: Sale[]
}

export default function RecentSales({ isLoading, sales }: Props) {
  const router = useRouter()

  if (isLoading) {
    return (
      <>
        {Array(5)
          .fill(0)
          .map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-200 dark:bg-gray-800 animate-pulse mb-2" />
          ))}
      </>
    )
  }

  if (sales.length === 0) {
    return (
      <div className="p-8 text-center text-gray-500 dark:text-gray-400">
        No hay ventas recientes
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-[color:var(--color-background)] rounded-xl shadow divide-y divide-gray-200 dark:divide-gray-700">
      {sales.map(s => (
        <div
          key={s.id}
          onClick={() => router.push(`/sales/${s.id}`)}
          className="p-4 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-900 cursor-pointer transition-colors"
        >
          <div>
            <div className="font-medium">Venta #{s.id}</div>
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {formatDate(s.createdAt, 'time')}
            </div>
          </div>
          <div className="font-bold text-green-600 dark:text-green-400">
            {formatCurrency(s.total)}
          </div>
        </div>
      ))}
    </div>
  )
}
