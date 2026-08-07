'use client'

import { cn } from './cn'
import { Button } from './Button'

/**
 * Paginacion del servidor.
 *
 * Muestra siempre cuantos hay en total. Sin ese numero, "pagina 3 de 21" no
 * dice si faltan diez productos o mil.
 */
export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  disabled = false,
  className,
}: {
  page: number
  pageSize: number
  total: number
  totalPages: number
  onPageChange: (page: number) => void
  disabled?: boolean
  className?: string
}) {
  if (total === 0) return null

  const desde = (page - 1) * pageSize + 1
  const hasta = Math.min(page * pageSize, total)

  return (
    <nav
      aria-label="Paginacion"
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
    >
      <p className="text-sm text-ink-muted" aria-live="polite">
        <span data-numeric="">
          {desde}–{hasta}
        </span>{' '}
        de <span data-numeric="">{total}</span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || page <= 1}
          onClick={() => {
            onPageChange(page - 1)
          }}
        >
          Anterior
        </Button>
        <span className="px-1 text-sm text-ink-muted" data-numeric="">
          {page} / {totalPages}
        </span>
        <Button
          size="sm"
          variant="secondary"
          disabled={disabled || page >= totalPages}
          onClick={() => {
            onPageChange(page + 1)
          }}
        >
          Siguiente
        </Button>
      </div>
    </nav>
  )
}
