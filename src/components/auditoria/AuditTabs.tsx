'use client'

import React from 'react'

interface AuditTabsProps {
  section: 'ventas' | 'stock' | 'productos'
  setSection: (s: 'ventas' | 'stock' | 'productos') => void
}

export default function AuditTabs({ section, setSection }: AuditTabsProps) {
  const tabs = [
    { id: 'ventas', label: 'Ventas' },
    { id: 'stock', label: 'Stock' },
    { id: 'productos', label: 'Productos' },
  ] as const

  return (
    <nav className="flex space-x-4">
      {tabs.map((tab) => {
        const isActive = section === tab.id
        return (
          <button
            key={tab.id}
            onClick={() => setSection(tab.id)}
            className={`px-4 py-2 font-medium rounded-lg focus:outline-none transition ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {tab.label}
          </button>
        )
      })}
    </nav>
  )
}
