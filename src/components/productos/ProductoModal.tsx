'use client'

import { Fragment, useState, useEffect } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { Product, Category } from '@/hooks/useProducts'
import toast from 'react-hot-toast'
import { apiRequest, mensajeDeError } from '@/lib/api-client'

interface Props {
  isOpen: boolean
  onClose: () => void
  categories: Category[] // Lista de categorías
  product: Product | null // null = crear nuevo; otherwise = editar
  onSaved: () => void // Callback cuando se guarda con éxito
}

export default function ProductoModal({ isOpen, onClose, categories, product, onSaved }: Props) {
  const [formData, setFormData] = useState<{
    name: string
    barcode: string
    description: string
    price: number
    categoryId: number
    originalStock: number // Stock actual (solo lectura)
    addStockAmount: number // Cantidad que queremos agregar
  }>({
    name: '',
    barcode: '',
    description: '',
    price: 0,
    categoryId: 0,
    originalStock: 0,
    addStockAmount: 0,
  })

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name,
        barcode: product.barcode || '',
        description: product.description || '',
        price: product.price,
        categoryId: product.category.id,
        originalStock: product.totalStock || 0,
        addStockAmount: 0,
      })
    } else {
      setFormData({
        name: '',
        barcode: '',
        description: '',
        price: 0,
        categoryId: 0,
        originalStock: 0,
        addStockAmount: 0,
      })
    }
  }, [product])

  const handleSubmit = async () => {
    if (!formData.name || formData.categoryId === 0 || formData.price <= 0) {
      toast.error('Completa todos los campos obligatorios.', {
        duration: 4000,
        style: {
          background: '#991b1b',
          color: '#f9fafb',
          fontSize: '1.2rem',
          padding: '1rem 1.5rem',
          border: '2px solid #7f1d1d',
          borderRadius: '0.75rem',
        },
        iconTheme: {
          primary: '#f87171',
          secondary: '#991b1b',
        },
      })
      return
    }

    const computedStock = formData.originalStock + formData.addStockAmount
    const payload = {
      name: formData.name,
      barcode: formData.barcode || null,
      description: formData.description || null,
      price: formData.price,
      categoryId: formData.categoryId,
      totalStock: computedStock,
    }

    const method = product ? 'PUT' : 'POST'
    const url = product ? `/api/products/${product.id}` : '/api/products'

    try {
      await apiRequest(url, { method, body: payload, parse: () => null })

      toast.success(
        product ? '✅ Producto actualizado con éxito' : '✅ Producto creado con éxito',
        {
          duration: 4000,
          style: {
            background: '#1f2937',
            color: '#f9fafb',
            fontSize: '1.2rem',
            padding: '1rem 1.5rem',
            border: '2px solid #374151',
            borderRadius: '0.75rem',
          },
          iconTheme: {
            primary: '#22c55e',
            secondary: '#1f2937',
          },
        },
      )

      onSaved()
    } catch (err) {
      console.error(err)
      toast.error(mensajeDeError(err, 'Error al guardar el producto.'), {
        duration: 5000,
        style: {
          background: '#991b1b',
          color: '#f9fafb',
          fontSize: '1.2rem',
          padding: '1rem 1.5rem',
          border: '2px solid #7f1d1d',
          borderRadius: '0.75rem',
        },
        iconTheme: {
          primary: '#f87171',
          secondary: '#991b1b',
        },
      })
    }
  }

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="fixed inset-0 z-50" onClose={onClose}>
        {/* Fondo semitransparente */}
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-70"
          leave="ease-in duration-200"
          leaveFrom="opacity-70"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black" />
        </Transition.Child>

        {/* Contenido del modal */}
        <div className="fixed inset-0 overflow-y-auto">
          <div className="flex min-h-full items-center justify-center p-4">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 scale-95"
              enterTo="opacity-100 scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 scale-100"
              leaveTo="opacity-0 scale-95"
            >
              <Dialog.Panel className="relative w-full max-w-2xl bg-gray-800 rounded-lg shadow-xl transform transition-all overflow-hidden">
                {/* Botón cerrar */}
                <button
                  onClick={onClose}
                  className="absolute top-4 right-4 text-gray-400 hover:text-gray-200"
                >
                  <XMarkIcon className="h-6 w-6" />
                </button>

                <div className="p-6">
                  <Dialog.Title className="text-2xl font-bold text-white mb-4">
                    {product ? '✏️ Editar Producto' : '➕ Nuevo Producto'}
                  </Dialog.Title>

                  {/* Contenedor en dos columnas en pantallas grandes */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Columna Izquierda */}
                    <div className="space-y-4">
                      {/* Nombre */}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Nombre <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="text"
                          placeholder="Ej. Gaseosa Cola 2L"
                          value={formData.name}
                          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                          className="w-full p-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* Código de barras */}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Código de barras
                        </label>
                        <input
                          type="text"
                          placeholder="Opcional"
                          value={formData.barcode}
                          onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                          className="w-full p-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* Categoría */}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Categoría <span className="text-red-500">*</span>
                        </label>
                        <select
                          value={formData.categoryId}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              categoryId: +e.target.value,
                            })
                          }
                          className="w-full p-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          <option value={0}>Seleccionar categoría</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Precio */}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Precio <span className="text-red-500">*</span>
                        </label>
                        <input
                          type="number"
                          placeholder="Ej. 120.50"
                          min="0"
                          value={formData.price}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              price: +e.target.value,
                            })
                          }
                          className="w-full p-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>

                    {/* Columna Derecha */}
                    <div className="space-y-4">
                      {/* Descripción */}
                      <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                          Descripción
                        </label>
                        <textarea
                          placeholder="Agregar un breve detalle..."
                          value={formData.description}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              description: e.target.value,
                            })
                          }
                          className="w-full h-32 p-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>

                      {/* Condicional: si existe `product`, mostramos stock actual y campo de agregar */}
                      {product ? (
                        <>
                          <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                              Stock actual
                            </label>
                            <div className="w-full p-3 bg-gray-700 text-white rounded-lg border border-gray-600">
                              {formData.originalStock}
                            </div>
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-300 mb-1">
                              Agregar al stock
                            </label>
                            <input
                              type="number"
                              placeholder="Cantidad a agregar"
                              min="0"
                              value={formData.addStockAmount}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  addStockAmount: Math.max(0, +e.target.value),
                                })
                              }
                              className="w-full p-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </>
                      ) : (
                        /* Si es un producto NUEVO: solicitamos stock inicial */
                        <div>
                          <label className="block text-sm font-medium text-gray-300 mb-1">
                            Stock inicial <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="number"
                            placeholder="Ej. 50"
                            min="0"
                            value={formData.originalStock}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                originalStock: Math.max(0, +e.target.value),
                              })
                            }
                            className="w-full p-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Botones de acción final */}
                  <div className="mt-6 flex justify-end space-x-3">
                    <button
                      onClick={onClose}
                      className="px-5 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={() => void handleSubmit()}
                      className="px-6 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition"
                    >
                      {product ? 'Guardar cambios' : 'Crear producto'}
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition>
  )
}
