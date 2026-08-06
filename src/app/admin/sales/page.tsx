'use client'

import React, { useState, useEffect, useCallback } from 'react'
import DateRangePicker from '@/components/admin/sales/DateRangePicker'
import LoadingSpinner from '@/components/admin/sales/LoadingSpinner'
import SalesMetrics from '@/components/admin/sales/SalesMetrics'
import SalesTable from '@/components/admin/sales/SalesTable'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { parsePaginaVentas, type TotalesVentas, type VentaDTO } from '@/modules/sales/dto'

export type { ItemVentaDTO as SaleItem, VentaDTO as Sale } from '@/modules/sales/dto'

/** Ventas por pagina. El servidor no acepta mas de 100. */
const POR_PAGINA = 50

export default function AdminSalesPage() {
  const [range, setRange] = useState({ start: '', end: '' })
  const [sales, setSales] = useState<VentaDTO[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totales, setTotales] = useState<TotalesVentas>({
    ventas: 0,
    anuladas: 0,
    recaudado: 0,
  })
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

  const fetchSales = useCallback(async (start: string, end: string, pagina: number) => {
    setIsLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({
        start,
        end,
        page: String(pagina),
        pageSize: String(POR_PAGINA),
      })
      const resultado = await apiRequest(`/api/admin/sales?${query.toString()}`, {
        parse: parsePaginaVentas,
      })
      setSales(resultado.data)
      setTotalPages(resultado.totalPages)
      // Los totales son del rango completo, no de la pagina: cambiar de
      // pagina no debe cambiar la recaudacion del mes.
      setTotales(resultado.totales)
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

  // Cambiar el rango vuelve a la primera pagina.
  useEffect(() => {
    setPage(1)
  }, [range])

  useEffect(() => {
    if (range.start && range.end) {
      void fetchSales(range.start, range.end, page)
    }
  }, [range, page, fetchSales])

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
          <SalesMetrics sales={sales} totales={totales} />
          <SalesTable sales={sales} />

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-4 pt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 transition"
              >
                Anterior
              </button>
              <span className="text-gray-300">
                Página {page} de {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 disabled:opacity-40 transition"
              >
                Siguiente
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
