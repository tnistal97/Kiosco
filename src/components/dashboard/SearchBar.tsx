// src/components/dashboard/SearchBar.tsx
'use client'

import React, { ChangeEvent } from 'react'

interface SearchBarProps {
  value: string
  onChange: (newValue: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

export default function SearchBar({
  value,
  onChange,
  disabled = false,
  placeholder = '',
  className = '',
}: SearchBarProps) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className={`
        w-full max-w-md
        rounded-lg border border-gray-300 dark:border-gray-600
        bg-white dark:bg-gray-700
        px-4 py-2
        text-gray-900 dark:text-gray-100
        placeholder-gray-400 dark:placeholder-gray-500
        focus:outline-none focus:ring-2 focus:ring-blue-400
        transition
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-gray-400 dark:hover:border-gray-500'}
        ${className}
      `}
    />
  )
}
