'use client'

import React, { useEffect, useState } from 'react'
import { XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onConfirm: (reason: string) => void
  onCancel: () => void
  loading?: boolean
}

/** Motivos habituales, para no tener que escribirlos con el local lleno. */
const MOTIVOS_FRECUENTES = [
  'El cliente se arrepintio',
  'Error de carga del cajero',
  'Producto en mal estado',
  'Cobro duplicado',
]

export default function DeleteConfirmationModal({
  isOpen,
  onConfirm,
  onCancel,
  loading = false,
}: Props) {
  const [motivo, setMotivo] = useState('')

  useEffect(() => {
    if (isOpen) setMotivo('')
  }, [isOpen])

  if (!isOpen) return null

  const puedeConfirmar = motivo.trim().length > 0 && !loading

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-amber-50 dark:bg-amber-900">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="w-6 h-6 text-amber-600 dark:text-amber-300" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Anular venta</h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            aria-label="Cerrar"
          >
            <XMarkIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            La venta no se borra: queda registrada como anulada, con tu nombre y el motivo. El stock
            se devuelve al inventario y el importe se descuenta de la caja.
          </p>

          <div>
            <label
              htmlFor="motivo-anulacion"
              className="block text-sm font-medium text-gray-800 dark:text-gray-200 mb-1"
            >
              Motivo <span className="text-red-500">*</span>
            </label>
            <input
              id="motivo-anulacion"
              type="text"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              maxLength={300}
              autoFocus
              placeholder="Por que se anula esta venta"
              className="w-full min-h-[44px] px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            {MOTIVOS_FRECUENTES.map((texto) => (
              <button
                key={texto}
                type="button"
                onClick={() => setMotivo(texto)}
                className="px-3 py-2 text-xs rounded-full bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition"
              >
                {texto}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 flex justify-end space-x-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 min-h-[44px] rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
          >
            Volver
          </button>
          <button
            onClick={() => onConfirm(motivo)}
            disabled={!puedeConfirmar}
            className="px-4 py-2 min-h-[44px] rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition focus:outline-none focus:ring-2 focus:ring-amber-500 disabled:opacity-50 flex items-center justify-center"
          >
            {loading ? (
              <svg
                className="animate-spin h-5 w-5 text-white mr-2"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : null}
            Anular venta
          </button>
        </div>
      </div>
    </div>
  )
}
