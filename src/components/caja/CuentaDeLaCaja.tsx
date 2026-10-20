import type { ReactNode } from 'react'
import { Money, cn } from '@/components/ui'
import type { Monto } from '@/lib/money'

/**
 * De dónde sale lo que tiene que haber. UX V5.
 *
 * La suma escrita como se haria en un papel, con el signo de cada renglon:
 *
 *     Monto inicial            $ 10.000
 *   + Ventas en efectivo       $ 24.480
 *   + Ingresos                 $  1.500
 *   − Egresos                  $    500
 *   = Saldo esperado           $ 35.480
 *
 * Con los cinco renglones a la vista la cuenta se puede verificar sin abrir
 * nada (auditoria, H-12: con tres parecia mal hecha).
 */
export function CuentaDeLaCaja({
  inicial,
  ventasEnEfectivo,
  cantidadDeVentas,
  ingresos,
  egresos,
  esperado,
  tituloEsperado = 'Saldo esperado',
  className,
}: {
  inicial: Monto
  ventasEnEfectivo: Monto
  cantidadDeVentas: number
  ingresos: Monto
  egresos: Monto
  esperado: Monto
  tituloEsperado?: string
  className?: string
}) {
  return (
    <dl data-cuenta-caja="" className={cn('flex flex-col gap-1.5 text-base', className)}>
      <Renglon signo="" etiqueta="Monto inicial">
        <Money amount={inicial} size="md" />
      </Renglon>
      <Renglon
        signo="+"
        etiqueta="Ventas en efectivo"
        detalle={`${String(cantidadDeVentas)} ${cantidadDeVentas === 1 ? 'venta' : 'ventas'}`}
      >
        <Money amount={ventasEnEfectivo} size="md" />
      </Renglon>
      <Renglon signo="+" etiqueta="Ingresos">
        <Money amount={ingresos} size="md" />
      </Renglon>
      <Renglon signo="−" etiqueta="Egresos">
        <Money amount={egresos} size="md" />
      </Renglon>
      <Renglon signo="=" etiqueta={tituloEsperado} total>
        <Money amount={esperado} size="lg" className="font-semibold" />
      </Renglon>
    </dl>
  )
}

function Renglon({
  signo,
  etiqueta,
  detalle,
  total = false,
  children,
}: {
  signo: string
  etiqueta: string
  detalle?: string
  total?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-baseline gap-x-2',
        total && 'mt-1 border-t-2 border-line-strong pt-2',
      )}
    >
      <span aria-hidden="true" className="text-center font-semibold text-ink-muted">
        {signo}
      </span>
      <dt className={cn('min-w-0', total ? 'font-semibold text-ink' : 'text-ink-muted')}>
        {etiqueta}
        {detalle && <span className="ml-2 text-sm text-ink-faint">({detalle})</span>}
      </dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}
