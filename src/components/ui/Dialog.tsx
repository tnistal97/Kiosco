'use client'

import {
  Dialog as HDialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Description,
} from '@headlessui/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from './cn'
import { Button, type ButtonVariant, IconButton } from './Button'
import { useOverlays } from '@/store/overlays'

/**
 * Dialogos.
 *
 * Sobre las primitivas de Headless UI, que ya traen lo que cuesta hacer bien:
 * foco atrapado, foco devuelto al cerrar, `aria-modal`, Escape, e inerte todo
 * lo de atras.
 *
 * Lo que agrega este componente es el aspecto y una cosa que no es cosmetica:
 * mientras esta abierto se registra en `useOverlays`, para que el escaner de
 * codigo de barras deje de escuchar el teclado.
 *
 * No se usan dialogos para todo. Un dialogo interrumpe: se reserva para
 * confirmar algo irreversible, para cobrar y para formularios que no entran
 * en la pantalla.
 */

export type DialogSize = 'sm' | 'md' | 'lg' | 'xl'

const ANCHOS: Record<DialogSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
}

export interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: ReactNode
  size?: DialogSize
  /** Pie con las acciones. */
  footer?: ReactNode
  children: ReactNode
  /**
   * Impide cerrar con Escape o clic afuera.
   *
   * Solo para operaciones en curso que no se pueden abandonar a medias, como
   * una venta que ya se envio. Nunca "porque es importante".
   */
  dismissible?: boolean
  /** Elemento que recibe el foco al abrir. Por omision, el primero enfocable. */
  initialFocus?: React.MutableRefObject<HTMLElement | null>
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  children,
  dismissible = true,
  initialFocus,
}: DialogProps) {
  const registrar = useOverlays((s) => s.registrar)

  useEffect(() => {
    if (!open) return
    return registrar()
  }, [open, registrar])

  return (
    <HDialog
      open={open}
      onClose={dismissible ? onClose : () => undefined}
      initialFocus={initialFocus}
      className="relative z-50"
    >
      <DialogBackdrop
        transition
        className={cn(
          'fixed inset-0 bg-overlay/80 backdrop-blur-[2px]',
          'transition-opacity duration-150 data-[closed]:opacity-0',
        )}
      />

      {/* El contenedor scrollea, no el dialogo: asi un formulario largo no se
          corta ni supera la altura de la ventana. */}
      <div className="fixed inset-0 flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6">
        <DialogPanel
          transition
          className={cn(
            'w-full rounded-t-xl border border-line bg-surface shadow-modal sm:rounded-xl',
            'max-h-[92dvh] overflow-y-auto',
            'transition duration-150 data-[closed]:translate-y-3 data-[closed]:opacity-0',
            ANCHOS[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <DialogTitle className="text-lg font-semibold text-ink">{title}</DialogTitle>
              {description && (
                <Description className="mt-1 text-sm text-ink-muted">{description}</Description>
              )}
            </div>
            {dismissible && (
              <IconButton label="Cerrar" size="sm" onClick={onClose} className="-mr-1.5 -mt-1">
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
            )}
          </div>

          <div className="px-5 py-4">{children}</div>

          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-line px-5 py-4 sm:flex-row sm:justify-end">
              {footer}
            </div>
          )}
        </DialogPanel>
      </div>
    </HDialog>
  )
}

/**
 * Confirmacion de una accion que no se deshace.
 *
 * Dos cosas deliberadas:
 *
 *  - el boton que destruye NO es el que recibe el foco al abrir. Se enfoca
 *    "Cancelar", asi que un Enter reflejo no borra nada;
 *  - mientras la accion corre, los dos botones quedan bloqueados. Es la
 *    proteccion contra el doble envio, y esta aca y no en cada pantalla.
 */
export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  variant = 'danger',
  children,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => Promise<void> | void
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  variant?: ButtonVariant
  /** Campos extra, p. ej. el motivo obligatorio de una anulacion. */
  children?: ReactNode
}) {
  const [enCurso, setEnCurso] = useState(false)
  const cancelar = useRef<HTMLElement | null>(null)

  async function confirmar() {
    if (enCurso) return
    setEnCurso(true)
    try {
      await onConfirm()
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={enCurso ? () => undefined : onClose}
      title={title}
      size="sm"
      dismissible={!enCurso}
      initialFocus={cancelar}
      footer={
        <>
          <Button
            ref={cancelar as React.RefObject<HTMLButtonElement>}
            variant="secondary"
            onClick={onClose}
            disabled={enCurso}
          >
            {cancelLabel}
          </Button>
          <Button variant={variant} loading={enCurso} onClick={() => void confirmar()}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="text-sm text-ink-muted">{message}</div>
        {children}
      </div>
    </Dialog>
  )
}
