'use client'

import React from 'react'
import type { AuditLog } from '@/types/audit'   // ← importar del archivo de tipos

interface SalesSectionProps {
  registrosVentas: AuditLog[]
  productsMap: Record<number, string>
  formatearFecha: (ts: string) => string
  formatearHora: (ts: string) => string
}

export default function SalesSection({
  registrosVentas,
  productsMap,
  formatearFecha,
  formatearHora,
}: SalesSectionProps) {
  if (registrosVentas.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-xl p-8 text-center">
        <p className="text-gray-400">No se han registrado ventas en este rango.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-5">
      {registrosVentas.map((log) => {
        const after = log.changes.after || {}
        const items: any[] = Array.isArray(after.items) ? after.items : []
        const totalMonto = items.reduce((sum, it) => sum + it.price * it.quantity, 0)
        const fecha = formatearFecha(log.timestamp)
        const hora = formatearHora(log.timestamp)

        return (
          <article
            key={log.id}
            className="bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-700 hover:border-gray-600 transition-colors"
          >
            <div className="bg-gray-700/80 px-4 py-3 border-b border-gray-600 flex justify-between items-start">
              <div>
                <h3 className="text-white font-medium text-lg">
                  {log.user?.name || 'Usuario desconocido'}
                </h3>
                <p className="text-gray-300 text-sm">
                  {fecha} · {hora}
                </p>
              </div>
              <span className="bg-blue-600/80 text-white px-3 py-1 rounded-full text-sm font-medium">
                Venta
              </span>
            </div>

            <div className="px-4 py-3 space-y-2">
              <div className="flex justify-between items-center mb-2">
                <h4 className="text-gray-200 font-semibold">Productos vendidos:</h4>
                <p className="text-white font-bold">${totalMonto.toFixed(2)}</p>
              </div>

              <ul className="space-y-2 max-h-64 overflow-y-auto">
                {items.map((it) => (
                  <li
                    key={it.id}
                    className="flex justify-between items-center py-2 border-b border-gray-700/50 last:border-0"
                  >
                    <div>
                      <p className="text-white">
                        {productsMap[it.productId] || 'Producto'}
                      </p>
                      <p className="text-gray-400 text-sm">
                        {it.quantity} × ${it.price.toFixed(2)}
                      </p>
                    </div>
                    <p className="text-gray-200 font-medium">
                      ${(it.quantity * it.price).toFixed(2)}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          </article>
        )
      })}
    </div>
  )
}
