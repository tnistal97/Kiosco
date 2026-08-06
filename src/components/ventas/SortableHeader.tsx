'use client'

import React from 'react'
import { ChevronUpIcon, ChevronDownIcon } from '@heroicons/react/24/outline'

interface Props {
  label: string
  sortKey: string
  currentKey: string
  direction: 'asc' | 'desc'
  onClick: () => void
  alignRight?: boolean
}

export default function SortableHeader({
  label,
  sortKey,
  currentKey,
  direction,
  onClick,
  alignRight = false,
}: Props) {
  const isActive = sortKey === currentKey
  return (
    <th
      onClick={onClick}
      className={`px-4 py-3 font-semibold text-gray-100 cursor-pointer select-none ${
        alignRight ? 'text-right' : ''
      }`}
    >
      <div className={`flex items-center ${alignRight ? 'justify-end' : ''}`}>
        {label}
        {isActive &&
          (direction === 'asc' ? (
            <ChevronUpIcon className="w-4 h-4 ml-1 text-gray-100" />
          ) : (
            <ChevronDownIcon className="w-4 h-4 ml-1 text-gray-100" />
          ))}
      </div>
    </th>
  )
}
