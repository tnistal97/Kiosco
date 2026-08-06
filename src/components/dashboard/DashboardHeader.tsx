'use client'
import { formatDate } from '@/lib/utils'

export default function DashboardHeader() {
  return (
    <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold">👋 Bienvenido al Kiosco</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Vista general y accesos rápidos</p>
      </div>
      <div className="text-sm text-gray-500 dark:text-gray-400">
        {formatDate(new Date(), 'long')}
      </div>
    </header>
  )
}
