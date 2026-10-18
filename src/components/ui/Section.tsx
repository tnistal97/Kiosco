import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Seccion de una pantalla. UX V5.
 *
 * Ordena con titulo y espacio, no con una caja: la V4 envolvia todo en
 * tarjetas y cada pantalla terminaba siendo un tablero de rectangulos. Una
 * seccion es un titulo, una linea opcional que explica, las acciones a la
 * derecha y el contenido debajo. Lo que si va en una caja --una tabla, un
 * formulario-- lo pone el contenido.
 */
export function Section({
  title,
  description,
  actions,
  children,
  className,
  as: Tag = 'section',
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  as?: 'section' | 'div'
}) {
  return (
    <Tag className={cn('flex min-w-0 flex-col gap-4', className)}>
      {(title !== undefined || actions !== undefined) && (
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title !== undefined && <h2 className="text-lg font-semibold text-ink">{title}</h2>}
            {description !== undefined && (
              <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
            )}
          </div>
          {actions !== undefined && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      )}
      {children}
    </Tag>
  )
}

export type MetricTone = 'neutral' | 'success' | 'warning' | 'danger'

const TONO_DEL_DETALLE: Record<MetricTone, string> = {
  neutral: 'text-ink-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
}

const SIMBOLO: Record<MetricTone, string | null> = {
  neutral: null,
  success: '✓',
  warning: '▲',
  danger: '✕',
}

/**
 * Un numero con su nombre. UX V5.
 *
 * Sin caja: etiqueta, cifra grande y, si hace falta, una linea de detalle.
 * El color va SOLO en el detalle y siempre con un simbolo al lado, para que
 * el estado no dependa del color. Con `href` toda la metrica es un enlace a
 * la pantalla que explica el numero.
 */
export function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
  href,
  size = 'md',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: MetricTone
  href?: string
  /** `lg` para la cifra principal de la pantalla (el saldo de la caja). */
  size?: 'md' | 'lg'
  className?: string
}) {
  const simbolo = SIMBOLO[tone]
  const cuerpo = (
    <>
      <span className="text-sm font-medium text-ink-muted">{label}</span>
      <span
        data-numeric
        className={cn(
          'font-semibold text-ink',
          size === 'lg' ? 'text-4xl sm:text-5xl' : 'text-metric',
        )}
      >
        {value}
      </span>
      {hint !== undefined && (
        <span className={cn('text-sm', TONO_DEL_DETALLE[tone])}>
          {simbolo && (
            <span aria-hidden="true" className="mr-1">
              {simbolo}
            </span>
          )}
          {hint}
        </span>
      )}
    </>
  )

  const clases = cn('flex min-w-0 flex-col gap-1', className)

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          clases,
          'rounded-md transition-colors hover:[&>span:nth-child(2)]:text-primary',
        )}
      >
        {cuerpo}
      </Link>
    )
  }
  return <div className={clases}>{cuerpo}</div>
}

/**
 * Fila de metricas separadas por una linea, no por cajas. En un telefono se
 * apilan.
 */
export function MetricRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-flow-col sm:auto-cols-fr sm:gap-0 sm:divide-x sm:divide-line',
        '[&>*]:sm:px-6 [&>*:first-child]:sm:pl-0',
        className,
      )}
    >
      {children}
    </div>
  )
}
