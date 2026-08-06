'use client'

import React from 'react'
import { XMarkIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onConfirm: () => void
  onCancel: () => void
  loading?: boolean
}

export default function DeleteConfirmationModal({
  isOpen,
  onConfirm,
  onCancel,
  loading = false,
}: Props) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-red-50 dark:bg-red-800">
          <div className="flex items-center gap-2">
            <ExclamationTriangleIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              Confirmar eliminación
            </h2>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            aria-label="Cerrar modal"
          >
            <XMarkIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            ¿Estás seguro que deseas eliminar esta venta? <strong>Esta acción será registrada</strong> y no podrá deshacerse.
          </p>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 flex justify-end space-x-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition focus:outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700 transition focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50 flex items-center justify-center"
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
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                ></path>
              </svg>
            ) : null}
            Eliminar
          </button>
        </div>
      </div>
    </div>
  )
}
