import {
  DocumentChartBarIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'
import React, { Dispatch, SetStateAction } from 'react'

interface Props {
  totalProductos: number
  totalUnidades: number
  stockCriticoCount: number
  lowStockFilter: boolean
  // Aquí permitimos función de actualización:
  setLowStockFilter: Dispatch<SetStateAction<boolean>>
  clearFilters: () => void
  categoryFilter: string
  searchTerm: string
}

export default function ProductsMetrics({
  totalProductos,
  totalUnidades,
  stockCriticoCount,
  lowStockFilter,
  setLowStockFilter,
  clearFilters,
  categoryFilter,
  searchTerm,
}: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Total de Productos */}
      <div
        onClick={() => {
          clearFilters()
          setLowStockFilter(false)
        }}
        className={clsx(
          'flex items-center bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 cursor-pointer transition hover:bg-gray-700',
          lowStockFilter === false &&
            categoryFilter === 'Todas' &&
            searchTerm === '' &&
            'ring-2 ring-blue-500'
        )}
      >
        <div className="bg-blue-500/20 p-3 rounded-full">
          <DocumentChartBarIcon className="w-6 h-6 text-blue-500" />
        </div>
        <div className="ml-4">
          <p className="text-sm text-gray-300">Total de Productos</p>
          <p className="text-2xl font-semibold">{totalProductos}</p>
        </div>
      </div>

      {/* Unidades Totales */}
      <div className="flex items-center bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700">
        <div className="bg-yellow-500/20 p-3 rounded-full">
          <ChevronUpIcon className="w-6 h-6 text-yellow-500" />
        </div>
        <div className="ml-4">
          <p className="text-sm text-gray-300">Unidades Totales</p>
          <p className="text-2xl font-semibold">{totalUnidades}</p>
        </div>
      </div>

      {/* Stock Crítico */}
      <div
        onClick={() => {
          setLowStockFilter((prev) => !prev)
        }}
        className={clsx(
          'flex items-center bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 cursor-pointer transition hover:bg-gray-700',
          lowStockFilter && 'ring-2 ring-red-500'
        )}
      >
        <div className="bg-red-500/20 p-3 rounded-full">
          <ChevronDownIcon className="w-6 h-6 text-red-500" />
        </div>
        <div className="ml-4">
          <p className="text-sm text-gray-300">Stock Crítico (&lt;10)</p>
          <p className="text-2xl font-semibold">{stockCriticoCount}</p>
        </div>
      </div>
    </div>
  )
}
