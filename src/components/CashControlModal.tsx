// src/components/CashControlModal.tsx
'use client'
import React, { useState } from 'react'
import toast from 'react-hot-toast'
import Spinner from '@/components/ui/Spinner'
import Modal from '@/components/ui/Modal'

export default function CashControlModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isConfirming, setIsConfirming] = useState(false)

  const errorToast = (msg: string) =>
    toast.error(msg, {
      style: { background: '#e53e3e', color: '#fff' },
    })

  const successToast = (msg: string) =>
    toast.success(msg, {
      style: { background: '#38a169', color: '#fff' },
    })

  const parsed = parseFloat(amount)

  // First step: validate & show confirmation
  const handlePrepare = () => {
    if (isNaN(parsed) || parsed < 0) {
      return errorToast('Ingresa un monto válido.')
    }
    setIsConfirming(true)
  }

  // Second step: actually submit
  const handleSubmit = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/cash/count', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ amount: parsed, notes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al registrar')
      successToast('✅ Cierre registrado.')
      // reset everything
      setAmount('')
      setNotes('')
      setIsConfirming(false)
      onClose()
    } catch (err: any) {
      console.error(err)
      errorToast(err.message || 'Error en el servidor.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCancelConfirm = () => {
    setIsConfirming(false)
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h2 className="text-2xl font-semibold mb-4 text-gray-800 dark:text-gray-100">
        🧾 Cierre de Caja
      </h2>

      {!isConfirming ? (
        <div className="space-y-4">
          {/* Monto */}
          <div>
            <label
              htmlFor="cash-amount"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Monto contado
            </label>
            <input
              id="cash-amount"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isSubmitting}
              className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-700 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Notas */}
          <div>
            <label
              htmlFor="cash-notes"
              className="block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Notas (opcional)
            </label>
            <textarea
              id="cash-notes"
              rows={3}
              placeholder="Ej. faltante / sobrante..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isSubmitting}
              className="mt-1 block w-full px-3 py-2 bg-white dark:bg-gray-700 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Botones */}
          <div className="flex justify-end space-x-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-md bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-400 dark:hover:bg-gray-500 transition"
            >
              Cancelar
            </button>
            <button
              onClick={handlePrepare}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-70"
            >
              Continuar
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-center text-gray-800 dark:text-gray-100">
            ¿Confirmas registrar un cierre de caja de&nbsp;
            <span className="font-semibold">{parsed.toFixed(2)}</span>?
          </p>

          <div className="flex justify-end space-x-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleCancelConfirm}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-md bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-400 dark:hover:bg-gray-500 transition"
            >
              Volver
            </button>
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-70"
            >
              {isSubmitting ? (
                <>
                  <Spinner className="w-5 h-5 text-white" />
                  Enviando...
                </>
              ) : (
                'Sí, registrar'
              )}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
