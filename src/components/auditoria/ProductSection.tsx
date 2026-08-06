'use client'

import React from 'react'
import type { AuditLog } from '@/types/audit' // ← importar del archivo de tipos
import { numeroOpcional, texto } from '@/lib/api-client'

interface ProductSectionProps {
  registrosProductos: AuditLog[]
  formatearFecha: (ts: string) => string
  formatearHora: (ts: string) => string
}

export default function ProductSection({
  registrosProductos,
  formatearFecha,
  formatearHora,
}: ProductSectionProps) {
  if (registrosProductos.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-xl p-8 text-center">
        <p className="text-gray-400">No hay registros de productos en este rango.</p>
      </div>
    )
  }

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-200 mb-2">Registro de Productos</h2>

      <div className="grid gap-5">
        {registrosProductos.map((log) => {
          // `changes` es JSON de la bitacora: sin forma garantizada.
          const data = log.actionType === 'create' ? log.changes.after : log.changes.before
          const fecha = formatearFecha(log.timestamp)
          const hora = formatearHora(log.timestamp)
          const esCreacion = log.actionType === 'create'
          const nombre = texto(data?.name, 'Producto')
          const precio = numeroOpcional(data?.price)
          const codigo = texto(data?.barcode, 'Sin código')

          return (
            <article
              key={log.id}
              className={`rounded-xl shadow-lg overflow-hidden border hover:border-gray-600 transition-colors ${
                esCreacion ? 'bg-gray-800 border-gray-700' : 'bg-red-800 border-red-700'
              }`}
            >
              <div className="bg-gray-700/80 px-4 py-3 border-b border-gray-600 flex justify-between items-start">
                <div>
                  <h3 className="text-white font-medium text-lg">{log.user.name}</h3>
                  <p className="text-gray-300 text-sm">
                    {fecha} · {hora}
                  </p>
                </div>
                <span
                  className={`px-3 py-1 rounded-full text-sm font-medium ${
                    esCreacion ? 'bg-yellow-600/80 text-white' : 'bg-red-600/80 text-white'
                  }`}
                >
                  {esCreacion ? 'Creado' : 'Eliminado'}
                </span>
              </div>

              <div className="px-4 py-3 space-y-1">
                <p className="text-white font-semibold">{nombre}</p>
                <p className="text-gray-400 text-sm">
                  Precio: ${precio === null ? 'N/A' : precio.toFixed(2)}
                </p>
                <p className="text-gray-400 text-sm">Código: {codigo || 'Sin código'}</p>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
