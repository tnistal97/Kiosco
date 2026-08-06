// src/app/caja/page.tsx
'use client'

import React, { useState, useEffect } from 'react'
import { CashMovement } from '@/types/caja'
import CajaTable from '@/components/ventas/CajaTable'
import NewMovementModal from '@/components/ventas/NewMovementModal'
import Spinner from '@/components/ui/Spinner' // Asegúrate de tener un Spinner sencillo

// Formatea un número a “$X.YY”
const formatCurrency = (value: number) =>
  `$${value.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`

export default function CajaPage() {
  // ─── Estados locales ───────────────────────────────────────────────────
  const [movements, setMovements] = useState<
    Array<
      CashMovement & {
        saleItems: Array<{
          id: number
          product: { id: number; name: string }
          quantity: number
          price: number
        }> | null
      }
    >
  >([])
  const [balance, setBalance] = useState<number>(0)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Controla si estamos recargando datos (movimientos + balance)
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false)

  // ─── Funciones de fetch ─────────────────────────────────────────────────
  const fetchMovements = async () => {
    try {
      const res = await fetch('/api/cash', {
        method: 'GET',
        credentials: 'include',
      })
      if (!res.ok) {
        throw new Error('No autorizado o error al cargar movimientos')
      }
      const data = await res.json()
      setMovements(data)
    } catch (err) {
      console.error('Error al cargar movimientos:', err)
      setMovements([])
    }
  }

  const fetchBalance = async () => {
    try {
      const res = await fetch('/api/cash/balance', {
        method: 'GET',
        credentials: 'include',
      })
      if (!res.ok) {
        throw new Error('No autorizado o error al cargar balance')
      }
      const { balance: b } = await res.json()
      setBalance(b)
    } catch (err) {
      console.error('Error al cargar balance:', err)
      setBalance(0)
    }
  }

  // ─── useEffect inicial: cargar datos ────────────────────────────────────
  useEffect(() => {
    reloadAll()
  }, [])

  // ─── Helper para recargar movimientos + balance con spinner ─────────────
  const reloadAll = async () => {
    setIsRefreshing(true)
    await Promise.all([fetchMovements(), fetchBalance()])
    setIsRefreshing(false)
  }

  // ─── Callback para cuando se elimine una venta exitosamente ─────────────
  const handleSaleDeleted = async (deletedSaleId: number) => {
    // Re-cargar movimientos y balance
    setIsRefreshing(true)
    await Promise.all([fetchMovements(), fetchBalance()])
    setIsRefreshing(false)
  }

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
      <CajaTable movements={movements} onSaleDeleted={handleSaleDeleted} />

      {/* ══ Modal para agregar movimiento manual (si se requiere) ═══════════ */}
      <NewMovementModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false)
          reloadAll()
        }}
        onSaved={() => {
          reloadAll()
        }}
      />
    </div>
  )
}
