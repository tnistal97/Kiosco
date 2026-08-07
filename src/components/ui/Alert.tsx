'use client'

import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Avisos dentro de la pagina.
 *
 * Para lo que el usuario tiene que leer antes de seguir: una limitacion
 * conocida, una sesion vencida, un permiso que le falta. Lo efimero va al
 * `toast`; lo que sigue siendo cierto mientras la pantalla este abierta va
 * aca.
 *
 * Cada tono trae su glifo. El color solo refuerza.
 */
export type AlertTone = 'info' | 'success' | 'warning' | 'danger'

const TONOS: Record<AlertTone, { caja: string; icono: string; glifo: string }> = {
  info: { caja: 'border-primary/40 bg-primary-quiet', icono: 'text-primary', glifo: 'i' },
  success: { caja: 'border-success/40 bg-success-quiet', icono: 'text-success', glifo: '✓' },
  warning: { caja: 'border-warning/40 bg-warning-quiet', icono: 'text-warning', glifo: '▲' },
  danger: { caja: 'border-danger/40 bg-danger-quiet', icono: 'text-danger', glifo: '✕' },
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const t = TONOS[tone]

  return (
    <div
      // Solo lo urgente interrumpe al lector de pantalla. Un aviso informativo
      // se lee cuando el usuario llega, no encima de lo que estaba leyendo.
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border px-4 py-3', t.caja, className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
          t.icono,
          'border-current',
        )}
      >
        {t.glifo}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className="font-semibold text-ink">{title}</p>}
        {children && <div className={cn('text-ink-muted', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  )
}
