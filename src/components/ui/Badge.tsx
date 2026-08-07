'use client'

import type { ReactNode } from 'react'
import { cn } from './cn'
import { estadoDeStock } from '@/modules/inventory/minimum'
import type { TextoCantidad } from '@/lib/cantidad'
import {
  formatearCantidad,
  formatearCantidadConUnidad,
  type UnidadDeVenta,
} from '@/modules/products/units'

/**
 * Etiquetas de estado.
 *
 * Regla de la fase: **nunca solo color**. Cada estado trae ademas una forma
 * --un punto, una barra, un icono-- y su texto. Una venta anulada tiene que
 * distinguirse en una impresion en blanco y negro.
 */

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger'

const TONOS: Record<BadgeTone, string> = {
  neutral: 'bg-raised text-ink-muted border-line',
  primary: 'bg-primary-quiet text-primary border-primary/40',
  success: 'bg-success-quiet text-success border-success/40',
  warning: 'bg-warning-quiet text-warning border-warning/40',
  danger: 'bg-danger-quiet text-danger border-danger/40',
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        TONOS[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/**
 * Estado con marca de forma.
 *
 * El glifo va antes del texto y no es decorativo: es la parte que sobrevive
 * a la ausencia de color.
 */
export function StatusBadge({
  tone = 'neutral',
  glyph,
  children,
  className,
}: {
  tone?: BadgeTone
  /** Simbolo que acompania al texto. Por omision, un punto. */
  glyph?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Badge tone={tone} className={className}>
      <span aria-hidden="true" className="text-[0.7rem] leading-none">
        {glyph ?? '●'}
      </span>
      {children}
    </Badge>
  )
}

/** Estados de venta. Un solo lugar decide como se ve cada uno. */
export function SaleStatusBadge({ status }: { status: string }) {
  if (status === 'canceled') {
    return (
      <StatusBadge tone="danger" glyph="✕">
        Anulada
      </StatusBadge>
    )
  }
  return (
    <StatusBadge tone="success" glyph="✓">
      Vigente
    </StatusBadge>
  )
}

/**
 * Estados de stock, con el mismo criterio en catalogo, caja e inventario.
 *
 * El umbral es el MINIMO DEL PRODUCTO, no una constante global. Hasta la Fase
 * 2 eran diez unidades para todo --el agua mineral y el fernet-- y por eso el
 * aviso no significaba nada. Con `minimum = 0` el producto solo puede estar
 * agotado o en stock: nadie configuro cuanto tiene que haber, y el sistema no
 * lo inventa. Ver docs/INVENTORY_LEDGER.md, seccion 8.
 *
 * La cantidad llega como cadena decimal y con su unidad, desde la Fase 3B. Un
 * "3,500" sin unidad no dice si son tres kilos y medio o tres unidades y
 * media, y la segunda no existe.
 */
export function StockBadge({
  quantity,
  minimum = '0.000',
  unit = 'UNIT',
}: {
  quantity: TextoCantidad
  minimum?: TextoCantidad
  unit?: UnidadDeVenta
}) {
  const estado = estadoDeStock(quantity, minimum)

  if (estado === 'OUT') {
    return (
      <StatusBadge tone="danger" glyph="✕">
        Agotado
      </StatusBadge>
    )
  }
  if (estado === 'LOW') {
    return (
      <StatusBadge tone="warning" glyph="▲">
        Quedan {formatearCantidadConUnidad(quantity, unit)} · mín.{' '}
        {formatearCantidad(minimum, unit)}
      </StatusBadge>
    )
  }
  return (
    <StatusBadge tone="neutral" glyph="●">
      {formatearCantidadConUnidad(quantity, unit)} en stock
    </StatusBadge>
  )
}
