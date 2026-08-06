// src/components/caja/ConfirmSaleModal.tsx
'use client'

import React from 'react'
import { XMarkIcon } from '@heroicons/react/24/solid'
import clsx from 'clsx'
import { formatCurrency } from '@/lib/formatCurrency'
import { useCartStore } from '@/store/cart'

interface ConfirmSaleModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago'
}

export default function ConfirmSaleModal({
  isOpen,
  onClose,
  onConfirm,
  paymentMethod,
}: ConfirmSaleModalProps) {
  // Tomamos directamente los ítems desde el store
  const items = useCartStore((s) => s.items)
  const total = items.reduce((acc, i) => acc + i.product.price * i.quantity, 0)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            ⚠️ Confirmar Venta
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            aria-label="Cerrar modal"
          >
            <XMarkIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
        </div>

        {/* BODY */}
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-700 dark:text-gray-300">
            ¿Está seguro de registrar esta venta? <br />
            <span className="font-medium">Método de pago:</span>{' '}
            <span className="capitalize">{paymentMethod.replace('_', ' ')}</span>
          </p>

          <div className="max-h-60 overflow-auto border border-gray-200 dark:border-gray-700 rounded-lg">
            <table className="min-w-full text-sm text-left border-collapse">
              <thead className="bg-gray-100 dark:bg-gray-700">
                <tr>
                  <th className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100">
                    Producto
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100 text-center">
                    Cant.
                  </th>
                  <th className="px-4 py-2 font-medium text-gray-900 dark:text-gray-100 text-right">
                    Subtotal
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, idx) => {
                  const subtotal = item.product.price * item.quantity
                  return (
                    <tr
                      key={item.product.id}
                      className={clsx(
                        idx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-700',
                      )}
                    >
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">
                        {item.product.name}
                      </td>
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100 text-center">
                        {item.quantity}
                      </td>
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100 text-right font-semibold">
                        {formatCurrency(subtotal)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex justify-end">
            <span className="text-lg font-bold text-green-600 dark:text-green-400">
              Total: {formatCurrency(total)}
            </span>
          </div>
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 flex justify-end space-x-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Cancelar
          </button>
          <button
            onClick={() => {
              onConfirm()
              onClose()
            }}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Confirmar Venta
          </button>
        </div>
      </div>
    </div>
  )
}
