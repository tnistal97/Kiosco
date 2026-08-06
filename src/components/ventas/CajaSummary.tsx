'use client'

import {
  CurrencyDollarIcon,
  ArrowUpIcon,
  CreditCardIcon,
} from '@heroicons/react/24/outline'

interface Props {
  totalCash: number
  totalEfectivo: number
  totalTarjeta: number
  totalMercadoPago: number
}

export default function CajaSummary({
  totalCash,
  totalEfectivo,
  totalTarjeta,
  totalMercadoPago,
}: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      {/* TOTAL GENERAL */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 flex items-center gap-4">
        <CurrencyDollarIcon className="w-8 h-8 text-blue-400" />
        <div>
          <p className="text-sm text-gray-300">Saldo Actual</p>
          <p className="text-2xl font-semibold text-green-400">
            ${totalCash.toFixed(2)}
          </p>
        </div>
      </div>

      {/* TOTAL EFECTIVO */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 flex items-center gap-4">
        <ArrowUpIcon className="w-8 h-8 text-yellow-400" />
        <div>
          <p className="text-sm text-gray-300">Total Efectivo</p>
          <p className="text-2xl font-semibold text-yellow-400">
            ${totalEfectivo.toFixed(2)}
          </p>
        </div>
      </div>

      {/* TOTAL TARJETA */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 flex items-center gap-4">
        <CreditCardIcon className="w-8 h-8 text-purple-400" />
        <div>
          <p className="text-sm text-gray-300">Total Tarjeta</p>
          <p className="text-2xl font-semibold text-purple-400">
            ${totalTarjeta.toFixed(2)}
          </p>
        </div>
      </div>

      {/* TOTAL MERCADO PAGO */}
      <div className="bg-gray-800 p-6 rounded-lg shadow-lg border border-gray-700 flex items-center gap-4">
        <CurrencyDollarIcon className="w-8 h-8 text-pink-400" />
        <div>
          <p className="text-sm text-gray-300">Total MercadoPago</p>
          <p className="text-2xl font-semibold text-pink-400">
            ${totalMercadoPago.toFixed(2)}
          </p>
        </div>
      </div>
    </div>
  )
}
