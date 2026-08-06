'use client'

type FiltroPago = 'todas' | 'efectivo' | 'tarjeta' | 'mercado_pago'

const OPCIONES: readonly FiltroPago[] = ['todas', 'efectivo', 'tarjeta', 'mercado_pago']

function esFiltroValido(v: string): v is FiltroPago {
  return (OPCIONES as readonly string[]).includes(v)
}

interface Props {
  paymentFilter: FiltroPago
  setPaymentFilter: (v: FiltroPago) => void
}

export default function PaymentFilter({ paymentFilter, setPaymentFilter }: Props) {
  return (
    <div className="flex flex-col">
      <label className="text-sm text-gray-300 mb-1">Filtrar por Pago</label>
      <select
        value={paymentFilter}
        onChange={(e) => {
          if (esFiltroValido(e.target.value)) setPaymentFilter(e.target.value)
        }}
        className="w-full px-3 py-2 bg-gray-700 text-gray-100 rounded border border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition"
      >
        <option value="todas">Todas las Formas</option>
        <option value="efectivo">Efectivo</option>
        <option value="tarjeta">Tarjeta</option>
        <option value="mercado_pago">Mercado Pago</option>
      </select>
    </div>
  )
}
