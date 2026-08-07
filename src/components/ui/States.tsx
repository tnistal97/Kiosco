'use client'

import type { ReactNode } from 'react'
import { cn } from './cn'
import { Button } from './Button'

/**
 * Vacio, error y carga.
 *
 * Los tres estados que toda pantalla con datos tiene y que casi ninguna
 * dibuja. Sin ellos, "no hay ventas todavia" y "la peticion fallo" se ven
 * exactamente igual: una tabla vacia.
 */

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line px-6 py-12 text-center',
        className,
      )}
    >
      {icon && <div className="mb-1 text-ink-faint">{icon}</div>}
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-sm text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function ErrorState({
  title = 'No se pudo cargar',
  description,
  onRetry,
  className,
}: {
  title?: string
  description?: ReactNode
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-lg border border-danger/40 bg-danger-quiet px-6 py-10 text-center',
        className,
      )}
    >
      <svg
        className="h-7 w-7 text-danger"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7.5v5.5M12 16.2v.3" strokeLinecap="round" />
      </svg>
      <p className="text-base font-medium text-ink">{title}</p>
      {description && <p className="max-w-md text-sm text-ink-muted">{description}</p>}
      {onRetry && (
        <Button size="sm" variant="secondary" className="mt-3" onClick={onRetry}>
          Reintentar
        </Button>
      )}
    </div>
  )
}

/**
 * Hueco del tamanio del contenido que viene.
 *
 * Reserva el espacio para que la pantalla no salte cuando llegan los datos.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-raised', className)}
      style={{ animationName: 'kc-pulse', animationDuration: '1.4s' }}
    />
  )
}

/** Filas de carga con la forma de la tabla que reemplazan. */
export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2', className)} aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando…</span>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  )
}
