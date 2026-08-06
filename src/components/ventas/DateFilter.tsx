'use client'

interface Props {
  fromDate: string
  toDate: string
  setFromDate: (v: string) => void
  setToDate: (v: string) => void
}

export default function DateFilter({ fromDate, toDate, setFromDate, setToDate }: Props) {
  return (
    <div className="flex flex-col md:flex-row items-end gap-4">
      <div className="flex flex-col">
        <label className="text-sm text-gray-300">Desde</label>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="mt-1 p-2 bg-gray-700 text-gray-100 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <div className="flex flex-col">
        <label className="text-sm text-gray-300">Hasta</label>
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="mt-1 p-2 bg-gray-700 text-gray-100 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>
      <button
        onClick={() => {
          const today = new Date()
          const year = today.getFullYear()
          const month = today.getMonth()
          const firstDay = new Date(year, month, 1).toISOString().slice(0, 10)
          const lastDay = new Date(year, month + 1, 0).toISOString().slice(0, 10)
          setFromDate(firstDay)
          setToDate(lastDay)
        }}
        className="mt-4 md:mt-0 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition"
      >
        Restablecer Mes
      </button>
    </div>
  )
}
