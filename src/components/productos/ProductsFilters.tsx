'use client'

import { MagnifyingGlassIcon, ArrowsRightLeftIcon } from '@heroicons/react/24/outline'
import React from 'react'
import { Category } from '@/hooks/useProducts'

interface Props {
  categories: Category[]
  categoryFilter: string
  setCategoryFilter: (v: string) => void
  searchTerm: string
  setSearchTerm: (v: string) => void
  clearFilters: () => void
  exportCSV: () => void
  setLowStockFilter: (v: boolean) => void
}

export default function ProductsFilters({
  categories,
  categoryFilter,
  setCategoryFilter,
  searchTerm,
  setSearchTerm,
  clearFilters,
  exportCSV,
  setLowStockFilter,
}: Props) {
  return (
    <div className="bg-gray-800 rounded-lg shadow-lg border border-gray-700 p-6 flex flex-col md:flex-row items-center gap-4">
      {/* Filtro por categoría */}
      <div className="w-full md:w-1/4">
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Categoría
        </label>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter(e.target.value)
            setLowStockFilter(false)
          }}
          className="w-full px-3 py-2 bg-gray-700 text-white rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
        >
          <option value="Todas">Todas</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.name}>
              {cat.name}
            </option>
          ))}
        </select>
      </div>

      {/* Buscador */}
      <div className="relative w-full md:w-1/2">
        <label className="block text-sm font-medium text-gray-300 mb-1">
          Buscar producto
        </label>
        <div className="relative">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value)
              setLowStockFilter(false)
            }}
            placeholder="Nombre o código..."
            className="w-full pl-10 pr-4 py-2 bg-gray-700 text-white rounded-md border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
          />
        </div>
      </div>

      {/* Acciones: limpiar filtros y exportar */}
      <div className="flex gap-2 flex-wrap md:mt-6 md:ml-auto">
        <button
          onClick={clearFilters}
          className="bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-500 transition"
        >
          Limpiar filtros
        </button>

      </div>
    </div>
  )
}
