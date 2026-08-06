'use client'

import React, { useState, useEffect, useCallback } from 'react'
import DateRangePicker from '@/components/admin/sales/DateRangePicker'
import LoadingSpinner from '@/components/admin/sales/LoadingSpinner'
import SalesMetrics from '@/components/admin/sales/SalesMetrics'
import SalesTable from '@/components/admin/sales/SalesTable'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parseVentas, type VentaDTO } from '@/modules/sales/dto'

export type { ItemVentaDTO as SaleItem, VentaDTO as Sale } from '@/modules/sales/dto'

export default function AdminSalesPage() {
  const [range, setRange] = useState({ start: '', end: '' })
  const [sales, setSales] = useState<VentaDTO[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Devuelve { start, end } del mes actual en YYYY-MM-DD
  const initCurrentMonth = useCallback(() => {
    const now = new Date()
    const first = new Date(now.getFullYear(), now.getMonth(), 1)
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    return { start: fmt(first), end: fmt(last) }
  }, [])

  const fetchSales = useCallback(async (start: string, end: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({ start, end })
      setSales(await apiRequest(`/api/admin/sales?${query.toString()}`, { parse: parseVentas }))
    } catch (err) {
      console.error(err)
      setError(mensajeDeError(err, 'Error al obtener ventas'))
      setSales([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  // Al montar: rango del mes actual. El fetch lo dispara el efecto de abajo
  // en cuanto `range` queda seteado, para no pedir las mismas ventas dos veces.
  useEffect(() => {
    setRange(initCurrentMonth())
  }, [initCurrentMonth])

  // Al cambiar rango
  useEffect(() => {
    if (range.start && range.end) {
      void fetchSales(range.start, range.end)
    }
  }, [range, fetchSales])

  return (
    <div className="min-h-screen bg-gray-900 text-white p-8 space-y-6">
      <h1 className="text-3xl font-bold text-blue-400">📈 Reporte de Ventas</h1>

      {/* Selector & rango */}
      <div className="bg-gray-800 p-6 rounded-lg flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <DateRangePicker
          start={range.start}
          end={range.end}
          onChange={(r: { start: string; end: string }) => setRange(r)}
        />
        <p className="text-gray-300">
          Mostrando ventas de <span className="font-semibold text-white">{range.start}</span> a{' '}
          <span className="font-semibold text-white">{range.end}</span>
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-700 rounded-md">
          <p className="font-medium">❌ {error}</p>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-16">
          <LoadingSpinner />
        </div>
      ) : (
        <>
          <SalesMetrics sales={sales} />
          <SalesTable sales={sales} />
        </>
      )}
    </div>
  )
}
