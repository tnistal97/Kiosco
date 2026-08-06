'use client'

import { ChangeEvent } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

interface Props {
  search: string
  setSearch: (v: string) => void
  isLoading: boolean
}

export default function SearchBar({ search, setSearch, isLoading }: Props) {
  return (
    <div className="sticky top-0 z-10 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-4 px-4 sm:px-6">
      <div className="flex w-full max-w-lg items-center bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-sm focus-within:ring-2 focus-within:ring-blue-400 transition">
        <MagnifyingGlassIcon className="w-6 h-6 text-gray-400 dark:text-gray-300 mx-3" />
        <input
          type="text"
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
          disabled={isLoading}
          placeholder="Buscar producto por código o nombre..."
          aria-label="Buscar producto"
          className="w-full bg-transparent py-3 pr-4 placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-gray-100 text-lg focus:outline-none"
        />
      </div>
    </div>
  )
}
