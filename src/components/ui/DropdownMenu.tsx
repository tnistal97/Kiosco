'use client'

import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from '@headlessui/react'
import Link from 'next/link'
import { Fragment, type ReactNode } from 'react'
import { cn } from './cn'

/**
 * Menu desplegable.
 *
 * Headless UI aporta el patron completo de `menu`/`menuitem`: flechas para
 * moverse, Escape para cerrar, foco de vuelta al disparador. Aca solo se le
 * pone la ropa.
 *
 * Cada item llega a 44 px de alto: el menu de usuario y el de acciones de
 * fila se usan tambien con el dedo.
 *
 * `as={Fragment}` y no `as="div"`
 * ------------------------------
 * Con `as="div"`, Headless UI envolvia el disparador en un `<div>` propio y le
 * colgaba `aria-haspopup` y `aria-expanded`. Un `div` sin rol no admite
 * `aria-expanded`: axe lo marca como falta critica de `aria-allowed-attr`, y
 * con razon --un lector de pantalla anuncia el estado de algo que no dice ser
 * un control--. Ademas quedaba un boton dentro de un contenedor que capturaba
 * el click.
 *
 * Con `Fragment`, esos atributos se fusionan sobre el elemento que se le pasa.
 * Todos los disparadores de la aplicacion son `<button>`, que si los admite.
 * Por eso `trigger` tiene que seguir siendo un unico elemento capaz de recibir
 * `ref` y props: un `Button`, un `IconButton` o un `<button>` propio.
 */
export function DropdownMenu({
  trigger,
  children,
  align = 'end',
  className,
}: {
  trigger: ReactNode
  children: ReactNode
  align?: 'start' | 'end'
  className?: string
}) {
  return (
    <Menu as="div" className={cn('relative', className)}>
      <MenuButton as={Fragment}>{trigger}</MenuButton>
      <MenuItems
        transition
        anchor={{ to: align === 'end' ? 'bottom end' : 'bottom start', gap: 6 }}
        className={cn(
          'z-50 min-w-52 rounded-lg border border-line bg-surface p-1 shadow-pop',
          'transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0',
          'focus:outline-none',
        )}
      >
        {children}
      </MenuItems>
    </Menu>
  )
}

const ITEM =
  'flex min-h-touch w-full items-center gap-2.5 rounded-md px-3 text-sm text-ink ' +
  'data-[focus]:bg-raised data-[disabled]:opacity-45 data-[disabled]:pointer-events-none'

export function DropdownItem({
  children,
  onClick,
  href,
  disabled,
  tone = 'default',
  icon,
}: {
  children: ReactNode
  onClick?: () => void
  href?: string
  disabled?: boolean
  tone?: 'default' | 'danger'
  icon?: ReactNode
}) {
  const clases = cn(ITEM, tone === 'danger' && 'text-danger data-[focus]:bg-danger-quiet')

  return (
    <MenuItem disabled={disabled}>
      {href ? (
        <Link href={href} className={clases}>
          {icon}
          {children}
        </Link>
      ) : (
        <button type="button" onClick={onClick} className={clases}>
          {icon}
          {children}
        </button>
      )}
    </MenuItem>
  )
}

export function DropdownLabel({ children }: { children: ReactNode }) {
  return <p className="px-3 pt-2 pb-1 text-xs font-medium text-ink-faint">{children}</p>
}

export function DropdownSeparator() {
  return <MenuSeparator className="my-1 h-px bg-line" />
}
