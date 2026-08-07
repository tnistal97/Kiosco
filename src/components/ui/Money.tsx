'use client'

import { cn } from './cn'

/**
 * Dinero.
 *
 * Un unico formato en todo el sistema. Antes convivian `$4850.00` y
 * `$ 134.600,00` en la misma pantalla, con dos funciones distintas de
 * formateo y ninguna documentada.
 *
 * El signo se muestra explicito cuando el numero tiene direccion (un
 * movimiento de caja entra o sale). El color acompania, pero el signo es lo
 * que informa: quien no distingue rojo de verde tiene que poder leerlo igual.
 */

const FORMATO = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Formatea sin JSX. Para textos, atributos y mensajes. */
export function formatMoney(amount: number): string {
  return FORMATO.format(amount)
}

export type MoneySize = 'sm' | 'md' | 'lg' | 'xl' | 'hero'
export type MoneyTone = 'neutral' | 'in' | 'out' | 'muted'

const TAMANIOS: Record<MoneySize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl',
  xl: 'text-3xl',
  // El total de la venta. Tiene que leerse de lejos.
  hero: 'text-4xl sm:text-5xl',
}

const TONOS: Record<MoneyTone, string> = {
  neutral: 'text-money',
  in: 'text-success',
  out: 'text-danger',
  muted: 'text-ink-muted',
}

export interface MoneyProps {
  amount: number
  size?: MoneySize
  tone?: MoneyTone
  /** Antepone + o − segun el signo. Para movimientos de caja. */
  signed?: boolean
  className?: string
}

export function Money({
  amount,
  size = 'md',
  tone = 'neutral',
  signed = false,
  className,
}: MoneyProps) {
  const texto = FORMATO.format(Math.abs(amount))
  const signo = !signed ? '' : amount < 0 ? '−' : '+'

  return (
    <span
      data-numeric=""
      className={cn('money whitespace-nowrap', TAMANIOS[size], TONOS[tone], className)}
    >
      {signo}
      {texto}
    </span>
  )
}
