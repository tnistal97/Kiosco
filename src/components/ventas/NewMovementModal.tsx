'use client'

import { Fragment, useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { apiRequest, mensajeDeError } from '@/lib/api-client'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSaved: () => void
}

type MovementType = 'ingreso' | 'retiro' | 'deposito'

export default function NewMovementModal({ isOpen, onClose, onSaved }: Props) {
  const [amount, setAmount] = useState<number>(0)
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'tarjeta' | 'mercado_pago'>(
    'efectivo',
  )
  const [description, setDescription] = useState<string>('')
  // El endpoint exige el tipo de movimiento. El formulario no lo enviaba
  // nunca, asi que toda alta manual fallaba con 400.
  const [movementType, setMovementType] = useState<MovementType>('ingreso')
  const [error, setError] = useState<string>('')

  const handleRegister = async () => {
    if (!amount || amount <= 0) {
      setError('El monto debe ser mayor que cero.')
      return
    }

    setError('')
    try {
      await apiRequest('/api/cash', {
        method: 'POST',
        body: { amount, paymentMethod, description, movementType },
        parse: () => null,
      })
      onSaved()
      setAmount(0)
      setPaymentMethod('efectivo')
      setMovementType('ingreso')
      setDescription('')
    } catch (err) {
      setError(mensajeDeError(err, 'Ocurrio un error al registrar.'))
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
              {/* Tipo de movimiento */}
              <div>
                <label className="block text-sm text-gray-300 mb-1">Tipo *</label>
                <select
                  value={movementType}
                  onChange={(e) => setMovementType(e.target.value as MovementType)}
                  className="w-full min-h-[44px] p-2 bg-gray-700 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="ingreso">Ingreso (entra dinero)</option>
                  <option value="retiro">Retiro (sale dinero)</option>
                  <option value="deposito">Deposito (refuerzo de caja)</option>
                </select>
              </div>

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

            {error ? (
              <p role="alert" className="text-sm text-red-300 bg-red-900/40 rounded p-2">
                {error}
              </p>
            ) : null}

            {/* Botones */}
            <div className="flex justify-end gap-3 mt-4">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 rounded-lg"
              >
                Cancelar
              </button>
              <button
                onClick={() => void handleRegister()}
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
