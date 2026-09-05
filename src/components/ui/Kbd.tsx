'use client'

import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Una tecla, dentro de un boton o en una ayuda.
 *
 * Es la forma de que un atajo se descubra sin leer un manual: el boton de
 * cobrar dice "Cobrar" y al lado, mas chico, "Enter".
 *
 * `aria-hidden` a proposito. La tecla es una pista visual; el nombre accesible
 * del boton sigue siendo "Cobrar" y no "Cobrar Enter", que es lo que un lector
 * de pantalla anunciaria y lo que una prueba busca. Los atajos se listan
 * completos, y con su descripcion, en la ayuda de la pantalla.
 */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      aria-hidden="true"
      className={cn(
        'inline-flex items-center rounded border border-current/30 px-1.5 py-0.5 font-sans text-[0.72em] leading-none font-normal',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
