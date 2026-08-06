'use client'

import React from 'react'
import type { AuditLog } from '@/types/audit' // ← importar del archivo de tipos

interface StockSectionProps {
  registrosStock: AuditLog[]
  productsMap: Record<number, string>
  formatearFecha: (ts: string) => string
  formatearHora: (ts: string) => string
}

export default function StockSection({
  registrosStock,
  productsMap,
  formatearFecha,
  formatearHora,
}: StockSectionProps) {
  if (registrosStock.length === 0) {
    return (
      <div className="bg-gray-800/50 rounded-xl p-8 text-center">
        <p className="text-gray-400">No hay cargas manuales de stock en este rango.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-5">
      {registrosStock.map((log) => {
        const beforeQty = log.changes.before?.quantity ?? 0
        const afterQty = log.changes.after?.quantity ?? 0
        const agregado = afterQty - beforeQty
        const fecha = formatearFecha(log.timestamp)
        const hora = formatearHora(log.timestamp)
        const prodId = log.changes.after?.productId
        const prodName = prodId ? productsMap[prodId] || 'Producto' : 'Producto'

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
              <span className="bg-green-600/80 text-white px-3 py-1 rounded-full text-sm font-medium">
                +{agregado} unidades
              </span>
            </div>

            <div className="px-4 py-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <h4 className="text-white font-medium">{prodName}</h4>
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 text-sm">{beforeQty}</span>
                  <span className="text-gray-300">→</span>
                  <span className="text-white font-medium">{afterQty}</span>
                </div>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
