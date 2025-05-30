'use client'

interface Props {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}

export default function SearchBar({ value, onChange, disabled }: Props) {
  return (
    <div className="relative mb-6">
      <input
        type="text"
        placeholder="Buscar productos por nombre o código..."
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="w-full p-3 pl-10 bg-white dark:bg-[color:var(--color-background)] border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
      />
      <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400">
        🔍
      </span>
    </div>
  )
}
