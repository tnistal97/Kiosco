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
 * TODOS los tamanios llegan a 44 px de alto. Sin excepciones.
 *
 * Hubo una: `xs` media 32 px y estaba reservada a controles secundarios dentro
 * de un detalle ya abierto --copiar un identificador, ver mas campos--. Ocho
 * botones quedaban por debajo del minimo y la excusa era que "no se tocan con
 * el dedo". No hay forma de saber eso: un detalle abierto en una tablet se
 * toca igual que cualquier otra cosa. El tamanio se elimino en vez de
 * documentarse mejor, y esos dos usos pasaron a `sm`.
 *
 * Lo unico que distingue ahora a un control secundario es la variante --`ghost`
 * no tiene fondo hasta que se apunta-- y no su tamanio.
 */
export type ButtonVariant = 'primary' | 'confirm' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const VARIANTES: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-ink-on-solid hover:bg-primary-hover active:bg-primary-hover border border-transparent font-semibold',
  // UX V5: un solo color de accion. `confirm` existia para pintar de verde
  // cobrar y guardar, pero el verde quedo reservado para "salio bien" (el
  // aviso de venta registrada, un arqueo que cuadra). Se conserva el nombre
  // para no tocar cada llamada; se ve igual que `primary`.
  confirm:
    'bg-primary text-ink-on-solid hover:bg-primary-hover active:bg-primary-hover border border-transparent font-semibold',
  secondary: 'bg-surface text-ink hover:bg-raised border border-line-strong font-semibold',
  ghost:
    'bg-transparent text-ink-muted hover:bg-raised hover:text-ink border border-transparent font-medium',
  danger: 'bg-surface text-danger hover:bg-danger-quiet border border-danger font-semibold',
}

const TAMANIOS: Record<ButtonSize, string> = {
  sm: 'h-touch px-3 text-sm gap-2 rounded-md',
  md: 'h-control px-4 text-[0.9375rem] gap-2 rounded-md',
  lg: 'h-control-lg px-6 text-base gap-2.5 rounded-lg',
  // Solo para la accion principal del punto de venta: cobrar. Se aprieta con
  // el cliente enfrente y tiene que encontrarse sin mirar.
  xl: 'h-control-xl px-8 text-lg gap-3 rounded-lg',
}

// Deshabilitado con colores propios y no con opacidad: un boton apagado al
// 45 % quedaba en 2:1 y no se sabia si estaba apagado o mal impreso.
const BASE =
  'inline-flex items-center justify-center whitespace-nowrap transition-colors select-none ' +
  'disabled:pointer-events-none disabled:bg-disabled-bg disabled:text-disabled-ink ' +
  'disabled:border-line disabled:shadow-none aria-disabled:pointer-events-none ' +
  'aria-disabled:bg-disabled-bg aria-disabled:text-disabled-ink aria-disabled:border-line'

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
  // `px-0!` y no `p-0`: el tamanio del boton trae su `px-*`, y sin
  // tailwind-merge gana el que el CSS ponga despues. Con `lg` ganaba `px-6`,
  // al icono le quedaban 8 px y se encogia hasta ser un punto (el de la
  // camara en Vender). `[&>svg]:shrink-0` es la segunda red.
  const cuadrado: Record<ButtonSize, string> = {
    sm: 'h-touch w-touch px-0! rounded-md [&>svg]:shrink-0',
    md: 'h-control w-control px-0! rounded-md [&>svg]:shrink-0',
    lg: 'h-control-lg w-control-lg px-0! rounded-lg [&>svg]:shrink-0',
    xl: 'h-control-xl w-control-xl px-0! rounded-lg [&>svg]:shrink-0',
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
