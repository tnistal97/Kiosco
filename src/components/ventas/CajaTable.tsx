// src/components/ventas/CajaTable.tsx
'use client'

import React, { useState, useMemo, useEffect } from 'react'
import type { CashMovement } from '@/types/caja'
import SortableHeader from './SortableHeader'
import MovimientoRow from './MovimientoRow'
import DetalleVenta from './DetalleVenta'

interface Props {
  movements: Array<
    CashMovement & {
      saleItems: Array<{
        id: number
        product: { id: number; name: string }
        quantity: number
        price: number
      }> | null
    }
  >
  /** Callback que se dispara después de que una venta se eliminó exitosamente */
  onSaleDeleted: (deletedId: number) => void
}

type SortKey = 'id' | 'paymentMethod' | 'amount' | 'date' | 'user'
type SortDirection = 'asc' | 'desc'

export default function CajaTable({ movements, onSaleDeleted }: Props) {
  // ─── 1) Estado local de movimientos ───────────────────────────────────────────────
  const [movList, setMovList] = useState(movements)
  useEffect(() => {
    setMovList(movements)
  }, [movements])

  // ─── 2) Estado de ordenamiento ───────────────────────────────────────────────────
  const [sortConfig, setSortConfig] = useState<{
    key: SortKey
    direction: SortDirection
  }>({
    key: 'date',
    direction: 'desc',
  })

  // ─── 3) Estado de filas expandidas ───────────────────────────────────────────────
  const [expandedRows, setExpandedRows] = useState<number[]>([])

  // ─── 4) Lógica de ordenamiento ───────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const arr = [...movList]
    arr.sort((a, b) => {
      const { key, direction } = sortConfig
      let cmp = 0
      switch (key) {
        case 'id':
          cmp = a.id - b.id
          break
        case 'paymentMethod':
          cmp = a.paymentMethod.localeCompare(b.paymentMethod)
          break
        case 'amount':
          cmp = a.amount - b.amount
          break
        case 'date':
          cmp = new Date(a.date).getTime() - new Date(b.date).getTime()
          break
        case 'user':
          cmp = a.user.name.localeCompare(b.user.name)
          break
      }
      return direction === 'asc' ? cmp : -cmp
    })
    return arr
  }, [movList, sortConfig])

  // ─── 5) Cambiar orden al hacer click en encabezado ────────────────────────────────
  const handleSort = (key: SortKey) => {
    setSortConfig((prev) => {
      if (prev.key === key) {
        return {
          key,
          direction: prev.direction === 'asc' ? 'desc' : 'asc',
        }
      }
      return { key, direction: 'asc' }
    })
  }

  // ─── 6) Alternar fila expandida ───────────────────────────────────────────────────
  const toggleExpand = (id: number) => {
    setExpandedRows((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  // ─── 7) Remover movimiento localmente y notificar al padre ────────────────────────
  const handleDeleted = (deletedId: number) => {
    // Primero, remover de la lista local
    setMovList((prev) => prev.filter((m) => m.id !== deletedId))
    // Luego, informar al componente padre para que recargue balance, etc.
    onSaleDeleted(deletedId)
  }

  return (
    <div className="bg-gray-800 p-4 rounded-lg shadow-lg border border-gray-700 overflow-x-auto">
      <table className="min-w-full text-sm text-left border-collapse">
        <thead className="bg-gray-600">
          <tr>
            <SortableHeader
              label="ID"
              sortKey="id"
              currentKey={sortConfig.key}
              direction={sortConfig.direction}
              onClick={() => handleSort('id')}
            />
            <SortableHeader
              label="Método"
              sortKey="paymentMethod"
              currentKey={sortConfig.key}
              direction={sortConfig.direction}
              onClick={() => handleSort('paymentMethod')}
            />
            <SortableHeader
              label="Monto"
              sortKey="amount"
              currentKey={sortConfig.key}
              direction={sortConfig.direction}
              onClick={() => handleSort('amount')}
              alignRight
            />
            <th className="px-4 py-3 font-semibold text-gray-100">Descripción</th>
            <SortableHeader
              label="Fecha"
              sortKey="date"
              currentKey={sortConfig.key}
              direction={sortConfig.direction}
              onClick={() => handleSort('date')}
            />
            <SortableHeader
              label="Usuario"
              sortKey="user"
              currentKey={sortConfig.key}
              direction={sortConfig.direction}
              onClick={() => handleSort('user')}
            />
            <th className="px-4 py-3 font-semibold text-gray-100 text-center">Detalle</th>
            <th className="px-4 py-3 font-semibold text-gray-100 text-center">Acciones</th>
          </tr>
        </thead>

        <tbody>
          {sorted.length > 0 ? (
            sorted.map((m, idx) => {
              const isExpanded = expandedRows.includes(m.id)
              return (
                <React.Fragment key={m.id}>
                  <MovimientoRow
                    movimiento={m}
                    index={idx}
                    isExpanded={isExpanded}
                    onToggleExpand={toggleExpand}
                    onDeleted={handleDeleted}
                  />

                  {Array.isArray(m.saleItems) &&
                    m.saleItems.length > 0 &&
                    expandedRows.includes(m.id) && <DetalleVenta saleItems={m.saleItems} />}
                </React.Fragment>
              )
            })
          ) : (
            <tr>
              <td colSpan={8} className="text-center py-8 text-gray-400">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-4xl">💤</span>
                  <p className="font-medium text-gray-100">No hay movimientos</p>
                  <p className="text-sm text-gray-300">
                    Ajusta el filtro de fechas o método de pago.
                  </p>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
