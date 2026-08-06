'use client'
import toast from 'react-hot-toast'
import React, { useState } from 'react'
import { TrashIcon } from '@heroicons/react/24/outline'
import DeleteConfirmationModal from './DeleteConfirmationModal'

interface Props {
  saleId: number
  onDeleted: (id: number) => void
}

export default function DeleteButton({ saleId, onDeleted }: Props) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const openModal = () => setIsModalOpen(true)
  const closeModal = () => setIsModalOpen(false)

  const handleConfirmDelete = async () => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/sales/${saleId}`, { method: 'DELETE' })
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Error al eliminar la venta')
      }

      onDeleted(saleId)

      toast.success('✅ Venta eliminada correctamente.', {
        duration: 4000,
        style: {
          background: '#1f2937', // bg-gray-800
          color: '#f9fafb',      // text-gray-50
          fontSize: '1.2rem',    // más grande
          padding: '1rem 1.5rem',
          border: '2px solid #374151', // border-gray-700
          borderRadius: '0.75rem',
        },
        iconTheme: {
          primary: '#22c55e',   // green-500
          secondary: '#1f2937', // combina con el fondo
        },
      })
    } catch (err: any) {
      console.error(err)
      toast.error(err.message || 'Error eliminando la venta.', {
        duration: 5000,
        style: {
          background: '#991b1b', // bg-red-800
          color: '#f9fafb',
          fontSize: '1.2rem',
          padding: '1rem 1.5rem',
          border: '2px solid #7f1d1d', // border-red-900
          borderRadius: '0.75rem',
        },
        iconTheme: {
          primary: '#f87171',   // red-400
          secondary: '#991b1b', // red-800
        },
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
        aria-label="Eliminar venta"
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
