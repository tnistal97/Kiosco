import {
  DocumentChartBarIcon,
} from '@heroicons/react/24/outline'
import React from 'react'

interface Props {
  onCreate: () => void
}

export default function ProductsHeader({ onCreate }: Props) {
  return (
    <div className="flex items-center justify-between">
      <h1 className="flex items-center text-3xl font-bold text-blue-400">
        <DocumentChartBarIcon className="w-8 h-8 text-blue-400 mr-2" />
        Productos
      </h1>
      <button
        onClick={onCreate}
        className="flex items-center gap-2 bg-green-600 px-4 py-2 rounded-lg shadow-lg hover:bg-green-700 transition"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 4v16m8-8H4"
          />
        </svg>
        Nuevo Producto
      </button>
    </div>
  )
}
