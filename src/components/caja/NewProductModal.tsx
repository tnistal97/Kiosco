'use client'

import { useState } from 'react'
import { XMarkIcon } from '@heroicons/react/24/solid'

interface NewProductModalProps {
  isOpen: boolean
  barcode: string
  onClose: () => void
  onCreated: () => void
}

export default function NewProductModal({
  isOpen,
  barcode,
  onClose,
  onCreated,
}: NewProductModalProps) {
  const [name, setName] = useState('')
  const [stock, setStock] = useState('')
  const [price, setPrice] = useState('')
  const [errorMessage, setErrorMessage] = useState('')

  const handleCreate = async () => {
    if (!name.trim() || !stock.trim() || !price.trim()) {
      setErrorMessage('Por favor complete todos los campos.')
      return
    }

    try {
      const res = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcode,
          name: name.trim(),
          totalStock: Number(stock),
          price: Number(price),
          categoryId: 1, // 👈 ensure the backend is happy!
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Error al crear el producto')
      }

      // Success
      setErrorMessage('')
      alert('✅ Producto creado correctamente.')
      setName('')
      setStock('')
      setPrice('')
      onClose()
      onCreated()
    } catch (err) {
      console.error(err)
      setErrorMessage('Error al crear el producto. Intente nuevamente.')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 px-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-lg w-full overflow-hidden">
        {/* HEADER */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <h2 className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
            🆕 Crear nuevo producto
          </h2>
          <button
            onClick={() => {
              setErrorMessage('')
              onClose()
            }}
            className="p-1 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition"
            aria-label="Cerrar modal"
          >
            <XMarkIcon className="w-5 h-5 text-gray-700 dark:text-gray-300" />
          </button>
        </div>

        {/* BODY */}
        <div className="px-6 py-5 space-y-6">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            El producto con código <span className="font-mono">{barcode}</span> no existe. Complete
            los datos para crearlo:
          </p>

          {/* Inputs */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Nombre del producto
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setErrorMessage('')
                }}
                placeholder="Ej. Leche 1L"
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Stock inicial
              </label>
              <input
                type="number"
                min="0"
                value={stock}
                onChange={(e) => {
                  setStock(e.target.value)
                  setErrorMessage('')
                }}
                placeholder="Ej. 10"
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Precio unitario
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value)
                  setErrorMessage('')
                }}
                placeholder="Ej. 25.50"
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 rounded-lg px-3 py-2 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
          </div>

          {/* Mensaje de error */}
          {errorMessage && <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>}
        </div>

        {/* FOOTER */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-900 flex justify-end space-x-3 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={() => {
              setErrorMessage('')
              onClose()
            }}
            className="px-4 py-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition focus:outline-none focus:ring-2 focus:ring-gray-400"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreate}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Crear Producto
          </button>
        </div>
      </div>
    </div>
  )
}
