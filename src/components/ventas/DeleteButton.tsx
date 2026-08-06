'use client'
import toast from 'react-hot-toast'
import React, { useState } from 'react'
import { TrashIcon } from '@heroicons/react/24/outline'
import DeleteConfirmationModal from './DeleteConfirmationModal'

interface Props {
  /** Id de la VENTA, no el del movimiento de caja. */
  saleId: number
  onDeleted: (id: number) => void
}

/**
 * Anulacion de una venta.
 *
 * Antes este boton llamaba a `DELETE /api/sales/:id` pasandole el id del
 * MOVIMIENTO de caja, no el de la venta. La ruta ademas estaba entera
 * comentada, asi que siempre devolvia 405 y el boton no hacia nada.
 *
 * Ahora llama a `POST /api/sales/:id/cancel` con el id correcto y un motivo
 * obligatorio. La venta no se borra: queda registrada como anulada.
 */
export default function DeleteButton({ saleId, onDeleted }: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const openModal = () => setIsModalOpen(true)
  const closeModal = () => setIsModalOpen(false)

  const handleConfirmDelete = async (reason: string) => {
    const motivo = reason.trim()
    if (!motivo) {
      toast.error('Hay que indicar el motivo de la anulacion.')
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch(`/api/sales/${saleId}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: motivo }),
      })

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData.error || 'No se pudo anular la venta')
      }

      onDeleted(saleId)

      toast.success('Venta anulada. El stock fue restituido.', {
        duration: 4000,
        style: {
          background: '#1f2937',
          color: '#f9fafb',
          fontSize: '1.2rem',
          padding: '1rem 1.5rem',
          border: '2px solid #374151',
          borderRadius: '0.75rem',
        },
        iconTheme: { primary: '#22c55e', secondary: '#1f2937' },
      })
    } catch (err) {
      const mensaje = err instanceof Error ? err.message : 'Error al anular la venta.'
      toast.error(mensaje, {
        duration: 5000,
        style: {
          background: '#991b1b',
          color: '#f9fafb',
          fontSize: '1.2rem',
          padding: '1rem 1.5rem',
          border: '2px solid #7f1d1d',
          borderRadius: '0.75rem',
        },
        iconTheme: { primary: '#f87171', secondary: '#991b1b' },
      })
    } finally {
      setIsLoading(false)
      closeModal()
    }
  }

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation()
          openModal()
        }}
        className="p-1 rounded-full hover:bg-red-600 text-red-400 hover:text-white transition focus:outline-none"
        aria-label="Anular venta"
        title="Anular venta"
      >
        <TrashIcon className="w-5 h-5" />
      </button>

      <DeleteConfirmationModal
        isOpen={isModalOpen}
        onConfirm={handleConfirmDelete}
        onCancel={closeModal}
        loading={isLoading}
      />
    </>
  )
}
