'use client'

import React, { useState } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { useCartStore } from '@/store/cart'
import { XMarkIcon } from '@heroicons/react/24/outline'

export default function CartModal() {
  const [open, setOpen] = useState(false)
  const [paymentType, setPaymentType] = useState<'efectivo' | 'mercado_pago'>('efectivo')
  const items = useCartStore((s) => s.items)
  const clearCart = useCartStore((s) => s.clearCart)
  const total = items.reduce((sum, i) => sum + i.product.price * i.quantity, 0)

  const handleConfirm = () => {
    alert(`Venta registrada: $${total.toFixed(2)} — ${paymentType === 'efectivo' ? 'Efectivo' : 'MercadoPago'}`)
    clearCart()
    setOpen(false)
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 bg-primary text-white px-5 py-3 rounded-full shadow-lg hover:bg-primary-hover transition"
      >
        🛒 Ver carrito ({items.length})
      </button>

      <Transition appear show={open} as={React.Fragment}>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          className="relative z-50"
        >
          {/* Overlay */}
          <Transition.Child
            as={React.Fragment}
            enter="transition-opacity duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="transition-opacity duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
          </Transition.Child>

          {/* Modal */}
          <div className="fixed inset-0 flex items-center justify-center p-4 sm:items-end sm:justify-center">
            <Transition.Child
              as={React.Fragment}
              enter="transition-transform duration-300"
              enterFrom="translate-y-full opacity-0 sm:scale-95"
              enterTo="translate-y-0 opacity-100 sm:scale-100"
              leave="transition-transform duration-300"
              leaveFrom="translate-y-0 opacity-100 sm:scale-100"
              leaveTo="translate-y-full opacity-0 sm:scale-95"
            >
              <Dialog.Panel className="w-full max-w-md bg-background text-foreground rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[80vh] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-border bg-card">
                  <Dialog.Title className="text-lg font-bold">🧾 Confirmar Venta</Dialog.Title>
                  <button
                    onClick={() => setOpen(false)}
                    className="text-muted hover:text-foreground transition"
                  >
                    <XMarkIcon className="w-6 h-6" />
                  </button>
                </div>

                {/* Body */}
                <div className="flex-1 p-4 overflow-y-auto space-y-3 bg-background">
                  {items.length === 0 ? (
                    <p className="text-sm text-muted text-center">
                      No hay productos en el carrito.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {items.map((item, idx) => (
                        <li
                          key={idx}
                          className="bg-card border border-border rounded-lg shadow-sm p-3 flex justify-between items-center"
                        >
                          <div>
                            <p className="font-semibold text-foreground">{item.product.name}</p>
                            <p className="text-xs text-muted">Cantidad: {item.quantity}</p>
                          </div>
                          <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                            ${ (item.product.price * item.quantity).toFixed(2) }
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-border bg-card space-y-4">
                  <div className="flex justify-between font-semibold text-foreground">
                    <span>Total</span>
                    <span className="text-green-600 dark:text-green-400">${total.toFixed(2)}</span>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1">Forma de pago:</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="pago"
                          value="efectivo"
                          checked={paymentType === 'efectivo'}
                          onChange={() => setPaymentType('efectivo')}
                          className="accent-blue-600"
                        />
                        <span>Efectivo</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="pago"
                          value="mercado_pago"
                          checked={paymentType === 'mercado_pago'}
                          onChange={() => setPaymentType('mercado_pago')}
                          className="accent-blue-600"
                        />
                        <span>MercadoPago</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex gap-3 justify-end pt-2">
                    <button
                      onClick={() => setOpen(false)}
                      className="px-4 py-2 rounded-md border border-border text-sm hover:bg-background transition"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleConfirm}
                      className="px-4 py-2 rounded-md bg-green-600 text-white text-sm font-semibold hover:bg-green-700 transition"
                    >
                      Confirmar Venta
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </Dialog>
      </Transition>
    </>
  )
}
