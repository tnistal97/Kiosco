// src/app/caja/page.tsx
'use client'
import toast from 'react-hot-toast'
import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useProducts, Product } from '@/hooks/useProducts'
import { useCartStore } from '@/store/cart'
import { apiRequest, mensajeDeError } from '@/lib/api-client'

import SearchBar from '@/components/caja/SearchBar'
import ProductTable from '@/components/caja/ProductTable'
import CartSidebar from '@/components/caja/CartSidebar'
import MobileCartModal from '@/components/caja/MobileCartModal'
import CartButton from '@/components/caja/CartButton'
import NewProductModal from '@/components/caja/NewProductModal'
import ConfirmSaleModal from '@/components/caja/ConfirmSaleModal'

export default function CashRegisterPage() {
  // La busqueda la resuelve el servidor: la caja ya no descarga el catalogo
  // entero cada vez que se abre la pantalla. El escaneo sigue funcionando
  // igual, porque el termino buscado se compara tambien contra el codigo de
  // barras del lado del servidor.
  const {
    products,
    fetchProducts,
    searchTerm: search,
    setSearchTerm: setSearch,
    buscarPorCodigo,
    isLoading,
    error,
  } = useProducts({ enServidor: true })
  const [isCartOpenMobile, setIsCartOpenMobile] = useState(false)

  // Union type para método de pago
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<
    'efectivo' | 'tarjeta' | 'mercado_pago'
  >('efectivo')

  // Modal “nuevo producto”
  const [isNewProductModalOpen, setIsNewProductModalOpen] = useState(false)
  const [newBarcode, setNewBarcode] = useState('')

  // Modal “confirmar venta”
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)

  const items = useCartStore((s) => s.items)
  const total = useMemo(
    () => items.reduce((acc, i) => acc + i.product.price * i.quantity, 0),
    [items],
  )

  // El filtrado ya lo hizo el servidor. Se conserva un filtro local sobre lo
  // recibido para que la lista responda de inmediato a cada tecla, sin
  // esperar la ida y vuelta: son los mismos criterios, aplicados dos veces.
  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return products
    return products.filter(
      (p: Product) =>
        p.name.toLowerCase().includes(term) || (p.barcode ?? '').toLowerCase().includes(term),
    )
  }, [products, search])

  // Mapa productId → cantidad en carrito
  const quantitiesMap = useMemo(() => {
    const map: Record<number, number> = {}
    items.forEach((item) => {
      map[item.product.id] = item.quantity
    })
    return map
  }, [items])

  // Lógica de “confirmSale”: la llamaremos solo desde el modal de confirmación
  async function confirmSale() {
    try {
      // 1️⃣ Validar que los productos sigan existiendo
      const allProductIds = new Set(products.map((p) => p.id))
      for (const item of items) {
        if (!allProductIds.has(item.product.id)) {
          throw new Error(`El producto con ID ${item.product.id} ya no existe.`)
        }
      }

      // 2️⃣ Payload
      //
      // No se manda el precio. El servidor lo toma del catalogo y rechaza la
      // peticion si el navegador intenta enviarlo. Antes se mandaba, y se
      // guardaba tal cual: bastaba con editar la peticion para llevarse un
      // producto de $12.500 por $1.
      const body = {
        items: items.map((item) => ({
          productId: item.product.id,
          quantity: item.quantity,
        })),
        paymentMethod: selectedPaymentMethod,
      }

      // 3️⃣ Llamada a /api/sales
      await apiRequest('/api/sales', { method: 'POST', body, parse: () => null })

      // 4️⃣ Notificación de éxito
      toast.success(`✅ Venta registrada correctamente!`, {
        duration: 5000,
        style: {
          background: '#1f2937', // bg-gray-800
          color: '#f9fafb', // texto claro
          fontSize: '1.2rem', // aún más grande
          padding: '1rem 1.5rem',
          border: '2px solid #374151', // border-gray-700
          borderRadius: '0.75rem',
        },
        iconTheme: {
          primary: '#22c55e', // green-500
          secondary: '#1f2937',
        },
      })

      // Limpiar carrito y búsqueda
      useCartStore.getState().clearCart()
      void fetchProducts()
      setSearch('')
      setIsConfirmModalOpen(false)
    } catch (error) {
      console.error(error)
      toast.error(mensajeDeError(error, 'Error al procesar la venta'), {
        duration: 6000,
        style: {
          background: '#991b1b', // bg-red-800
          color: '#f9fafb', // texto claro
          fontSize: '1.2rem', // más grande
          padding: '1rem 1.5rem',
          border: '2px solid #7f1d1d', // border-red-900
          borderRadius: '0.75rem',
        },
        iconTheme: {
          primary: '#f87171', // red-400
          secondary: '#991b1b',
        },
      })
    }
  }

  // Vaciar carrito
  const clearCart = () => {
    useCartStore.getState().clearCart()
  }

  // Barcode USB support: “tecla → buffer → Enter → setSearch”
  // Si no existe, se abre modal de “nuevo producto”
  const barcodeBuffer = useRef('')
  useEffect(() => {
    let timeoutId: NodeJS.Timeout

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const code = barcodeBuffer.current
        if (code) {
          setSearch(code)
          // La busqueda va contra el servidor, no contra la lista cargada:
          // el producto escaneado puede no estar en la pagina actual.
          void buscarPorCodigo(code).then((encontrado) => {
            if (encontrado) useCartStore.getState().addToCart(encontrado)
            else {
              setNewBarcode(code)
              setIsNewProductModalOpen(true)
            }
          })
          barcodeBuffer.current = ''
        }
        e.preventDefault()
        return
      }
      if (/^[0-9a-zA-Z]+$/.test(e.key)) {
        barcodeBuffer.current += e.key
        clearTimeout(timeoutId)
        timeoutId = setTimeout(() => {
          barcodeBuffer.current = ''
        }, 200)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      clearTimeout(timeoutId)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [buscarPorCodigo, setSearch])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-100 dark:bg-gray-900">
        <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-lg text-center w-full max-w-md">
          <p className="text-xl font-medium text-gray-900 dark:text-gray-100 mb-4">⚠️ {error}</p>
          <button
            onClick={() => void fetchProducts()}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-base transition focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            Reintentar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gray-100 dark:bg-gray-900 pt-16">
      {/* ─── IZQUIERDA: SearchBar + ProductTable ─────────────────────────── */}
      <main className="flex flex-col flex-1 bg-gray-100 dark:bg-gray-900">
        <header className="sticky top-16 z-20 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 py-3 px-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between space-y-4 md:space-y-0">
            {/* SearchBar, siempre enfocado */}
            <SearchBar
              searchValue={search}
              setSearchValue={setSearch}
              disabled={isLoading}
              onEnter={(value) => {
                const found = products.find((p) => p.barcode?.toLowerCase() === value.toLowerCase())
                if (found) {
                  useCartStore.getState().addToCart(found)
                } else {
                  setNewBarcode(value)
                  setIsNewProductModalOpen(true)
                }
              }}
            />

            {/* Selector de método de pago */}
            <div className="flex items-center space-x-4">
              <select
                value={selectedPaymentMethod}
                onChange={(e) =>
                  setSelectedPaymentMethod(
                    e.target.value as 'efectivo' | 'tarjeta' | 'mercado_pago',
                  )
                }
                className="bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
              >
                <option value="efectivo">💵 Efectivo</option>
                <option value="tarjeta">💳 Tarjeta</option>
                <option value="mercado_pago">🏦 Mercado Pago</option>
              </select>

              {/* Botón de carrito (móvil) */}
              <CartButton onClick={() => setIsCartOpenMobile(true)} total={total} />
            </div>
          </div>
        </header>

        {/* ─── Listado productos (scrollable) ───────────────────────────────── */}
        <div className="flex-1 overflow-auto p-6">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow p-4">
            <ProductTable
              filteredProducts={filteredProducts}
              quantitiesMap={quantitiesMap}
              isLoading={isLoading}
            />
          </div>
        </div>
      </main>

      {/* ─── SIDEBAR fijo en desktop ─────────────────────────────────────────── */}
      <CartSidebar onConfirm={() => setIsConfirmModalOpen(true)} onClear={clearCart} />

      {/* ─── MODAL carrito (móvil) ─────────────────────────────────────────── */}
      <MobileCartModal
        isOpen={isCartOpenMobile}
        onClose={() => setIsCartOpenMobile(false)}
        onConfirm={() => setIsConfirmModalOpen(true)}
        onClear={clearCart}
        paymentMethod={selectedPaymentMethod}
        setPaymentMethod={setSelectedPaymentMethod}
        isConfirming={false}
      />

      {/* ─── MODAL “Confirmar Venta” ────────────────────────────────────────── */}
      <ConfirmSaleModal
        isOpen={isConfirmModalOpen}
        onClose={() => setIsConfirmModalOpen(false)}
        onConfirm={() => void confirmSale()}
        paymentMethod={selectedPaymentMethod}
      />

      {/* ─── MODAL “Nuevo Producto” ─────────────────────────────────────────── */}
      <NewProductModal
        isOpen={isNewProductModalOpen}
        barcode={newBarcode}
        onClose={() => setIsNewProductModalOpen(false)}
        onCreated={() => {
          void fetchProducts()
          setIsNewProductModalOpen(false)
        }}
      />
    </div>
  )
}
