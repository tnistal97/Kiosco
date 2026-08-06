'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import Spinner from '@/components/ui/Spinner'
import { apiRequest, mensajeDeError } from '@/lib/api-client'

export default function CashControl() {
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    const parsed = parseFloat(amount)
    if (isNaN(parsed) || parsed < 0) {
      toast.error('Ingresa un monto válido.', { duration: 3000 })
      return
    }

    setIsSubmitting(true)
    try {
      await apiRequest('/api/cash/count', {
        method: 'POST',
        body: { amount: parsed, notes },
        parse: () => null,
      })

      toast.success('✅ Cierre de caja registrado correctamente.', {
        duration: 4000,
      })
      setAmount('')
      setNotes('')
    } catch (err) {
      console.error(err)
      toast.error(mensajeDeError(err, 'Error al registrar cierre'), { duration: 4000 })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <section className="bg-gray-50 dark:bg-gray-800 p-6 rounded-xl shadow-md max-w-md mx-auto">
      <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-100 mb-4">
        🧾 Control de Caja
      </h2>
      <div className="space-y-4">
        {/* Monto */}
        <div>
          <label
            htmlFor="amount"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Monto contado <span className="text-red-500">*</span>
          </label>
          <input
            id="amount"
            type="number"
            step="0.01"
            min="0"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSubmitting}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
          />
        </div>

        {/* Notas */}
        <div>
          <label
            htmlFor="notes"
            className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
          >
            Notas (opcional)
          </label>
          <textarea
            id="notes"
            rows={3}
            placeholder="Ej. faltantes, sobrantes, observaciones..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={isSubmitting}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition resize-none"
          />
        </div>

        {/* Botón de envío */}
        <div>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-lg transition disabled:opacity-70"
          >
            {isSubmitting ? (
              <>
                <Spinner className="w-5 h-5 text-white" />
                Registrando...
              </>
            ) : (
              'Registrar cierre'
            )}
          </button>
        </div>
      </div>
    </section>
  )
}
