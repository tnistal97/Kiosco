'use client'

import { Dialog as HDialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useEffect, type ReactNode } from 'react'
import { cn } from './cn'
import { IconButton } from './Button'
import { useOverlays } from '@/store/overlays'

/**
 * Cajon lateral.
 *
 * Para la navegacion en movil y para el ticket cuando no hay ancho para
 * dejarlo fijo. Misma base accesible que `Dialog` --foco atrapado, Escape,
 * foco devuelto-- y el mismo registro en `useOverlays`, para que el escaner
 * no siga escuchando mientras esta abierto.
 */
export function Drawer({
  open,
  onClose,
  title,
  side = 'left',
  children,
  footer,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  side?: 'left' | 'right'
  children: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const registrar = useOverlays((s) => s.registrar)

  useEffect(() => {
    if (!open) return
    return registrar()
  }, [open, registrar])

  return (
    <HDialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition
        className="fixed inset-0 bg-overlay/80 transition-opacity duration-150 data-[closed]:opacity-0"
      />

      <div
        className={cn('fixed inset-y-0 flex max-w-full', side === 'left' ? 'left-0' : 'right-0')}
      >
        <DialogPanel
          transition
          className={cn(
            'flex w-[86vw] max-w-sm flex-col border-line bg-surface shadow-modal',
            side === 'left' ? 'border-r' : 'border-l',
            'transition duration-200 ease-out',
            side === 'left' ? 'data-[closed]:-translate-x-full' : 'data-[closed]:translate-x-full',
            className,
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <DialogTitle className="text-base font-semibold text-ink">{title}</DialogTitle>
            <IconButton label="Cerrar" size="sm" onClick={onClose} className="-mr-1.5">
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <path d="M6 6 18 18M18 6 6 18" />
              </svg>
            </IconButton>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

          {footer && <div className="border-t border-line p-4">{footer}</div>}
        </DialogPanel>
      </div>
    </HDialog>
  )
}
