'use client'

import React, { Fragment } from 'react'
import { Dialog, Transition } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { useCartStore } from '@/store/cart'
import CartItem from './CartItem'
import CartFooter from './CartFooter'

interface Props {
  isOpen: boolean
  onClose: () => void
  confirmSale: (paymentMethod: 'efectivo' | 'tarjeta' | 'mercado_pago') => void
}

export default function CartMobile({ isOpen, onClose, confirmSale }: Props) {
  const items = useCartStore((s) => s.items)
  const updateQty = useCartStore((s) => s.updateQuantity)
  const removeFromCart = useCartStore((s) => s.removeFromCart)
  const clearCart = useCartStore((s) => s.clearCart)

  const total = items.reduce((acc, i) => acc + i.product.price * i.quantity, 0)

  return (
    <Transition appear show={isOpen} as={Fragment}>
      <Dialog as="div" className="relative z-50 md:hidden" onClose={onClose}>
        <Transition.Child
          as={Fragment}
          enter="transition-opacity duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="transition-opacity duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
        </Transition.Child>

        <div className="fixed inset-0 flex items-end justify-center">
          <Transition.Child
            as={Fragment}
            enter="transform transition duration-300"
            enterFrom="translate-y-full"
            enterTo="translate-y-0"
            leave="transform transition duration-300"
            leaveFrom="translate-y-0"
            leaveTo="translate-y-full"
          >
            <Dialog.Panel className="w-full h-[80vh] bg-white dark:bg-gray-800 rounded-t-2xl shadow-xl flex flex-col">
              <div className="flex justify-between items-center p-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
                <Dialog.Title className="text-lg sm:text-xl font-bold text-gray-900 dark:text-gray-100">
                  Carrito de Ventas
                </Dialog.Title>
                <button
                  onClick={onClose}
                  className="p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  <XMarkIcon className="w-6 h-6 text-gray-500 dark:text-gray-400" />
                </button>
              </div>

              {/* Lista de Items (mobile) */}
              <div className="flex-1 overflow-auto p-4 bg-gray-100 dark:bg-gray-900 space-y-3">
                {items.length === 0 ? (
                  <p className="text-center text-gray-500 dark:text-gray-400">
                    No hay artículos en el carrito.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {items.map((item) => (
                      <CartItem
                        key={item.product.id}
                        item={item}
                        updateQty={updateQty}
                        removeFromCart={removeFromCart}
                      />
                    ))}
                  </ul>
                )}
              </div>

              {/* Totales & Acciones (mobile) */}
              <CartFooter
                total={total}
                itemsCount={items.length}
                clearCart={() => {
                  clearCart()
                  onClose()
                }}
                confirmSale={(pm) => {
                  confirmSale(pm)
                  onClose()
                }}
              />
            </Dialog.Panel>
          </Transition.Child>
        </div>
      </Dialog>
    </Transition>
  )
}
