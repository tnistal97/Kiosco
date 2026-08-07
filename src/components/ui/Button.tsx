'use client'

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import Link from 'next/link'
import { cn } from './cn'

/**
 * El unico boton del sistema.
 *
 * Cinco variantes y ninguna mas. Cada una dice que hace, no como se ve:
 *
 *   primary    la accion principal de la pantalla. Una sola por pantalla.
 *   confirm    cobrar, guardar, confirmar. Verde porque en una caja el verde
 *              significa "adelante" y se busca sin leer.
 *   secondary  todo lo demas que sea una accion.
 *   ghost      acciones de fila y de barra: sin fondo hasta que se apunta.
 *   danger     destruye o anula. Nunca al lado de una accion comun.
 *
 * Todos los tamanios llegan a 44 px de alto salvo `xs`, que existe solo para
 * controles dentro de una celda de tabla en escritorio y no debe usarse como
 * unico camino a una accion.
 */
export type ButtonVariant = 'primary' | 'confirm' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

const VARIANTES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-ink-on-solid hover:bg-primary-hover active:bg-primary-hover border border-transparent font-semibold',
  confirm:
    'bg-success text-ink-on-solid hover:bg-success-hover active:bg-success-hover border border-transparent font-semibold',
  secondary:
    'bg-raised text-ink hover:bg-line border border-line-strong hover:border-line-strong font-medium',
  ghost: 'bg-transparent text-ink-muted hover:bg-raised hover:text-ink border border-transparent',
  danger:
    'bg-transparent text-danger hover:bg-danger-quiet border border-danger/45 hover:border-danger font-medium',
}

const TAMANIOS: Record<ButtonSize, string> = {
  xs: 'h-8 px-2.5 text-xs gap-1.5 rounded-sm',
  sm: 'h-touch px-3 text-sm gap-2 rounded-md',
  md: 'h-touch px-4 text-sm gap-2 rounded-md',
  lg: 'h-control-lg px-6 text-base gap-2.5 rounded-lg',
}

const BASE =
  'inline-flex items-center justify-center whitespace-nowrap transition-colors select-none ' +
  'disabled:opacity-45 disabled:pointer-events-none'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Muestra el indicador de espera y bloquea el boton. */
  loading?: boolean
  /** Ocupa todo el ancho disponible. */
  block?: boolean
  iconStart?: ReactNode
  iconEnd?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    block = false,
    iconStart,
    iconEnd,
    className,
    children,
    disabled,
    type = 'button',
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      // `aria-busy` se lo dice al lector de pantalla; `disabled` impide el
      // segundo click. Las dos cosas, no una.
      aria-busy={loading || undefined}
      disabled={disabled ?? loading}
      className={cn(BASE, VARIANTES[variant], TAMANIOS[size], block && 'w-full', className)}
      {...rest}
    >
      {loading ? <Spinner /> : iconStart}
      {children}
      {!loading && iconEnd}
    </button>
  )
})

/**
 * Boton de un solo icono.
 *
 * `label` es obligatorio: sin texto visible, el nombre accesible es lo unico
 * que tiene un lector de pantalla, y sin el, el boton no existe.
 */
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'iconStart' | 'iconEnd'> {
  label: string
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, children, size = 'md', variant = 'ghost', className, ...rest },
  ref,
) {
  const cuadrado: Record<ButtonSize, string> = {
    xs: 'h-8 w-8 p-0 rounded-sm',
    sm: 'h-touch w-touch p-0 rounded-md',
    md: 'h-touch w-touch p-0 rounded-md',
    lg: 'h-control-lg w-control-lg p-0 rounded-lg',
  }

  return (
    <Button
      ref={ref}
      size={size}
      variant={variant}
      aria-label={label}
      title={label}
      className={cn(cuadrado[size], className)}
      {...rest}
    >
      {children}
    </Button>
  )
})

/** Enlace con el aspecto de un boton. Sigue siendo un enlace: se puede abrir en otra pestania. */
export function ButtonLink({
  href,
  variant = 'secondary',
  size = 'md',
  block = false,
  className,
  children,
  ...rest
}: {
  href: string
  variant?: ButtonVariant
  size?: ButtonSize
  block?: boolean
  className?: string
  children: ReactNode
} & Omit<React.ComponentProps<typeof Link>, 'href' | 'className'>) {
  return (
    <Link
      href={href}
      className={cn(BASE, VARIANTES[variant], TAMANIOS[size], block && 'w-full', className)}
      {...rest}
    >
      {children}
    </Link>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
