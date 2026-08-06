'use client'

import React from 'react'

interface Props {
  start: string
  end: string
  onChange: (range: { start: string; end: string }) => void
}

export default function DateRangePicker({ start, end, onChange }: Props) {
  return (
    <div className="flex gap-4">
      <div>
        <label className="block text-sm text-gray-300 mb-1">Desde</label>
        <input
          type="date"
          value={start}
          onChange={(e) => onChange({ start: e.target.value, end })}
          className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none"
        />
      </div>
      <div>
        <label className="block text-sm text-gray-300 mb-1">Hasta</label>
        <input
          type="date"
          value={end}
          onChange={(e) => onChange({ start, end: e.target.value })}
          className="w-full px-3 py-2 bg-gray-700 text-white rounded-lg focus:outline-none"
        />
      </div>
    </div>
  )
}
