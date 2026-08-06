'use client'

import React, { useMemo } from 'react'
import { Sale } from '@/app/admin/sales/page'
import type { TotalesVentas } from '@/modules/sales/dto'
import { formatCurrency } from '@/lib/formatCurrency'

interface Props {
  /** Ventas de la pagina visible. Solo se usan para el desglose por medio de pago. */
  sales: Sale[]
  /** Totales del rango completo, calculados por el servidor. */
  totales: TotalesVentas
}

/** Los unicos metodos que tienen su propia tarjeta de total. */
const METODOS = ['efectivo', 'tarjeta', 'mercado_pago'] as const
type Metodo = (typeof METODOS)[number]

function esMetodoConocido(v: string | null): v is Metodo {
  return v !== null && (METODOS as readonly string[]).includes(v)
}

/**
 * Metricas del reporte.
 *
 * El total de ventas y la recaudacion vienen del servidor y corresponden al
 * rango completo: si se sumaran las de la pagina, pasar a la pagina siguiente
 * cambiaria la recaudacion del mes.
 *
 * El desglose por medio de pago sigue siendo de la pagina, y esta rotulado
 * como tal. Calcularlo sobre el rango completo exigiria una consulta agregada
 * mas; queda para cuando la pantalla se rediseñe.
 */
export default function SalesMetrics({ sales, totales }: Props) {
  const porMetodo = useMemo(() => {
    return sales.reduce(
      (acc, sale) => {
        // Una venta anulada no recaudo nada. Antes se sumaba igual, asi que
        // la recaudacion crecia con cada anulacion en vez de bajar.
        if (sale.status === 'canceled') return acc
        const amount = sale.items.reduce((s, it) => s + it.quantity * it.price, 0)
        if (esMetodoConocido(sale.paymentMethod)) acc[sale.paymentMethod] += amount
        return acc
      },
      { efectivo: 0, tarjeta: 0, mercado_pago: 0 },
    )
  }, [sales])

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
      {/* Ventas del rango */}
      <div className="bg-blue-700 p-6 rounded-lg shadow flex flex-col">
        <span className="text-sm text-blue-200">Ventas</span>
        <span className="mt-2 text-3xl font-bold">{totales.ventas}</span>
        {totales.anuladas > 0 && (
          <span className="mt-1 text-sm text-blue-200">{totales.anuladas} anuladas</span>
        )}
      </div>

      {/* Recaudación del rango */}
      <div className="bg-gray-700 p-6 rounded-lg shadow flex flex-col">
        <span className="text-sm text-gray-300">Recaudación Total</span>
        <span className="mt-2 text-3xl font-bold">{formatCurrency(totales.recaudado)}</span>
      </div>

      {/* Efectivo */}
      <div className="bg-green-700 p-6 rounded-lg shadow flex flex-col">
        <span className="text-sm text-green-200">Efectivo (esta página)</span>
        <span className="mt-2 text-3xl font-bold">{formatCurrency(porMetodo.efectivo)}</span>
      </div>

      {/* Tarjeta */}
      <div className="bg-indigo-700 p-6 rounded-lg shadow flex flex-col">
        <span className="text-sm text-indigo-200">Tarjeta (esta página)</span>
        <span className="mt-2 text-3xl font-bold">{formatCurrency(porMetodo.tarjeta)}</span>
      </div>

      {/* Mercado Pago */}
      <div className="bg-yellow-700 p-6 rounded-lg shadow flex flex-col sm:col-span-2 lg:col-span-1">
        <span className="text-sm text-yellow-200">Mercado Pago (esta página)</span>
        <span className="mt-2 text-3xl font-bold">{formatCurrency(porMetodo.mercado_pago)}</span>
      </div>
    </div>
  )
}
