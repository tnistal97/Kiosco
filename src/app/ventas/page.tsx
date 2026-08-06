// src/app/caja/page.tsx
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import CajaTable from '@/components/ventas/CajaTable'
import NewMovementModal from '@/components/ventas/NewMovementModal'
import Spinner from '@/components/ui/Spinner' // Asegúrate de tener un Spinner sencillo
import { apiRequest } from '@/lib/api-client'
import { parseMovimientos, parseSaldo, type MovimientoDTO } from '@/modules/cash/dto'

// Formatea un número a “$X.YY”
const formatCurrency = (value: number) =>
  `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

export default function CajaPage() {
  // ─── Estados locales ───────────────────────────────────────────────────
  const [movements, setMovements] = useState<MovimientoDTO[]>([])
  const [balance, setBalance] = useState<number>(0)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Controla si estamos recargando datos (movimientos + balance)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  // ─── Funciones de fetch ─────────────────────────────────────────────────
  const fetchMovements = useCallback(async () => {
    try {
      setMovements(await apiRequest('/api/cash', { parse: parseMovimientos }))
    } catch (err) {
      console.error('Error al cargar movimientos:', err)
      setMovements([])
    }
  }, [])

  const fetchBalance = useCallback(async () => {
    try {
      const saldo = await apiRequest('/api/cash/balance', { parse: parseSaldo })
      setBalance(saldo.balance)
    } catch (err) {
      console.error('Error al cargar balance:', err)
      setBalance(0)
    }
  }, [])

  // ─── Helper para recargar movimientos + balance con spinner ─────────────
  const reloadAll = useCallback(async () => {
    setIsRefreshing(true)
    await Promise.all([fetchMovements(), fetchBalance()])
    setIsRefreshing(false)
  }, [fetchMovements, fetchBalance])

  // ─── useEffect inicial: cargar datos ────────────────────────────────────
  useEffect(() => {
    void reloadAll()
  }, [reloadAll])

  // ─── Callback para cuando se anule una venta ────────────────────────────
  const handleSaleDeleted = useCallback(async () => {
    await reloadAll()
  }, [reloadAll])

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-8 space-y-8">
      <h1 className="text-3xl font-bold text-blue-400">🧾 Control de Caja</h1>

      {/* ══ Mostrar balance actual ════════════════════════════════════════ */}
      <div className="flex items-center space-x-4">
        <span className="text-lg font-medium text-gray-300">Saldo actual:</span>
        <span className="text-2xl font-bold text-green-400">{formatCurrency(balance)}</span>
      </div>

      {/* ══ Indicador de carga al recargar datos ═══════════════════════════ */}
      {isRefreshing && (
        <div className="flex items-center justify-center py-4">
          <Spinner />
          <span className="ml-2 text-gray-300">Actualizando...</span>
        </div>
      )}

      {/* ══ Tabla de movimientos (ayer + hoy, ya ordenado) ════════════════ */}
      <CajaTable movements={movements} onSaleDeleted={() => void handleSaleDeleted()} />

      {/* ══ Modal para agregar movimiento manual (si se requiere) ═══════════ */}
      <NewMovementModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          void reloadAll()
        }}
        onSaved={() => {
          void reloadAll()
        }}
      />
    </div>
  )
}
