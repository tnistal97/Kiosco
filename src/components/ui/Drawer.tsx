'use client'

import { Dialog as HDialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { useEffect, type ReactNode } from 'react'
import { cn } from './cn'
import { IconButton } from './Button'
import { useOverlays } from '@/store/overlays'

/**
 * Cajon lateral, u hoja inferior.
 *
 * Para la navegacion en movil, para el ticket cuando no hay ancho para
 * dejarlo fijo, y para todo lo que en un telefono conviene que suba desde
 * abajo, al alcance del pulgar. Misma base accesible que `Dialog` --foco
 * atrapado, Escape, foco devuelto-- y el mismo registro en `useOverlays`,
 * para que el escaner no siga escuchando mientras esta abierto.
 *
 * `side="bottom"` es la hoja: ocupa el ancho entero, deja ver lo que hay
 * detras y lleva un tirador arriba. El pie, si hay, queda fijo.
 */
export function Drawer({
  open,
  onClose,
  title,
  side = 'left',
  children,
  footer,
  rapido = false,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  side?: 'left' | 'right' | 'bottom'
  children: ReactNode
  footer?: ReactNode
  /**
   * Sale sin transicion.
   *
   * Para el ticket de la caja: cerrarlo es volver a vender, y esos 200 ms
   * son 200 ms sin poder tocar un producto. Sigue entrando desde abajo,
   * que es lo que explica de donde salio.
   */
  rapido?: boolean
  className?: string
}) {
  const registrar = useOverlays((s) => s.registrar)

  useEffect(() => {
    if (!open) return
    return registrar()
  }, [open, registrar])

  const hoja = side === 'bottom'

  return (
    <HDialog open={open} onClose={onClose} className="relative z-50">
      <DialogBackdrop
        transition={!rapido}
        className={cn(
          'fixed inset-0 bg-scrim',
          rapido ? 'animate-aparecer' : 'transition-opacity duration-150 data-[closed]:opacity-0',
        )}
      />

      <div
        className={cn(
          'fixed flex',
          hoja && 'inset-x-0 bottom-0 justify-center',
          side === 'left' && 'inset-y-0 left-0 max-w-full',
          side === 'right' && 'inset-y-0 right-0 max-w-full',
        )}
      >
        <DialogPanel
          transition={!rapido}
          className={cn(
            'flex flex-col border-line bg-surface shadow-modal',
            rapido ? 'animate-aparecer' : 'transition duration-200 ease-out',
            hoja
              ? 'max-h-[88dvh] w-full rounded-t-xl border-t data-[closed]:translate-y-full'
              : 'w-[86vw] max-w-sm',
            side === 'left' && 'border-r data-[closed]:-translate-x-full',
            side === 'right' && 'border-l data-[closed]:translate-x-full',
            className,
          )}
        >
          {hoja && (
            <div aria-hidden="true" className="flex shrink-0 justify-center pt-2">
              <span className="h-1.5 w-10 rounded-full bg-line-strong" />
            </div>
          )}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
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

          {footer && <div className="shrink-0 border-t border-line p-4 safe-bottom">{footer}</div>}
        </DialogPanel>
      </div>
    </HDialog>
  )
}
