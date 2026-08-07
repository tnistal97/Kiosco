'use client'

import toast, { Toaster, type ToastOptions } from 'react-hot-toast'
import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Avisos efimeros.
 *
 * Envuelve `react-hot-toast` para que el aspecto salga de los tokens y no de
 * un objeto de estilos copiado en cada pantalla. Lo que importa aparte del
 * color: el glifo, para que el tipo de aviso no dependa de distinguir verde
 * de rojo.
 *
 * Un toast informa de algo que ya paso. Lo que hay que decidir va a un
 * dialogo, y lo que sigue siendo cierto va a un `Alert` en la pagina.
 */

const BASE =
  'flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-pop max-w-[90vw]'

const COMUN: ToastOptions = { duration: 3200 }

function cuerpo(glifo: string, tono: string, mensaje: ReactNode) {
  return (
    <span className={cn(BASE, tono)}>
      <span aria-hidden="true" className="text-base leading-none">
        {glifo}
      </span>
      <span className="min-w-0 text-ink">{mensaje}</span>
    </span>
  )
}

export const aviso = {
  ok(mensaje: ReactNode, opciones?: ToastOptions) {
    return toast.custom(() => cuerpo('✓', 'border-success/45 bg-success-quiet', mensaje), {
      ...COMUN,
      ...opciones,
    })
  },
  error(mensaje: ReactNode, opciones?: ToastOptions) {
    return toast.custom(() => cuerpo('✕', 'border-danger/45 bg-danger-quiet', mensaje), {
      ...COMUN,
      duration: 5000,
      ...opciones,
    })
  },
  atencion(mensaje: ReactNode, opciones?: ToastOptions) {
    return toast.custom(() => cuerpo('▲', 'border-warning/45 bg-warning-quiet', mensaje), {
      ...COMUN,
      duration: 4200,
      ...opciones,
    })
  },
  info(mensaje: ReactNode, opciones?: ToastOptions) {
    return toast.custom(() => cuerpo('i', 'border-primary/45 bg-primary-quiet', mensaje), {
      ...COMUN,
      ...opciones,
    })
  },
  descartar(id?: string) {
    toast.dismiss(id)
  },
}

/**
 * Contenedor de los avisos.
 *
 * Abajo a la derecha en escritorio: arriba al centro tapaba el buscador de la
 * caja, que es justo donde el usuario esta mirando cuando aparece el aviso.
 * En movil va arriba, donde no compite con el pulgar.
 */
export function ToastViewport() {
  return (
    <Toaster
      position="bottom-right"
      containerClassName="!bottom-4 !right-4 !top-auto max-sm:!top-4 max-sm:!bottom-auto max-sm:!left-4 max-sm:!right-4"
      gutter={8}
      toastOptions={{ className: '!bg-transparent !shadow-none !p-0 !max-w-none' }}
    />
  )
}
