'use client'

import { useId, useState, type ReactNode } from 'react'
import { cn } from './cn'

/**
 * Ayuda breve al apuntar o al enfocar.
 *
 * Aparece tambien con el teclado, no solo con el mouse, y se va con Escape.
 * Nunca contiene la unica copia de una informacion: si el dato hace falta
 * para operar, va en la pantalla.
 */
export function Tooltip({
  label,
  children,
  side = 'top',
  className,
}: {
  label: string
  children: ReactNode
  side?: 'top' | 'bottom'
  className?: string
}) {
  const id = useId()
  const [visible, setVisible] = useState(false)

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => {
        setVisible(true)
      }}
      onMouseLeave={() => {
        setVisible(false)
      }}
      onFocusCapture={() => {
        setVisible(true)
      }}
      onBlurCapture={() => {
        setVisible(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') setVisible(false)
      }}
    >
      <span aria-describedby={visible ? id : undefined} className="contents">
        {children}
      </span>
      {visible && (
        <span
          id={id}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap',
            'rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink shadow-pop',
            side === 'top' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}
