'use client'

import React from 'react'

interface DatePickerProps {
  label: string
  value: string           // formato "YYYY-MM-DD"
  onChange: (newDate: string) => void
}

export default function DatePicker({ label, value, onChange }: DatePickerProps) {
  return (
    <div className="flex flex-col">
      <label className="text-sm font-medium text-gray-300 mb-1">{label}</label>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-2 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
      />
    </div>
  )
}
