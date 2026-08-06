'use client'

import React from 'react'
import { XMarkIcon, ShoppingCartIcon } from '@heroicons/react/24/outline'
import { formatCurrency } from '@/lib/formatCurrency'
import { useCartStore } from '@/store/cart'
import CartItemRow from './CartItemRow'
import PaymentMethodSelector from './PaymentMethodSelector'
import Spinner from '@/components/ui/Spinner'

interface MobileCartModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  onClear: () => void
  // Ahora usamos el union type correcto:
  paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago'
  // Aceptamos el setter de React para ese mismo union type:
  setPaymentMethod: React.Dispatch<React.SetStateAction<'efectivo' | 'tarjeta' | 'mercado_pago'>>
  isConfirming: boolean
}

export default function MobileCartModal({
  isOpen,
  onClose,
  onConfirm,
  onClear,
  paymentMethod,
  setPaymentMethod,
  isConfirming,
}: MobileCartModalProps) {
  const items = useCartStore((s) => s.items)
  const total = items.reduce((acc, i) => acc + i.product.price * i.quantity, 0)

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Fondo semitransparente */}
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />

      {/* Panel deslizable desde abajo */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl max-h-[90vh] overflow-auto">
        {/* Cabecera */}
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShoppingCartIcon className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
              Carrito de Ventas
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600"
            aria-label="Cerrar carrito"
          >
            <XMarkIcon className="w-6 h-6" />
          </button>
        </div>

        <div className="px-4 py-3">
          {/* Selector de método de pago */}
          <PaymentMethodSelector
            value={paymentMethod}
            onChange={setPaymentMethod}
            className="w-full mb-4"
          />

          {/* Lista de items */}
          <div className="max-h-[50vh] overflow-auto mb-4">
            {items.length === 0 ? (
              <div className="py-8 text-center text-gray-500 dark:text-gray-400">
                No hay artículos en el carrito
              </div>
            ) : (
              <ul className="space-y-3">
                {items.map((item) => (
                  <CartItemRow key={item.product.id} item={item} />
                ))}
              </ul>
            )}
          </div>

          {/* Total y botones */}
          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
            <div className="flex justify-between items-center py-2">
              <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">Total:</span>
              <span className="text-xl font-bold text-green-600 dark:text-green-400">
                {formatCurrency(total)}
              </span>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onConfirm}
                disabled={items.length === 0 || isConfirming}
                className="flex-1 py-3 rounded-lg bg-green-600 hover:bg-green-700 text-white font-medium transition disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {isConfirming ? (
                  <>
                    <Spinner className="text-white mr-2" />
                    Procesando...
                  </>
                ) : (
                  'Confirmar Venta'
                )}
              </button>

              <button
                onClick={onClear}
                disabled={items.length === 0 || isConfirming}
                className="w-12 h-12 flex items-center justify-center rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 transition disabled:opacity-50"
                aria-label="Vaciar carrito"
              >
                <span className="text-xl">×</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
