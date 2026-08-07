'use client'

import { absMonto, esCero, esNegativo, formatearMonto, type Monto } from '@/lib/money'
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
 *
 * `amount` es una CADENA decimal --`"1234.56"`--, no un numero. Desde la Fase
 * 3 los importes viajan asi desde el servidor y llegan hasta aca sin pasar por
 * `Number` ni una sola vez. Ver docs/PHASE3_MONEY_MIGRATION.md.
 */

/** Formatea sin JSX. Para textos, atributos y mensajes. */
export function formatMoney(amount: Monto): string {
  return formatearMonto(amount)
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

/**
 * Tono segun el signo del importe.
 *
 * Estaba escrito a mano en seis lugares como `x < 0 ? 'out' : 'in'`, y con
 * importes que ahora son cadenas ese `<` compara alfabeticamente: `"-10.00"`
 * es menor que `"5.00"` por casualidad, y `"9.00"` es MAYOR que `"10.00"`.
 * Concentrarlo aca evita seis oportunidades de equivocarse.
 */
export function tonoPorSigno(amount: Monto): MoneyTone {
  if (esCero(amount)) return 'neutral'
  return esNegativo(amount) ? 'out' : 'in'
}

export interface MoneyProps {
  amount: Monto
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
  const texto = formatearMonto(absMonto(amount))
  const signo = !signed ? '' : esNegativo(amount) ? '−' : '+'

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
