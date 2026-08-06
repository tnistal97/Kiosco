'use client'

import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import {
  ChevronDownIcon,
  CurrencyDollarIcon,
  CreditCardIcon,
} from '@heroicons/react/24/outline'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

export default function NewMovementModal({ isOpen, onClose, onSaved }: Props) {
  const [amount, setAmount] = useState<number>(0)
  const [paymentMethod, setPaymentMethod] = useState<
    'efectivo' | 'tarjeta' | 'mercado_pago'
  >('efectivo')
  const [description, setDescription] = useState<string>('')

  const handleRegister = async () => {
    if (amount === 0) {
      alert('El monto no puede ser cero.')
      return
    }

    try {
      const payload = { amount, paymentMethod, description }
      const res = await fetch('/api/cash', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Error al registrar movimiento')
      onSaved()
      setAmount(0)
      setPaymentMethod('efectivo')
      setDescription('')
    } catch (err: any) {
      console.error(err)
      alert(err.message || 'Ocurrió un error al registrar.')
    }
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="fixed inset-0 z-50" onClose={onClose}>
        <div className="fixed inset-0 bg-black bg-opacity-50" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <Dialog.Panel className="w-full max-w-md bg-gray-800 text-white rounded-lg p-6 shadow-xl space-y-4">
            <Dialog.Title className="text-xl font-bold">➕ Nuevo Movimiento</Dialog.Title>

            <div className="space-y-4">
              {/* Monto */}
              <div>
                <label className="block text-sm text-gray-300 mb-1">Monto *</label>
                <input
                  type="number"
                  min="0"
                  value={amount}
                  onChange={(e) => setAmount(+e.target.value)}
                  className="w-full p-2 bg-gray-700 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>

              {/* Método de pago */}
              <div>
                <label className="block text-sm text-gray-300 mb-1">Método de Pago *</label>
                <select
                  value={paymentMethod}
                  onChange={(e) =>
                    setPaymentMethod(e.target.value as 'efectivo' | 'tarjeta' | 'mercado_pago')
                  }
                  className="w-full p-2 bg-gray-700 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="efectivo">Efectivo</option>
                  <option value="tarjeta">Tarjeta</option>
                  <option value="mercado_pago">Mercado Pago</option>
                </select>
              </div>

              {/* Descripción */}
              <div>
                <label className="block text-sm text-gray-300 mb-1">Descripción</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-2 bg-gray-700 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  rows={2}
                />
              </div>
            </div>

            {/* Botones */}
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={handleRegister}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg"
              >
                Registrar
              </button>
            </div>
          </Dialog.Panel>
        </div>
      </Dialog>
    </Transition>
  )
}
