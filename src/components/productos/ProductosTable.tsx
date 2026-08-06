import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'
import React from 'react'

import { Product } from '@/hooks/useProducts'

type SortKey = 'id' | 'name' | 'category' | 'stock' | 'price'

interface Props {
  data: Product[]
  sortConfig: { key: SortKey; direction: 'asc' | 'desc' }
  onSort: (key: SortKey) => void
  onEdit: (p: Product) => void
  onDelete: (id: number) => void
}

export default function ProductsTable({ data, sortConfig, onSort, onEdit, onDelete }: Props) {
  return (
    <div className="bg-gray-800 rounded-xl shadow-lg border border-gray-700 overflow-x-auto">
      <table className="min-w-full text-sm text-left border-collapse">
        <thead className="bg-gray-700 border-b border-gray-600 sticky top-0 z-10">
          <tr>
            <th
              className="px-4 py-3 font-semibold text-white cursor-pointer select-none"
              onClick={() => onSort('id')}
            >
              <div className="flex items-center">
                ID
                {sortConfig.key === 'id' &&
                  (sortConfig.direction === 'asc' ? (
                    <ChevronUpIcon className="w-4 h-4 ml-1 text-white" />
                  ) : (
                    <ChevronDownIcon className="w-4 h-4 ml-1 text-white" />
                  ))}
              </div>
            </th>
            <th
              className="px-4 py-3 font-semibold text-white cursor-pointer select-none"
              onClick={() => onSort('name')}
            >
              <div className="flex items-center">
                Nombre
                {sortConfig.key === 'name' &&
                  (sortConfig.direction === 'asc' ? (
                    <ChevronUpIcon className="w-4 h-4 ml-1 text-white" />
                  ) : (
                    <ChevronDownIcon className="w-4 h-4 ml-1 text-white" />
                  ))}
              </div>
            </th>
            <th className="px-4 py-3 font-semibold text-white">Categoría</th>
            <th
              className="px-4 py-3 font-semibold text-white cursor-pointer select-none text-right"
              onClick={() => onSort('stock')}
            >
              <div className="flex items-center justify-end">
                Stock
                {sortConfig.key === 'stock' &&
                  (sortConfig.direction === 'asc' ? (
                    <ChevronUpIcon className="w-4 h-4 ml-1 text-white" />
                  ) : (
                    <ChevronDownIcon className="w-4 h-4 ml-1 text-white" />
                  ))}
              </div>
            </th>
            <th
              className="px-4 py-3 font-semibold text-white cursor-pointer select-none text-right"
              onClick={() => onSort('price')}
            >
              <div className="flex items-center justify-end">
                Precio
                {sortConfig.key === 'price' &&
                  (sortConfig.direction === 'asc' ? (
                    <ChevronUpIcon className="w-4 h-4 ml-1 text-white" />
                  ) : (
                    <ChevronDownIcon className="w-4 h-4 ml-1 text-white" />
                  ))}
              </div>
            </th>
            <th className="px-4 py-3 font-semibold text-white text-center">Acciones</th>
          </tr>
        </thead>

        <tbody>
          {data.length > 0 ? (
            data.map((item, idx) => (
              <tr
                key={item.id}
                className={clsx(
                  idx % 2 === 0 ? 'bg-gray-800' : 'bg-gray-700',
                  'hover:bg-gray-600 transition-colors',
                )}
              >
                <td className="px-4 py-3 text-white">{item.id}</td>
                <td className="px-4 py-3 text-white font-medium">{item.name}</td>
                <td className="px-4 py-3 text-gray-300">{item.category.name}</td>
                <td
                  className={clsx(
                    'px-4 py-3 text-right font-semibold',
                    item.totalStock < 10
                      ? 'text-red-500'
                      : item.totalStock < 20
                        ? 'text-yellow-400'
                        : 'text-green-400',
                  )}
                >
                  {item.totalStock}
                </td>
                <td className="px-4 py-3 text-right text-white">${item.price.toFixed(2)}</td>
                <td className="px-4 py-3 flex justify-center space-x-2">
                  <button
                    onClick={() => onEdit(item)}
                    className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded-lg text-white text-sm"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => onDelete(item.id)}
                    className="bg-red-600 hover:bg-red-700 px-3 py-1 rounded-lg text-white text-sm"
                  >
                    Eliminar
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={6} className="text-center py-8 text-gray-400">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-4xl">📦</span>
                  <p className="font-medium text-white">No hay productos</p>
                  <p className="text-sm text-gray-300">Ajusta filtros o busca otro producto.</p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
