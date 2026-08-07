'use client'

import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'
import { cn } from './cn'

/**
 * Tablas.
 *
 * En escritorio, una tabla de verdad. En movil no se estira ni se corta: la
 * pantalla usa `CardList` en su lugar. Lo que nunca ocurre es que la tabla
 * arrastre la pagina entera hacia el costado — por eso el desplazamiento
 * horizontal vive dentro de `TableWrap` y no en el `body`.
 */

export function TableWrap({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('w-full overflow-x-auto rounded-lg border border-line bg-surface', className)}
    >
      {children}
    </div>
  )
}

export function Table({
  children,
  caption,
  className,
}: {
  children: ReactNode
  /** Descripcion de la tabla para lectores de pantalla. */
  caption?: string
  className?: string
}) {
  return (
    <table className={cn('w-full border-collapse text-sm', className)}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  )
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="border-b border-line bg-raised">{children}</thead>
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-line">{children}</tbody>
}

export function TR({
  children,
  className,
  interactive = false,
  selected = false,
  ...rest
}: {
  children: ReactNode
  className?: string
  interactive?: boolean
  selected?: boolean
} & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      aria-selected={interactive ? selected : undefined}
      className={cn(
        'transition-colors',
        interactive && 'cursor-pointer hover:bg-raised',
        selected && 'bg-primary-quiet',
        className,
      )}
      {...rest}
    >
      {children}
    </tr>
  )
}

export function TH({
  children,
  align = 'left',
  className,
  ...rest
}: { align?: 'left' | 'right' | 'center' } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn(
        'px-3 py-2.5 text-xs font-semibold tracking-wide text-ink-muted uppercase',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  )
}

export function TD({
  children,
  align = 'left',
  className,
  ...rest
}: { align?: 'left' | 'right' | 'center' } & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      className={cn(
        'px-3 py-2.5 text-ink',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  )
}

/**
 * Encabezado que ordena.
 *
 * Es un `button` dentro del `th`, con `aria-sort` en la celda: asi lo espera
 * un lector de pantalla, y asi funciona con el teclado sin nada extra.
 */
export function SortableTH({
  children,
  active,
  direction,
  onSort,
  align = 'left',
}: {
  children: ReactNode
  active: boolean
  direction: 'asc' | 'desc'
  onSort: () => void
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <TH
      align={align}
      aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={onSort}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm py-1 transition-colors hover:text-ink',
          active && 'text-ink',
        )}
      >
        {children}
        <span aria-hidden="true" className={cn('text-[0.65rem]', !active && 'opacity-35')}>
          {active ? (direction === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </TH>
  )
}

/**
 * Lista de tarjetas: la misma informacion que la tabla, en movil.
 *
 * No es una tabla estrujada. Una tabla de siete columnas a 375 px no se
 * arregla achicando la fuente.
 */
export function CardList({ children, className }: { children: ReactNode; className?: string }) {
  return <ul className={cn('flex flex-col gap-2', className)}>{children}</ul>
}

export function CardListItem({
  children,
  className,
  onClick,
}: {
  children: ReactNode
  className?: string
  onClick?: () => void
}) {
  if (onClick) {
    return (
      <li>
        <button
          type="button"
          onClick={onClick}
          className={cn(
            'w-full rounded-lg border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-raised',
            className,
          )}
        >
          {children}
        </button>
      </li>
    )
  }
  return (
    <li className={cn('rounded-lg border border-line bg-surface p-3', className)}>{children}</li>
  )
}
