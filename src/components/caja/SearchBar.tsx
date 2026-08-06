// src/components/caja/SearchBar.tsx
'use client'

import { useEffect, useRef } from 'react'
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline'

interface SearchBarProps {
  searchValue: string
  setSearchValue: (v: string) => void
  onEnter: (value: string) => void
  disabled?: boolean
}

export default function SearchBar({
  searchValue,
  setSearchValue,
  onEnter,
  disabled,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  // Cada vez que se renderiza, volvemos a enfocar
  useEffect(() => {
    inputRef.current?.focus()
  })

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onEnter(searchValue.trim())
      setSearchValue('') // luego de procesar, limpiamos el campo
    }
  }

  return (
    <div className="flex w-full max-w-lg mx-auto items-center bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-sm focus-within:ring-2 focus-within:ring-blue-400 transition px-3 py-2">
      <MagnifyingGlassIcon className="w-6 h-6 text-gray-400 dark:text-gray-300 mr-2" />
      <input
        id="search-input"
        ref={inputRef}
        type="text"
        value={searchValue}
        onChange={(e) => setSearchValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder="🔍 Código o nombre..."
        aria-label="Buscar producto"
        className="w-full bg-transparent placeholder-gray-500 dark:placeholder-gray-400 text-gray-900 dark:text-gray-100 text-lg focus:outline-none"
      />
    </div>
  )
}
