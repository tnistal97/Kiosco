'use client'

import React from 'react'
import clsx from 'clsx'

interface Option {
  value: string
  label: string
}

interface SelectFilterProps {
  label: string
  options: Option[]
  selected: string[]
  onChange: (newArray: string[]) => void
  multiple?: boolean // si es true, podemos seleccionar varios
}

/**
 * Si multiple = true, muestra una lista de checkboxes inline
 * Si multiple = false, muestra un <select> sencillo
 */
export default function SelectFilter({
  label,
  options,
  selected,
  onChange,
  multiple = true,
}: SelectFilterProps) {
  const toggleValue = (val: string) => {
    if (selected.includes(val)) {
      onChange(selected.filter((s) => s !== val))
    } else {
      onChange([...selected, val])
    }
  }

  if (multiple) {
    return (
      <div className="flex flex-col">
        <span className="text-sm font-medium text-gray-300 mb-1">{label}</span>
        <div className="flex flex-wrap gap-2">
          {options.map(({ value, label: lbl }) => {
            const isActive = selected.includes(value)
            return (
              <button
                key={value}
                onClick={() => toggleValue(value)}
                className={clsx(
                  'px-3 py-1 rounded-lg text-sm font-medium focus:outline-none transition',
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600',
                )}
              >
                {lbl}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // single-select
  return (
    <div className="flex flex-col">
      <label className="text-sm font-medium text-gray-300 mb-1">{label}</label>
      <select
        value={selected[0] || ''}
        onChange={(e) => onChange([e.target.value])}
        className="w-full p-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        <option value="">— Todos —</option>
        {options.map(({ value, label: lbl }) => (
          <option key={value} value={value}>
            {lbl}
          </option>
        ))}
      </select>
    </div>
  )
}
