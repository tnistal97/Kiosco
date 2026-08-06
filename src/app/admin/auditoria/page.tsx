// src/app/ventas/page.tsx
'use client'

import { useEffect, useState, useMemo } from 'react'
import LoadingSpinner from '@/components/auditoria/LoadingSpinner'
import AuditTabs from '@/components/auditoria/AuditTabs'
import SalesSection from '@/components/auditoria/SalesSection'
import StockSection from '@/components/auditoria/StockSection'
import ProductSection from '@/components/auditoria/ProductSection'
import DatePicker from '@/components/auditoria/DatePicker'
import SelectFilter from '@/components/auditoria/SelectFilter'
import type { AuditLog } from '@/types/audit' // ← importar desde el nuevo archivo
import { apiRequest, mensajeDeError, numero } from '@/lib/api-client'
import { parsePaginaAuditoria } from '@/modules/audit/dto'
import { parseProductos } from '@/modules/products/dto'

export default function AuditoriaPage() {
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [productsMap, setProductsMap] = useState<Record<number, string>>({})
  const [section, setSection] = useState<'ventas' | 'stock' | 'productos'>('ventas')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // *** FILTROS ***
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [filterTables, setFilterTables] = useState<string[]>(['Sale', 'BranchStock', 'Product'])
  const [filterActions, setFilterActions] = useState<string[]>(['create', 'update', 'delete'])

  useEffect(() => {
    const fetchAll = async () => {
      setIsLoading(true)
      setError(null)

      try {
        // /api/audit pagina: devuelve { data, pagination }. El tope duro por
        // pagina es 100, asi que esta pantalla muestra la primera pagina.
        const [auditoria, productos] = await Promise.all([
          apiRequest('/api/audit?pageSize=100', { parse: parsePaginaAuditoria }),
          apiRequest('/api/products', { parse: parseProductos }),
        ])

        setLogs(auditoria.data)

        const mapa: Record<number, string> = {}
        productos.forEach((p) => {
          mapa[p.id] = p.name
        })
        setProductsMap(mapa)
      } catch (e) {
        console.error(e)
        setError(mensajeDeError(e, 'Error al cargar datos'))
      } finally {
        setIsLoading(false)
      }
    }

    void fetchAll()
  }, [])

  const formatearFecha = (ts: string) =>
    new Date(ts).toLocaleDateString('es-AR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  const formatearHora = (ts: string) =>
    new Date(ts).toLocaleTimeString('es-AR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })

  // *** FILTRADO GENERAL ***
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (!filterTables.includes(log.tableName)) return false
      if (!filterActions.includes(log.actionType)) return false

      const logTime = new Date(log.timestamp).getTime()
      if (dateFrom) {
        const fromTime = new Date(dateFrom).setHours(0, 0, 0, 0)
        if (logTime < fromTime) return false
      }
      if (dateTo) {
        const toTime = new Date(dateTo).setHours(23, 59, 59, 999)
        if (logTime > toTime) return false
      }
      return true
    })
  }, [logs, filterTables, filterActions, dateFrom, dateTo])

  const registrosVentas = useMemo(() => {
    return filteredLogs
      .filter((log) => log.tableName === 'Sale' && log.actionType === 'create')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [filteredLogs])

  const registrosStock = useMemo(() => {
    return filteredLogs
      .filter((log) => {
        if (log.tableName !== 'BranchStock' || log.actionType !== 'update') return false
        return numero(log.changes.after?.quantity) > numero(log.changes.before?.quantity)
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [filteredLogs])

  const registrosProductos = useMemo(() => {
    return filteredLogs
      .filter((log) => log.tableName === 'Product' && log.actionType === 'create')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [filteredLogs])

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4 md:p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <h1 className="text-2xl md:text-3xl font-bold text-blue-400">🧃 KioscoApp — Historial</h1>
          <AuditTabs section={section} setSection={setSection} />
        </header>

        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <DatePicker label="Desde:" value={dateFrom} onChange={(v) => setDateFrom(v)} />
            <DatePicker label="Hasta:" value={dateTo} onChange={(v) => setDateTo(v)} />
            <SelectFilter
              label="Tabla"
              options={[
                { value: 'Sale', label: 'Ventas' },
                { value: 'BranchStock', label: 'Stock' },
                { value: 'Product', label: 'Productos' },
              ]}
              selected={filterTables}
              onChange={(arr) => setFilterTables(arr)}
              multiple
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SelectFilter
              label="Acción"
              options={[
                { value: 'create', label: 'Creado' },
                { value: 'update', label: 'Actualizado' },
                { value: 'delete', label: 'Eliminado' },
              ]}
              selected={filterActions}
              onChange={(arr) => setFilterActions(arr)}
              multiple
            />

            <button
              onClick={() => {
                setDateFrom('')
                setDateTo('')
                setFilterTables(['Sale', 'BranchStock', 'Product'])
                setFilterActions(['create', 'update', 'delete'])
              }}
              className="self-end px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white font-medium transition"
            >
              Limpiar filtros
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <LoadingSpinner />
          </div>
        ) : error ? (
          <div className="bg-red-800/50 rounded-lg p-6 text-center">
            <p className="text-red-400 font-medium">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-white"
            >
              Reintentar
            </button>
          </div>
        ) : (
          <>
            {section === 'ventas' && (
              <SalesSection
                registrosVentas={registrosVentas}
                productsMap={productsMap}
                formatearFecha={formatearFecha}
                formatearHora={formatearHora}
              />
            )}
            {section === 'stock' && (
              <StockSection
                registrosStock={registrosStock}
                productsMap={productsMap}
                formatearFecha={formatearFecha}
                formatearHora={formatearHora}
              />
            )}
            {section === 'productos' && (
              <ProductSection
                registrosProductos={registrosProductos}
                formatearFecha={formatearFecha}
                formatearHora={formatearHora}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
