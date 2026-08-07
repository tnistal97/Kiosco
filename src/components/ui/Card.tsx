'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * Paneles.
 *
 * Se separan del fondo por color, no por borde grueso ni por sombra. Una
 * pantalla con doce recuadros marcados cansa; una con doce superficies
 * apenas mas claras se lee sola.
 */
export function Card({
  children,
  className,
  padded = true,
  as: Tag = 'section',
}: {
  children: ReactNode
  className?: string
  padded?: boolean
  as?: 'section' | 'div' | 'article' | 'aside'
}) {
  return (
    <Tag
      className={cn(
        // `min-w-0`: dentro de un contenedor flex el ancho minimo por omision
        // es el del contenido. Una tarjeta con una tabla ancha adentro crecia
        // hasta el ancho de la tabla y arrastraba la PAGINA al costado, aunque
        // la tabla ya tuviera su propio `overflow-x-auto`. Lo detecto la
        // prueba de /usuarios a 375 px, con la matriz de permisos.
        'min-w-0 rounded-lg border border-line bg-surface',
        padded && 'p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </Tag>
  )
}

export function CardHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

/**
 * Tarjeta de metrica del panel de inicio.
 *
 * Si trae `href`, la tarjeta entera es un enlace: el requisito es que cada
 * tarjeta abra la pantalla correspondiente, no que tenga un enlace adentro.
 */
export function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  icon,
  href,
  className,
}: {
  label: string
  value: ReactNode
  detail?: ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
  icon?: ReactNode
  href?: string
  className?: string
}) {
  const acento = {
    neutral: 'text-ink-muted',
    success: 'text-success',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone]

  const cuerpo = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-ink-muted">{label}</span>
        {icon && <span className={cn('shrink-0', acento)}>{icon}</span>}
      </div>
      <div className="mt-2 text-2xl font-semibold text-ink">{value}</div>
      {detail && <div className={cn('mt-1 text-sm', acento)}>{detail}</div>}
    </>
  )

  const clases = cn(
    'block rounded-lg border border-line bg-surface p-4 text-left transition-colors',
    href && 'hover:border-line-strong hover:bg-raised',
    className,
  )

  if (href) {
    return (
      <Link href={href} className={clases}>
        {cuerpo}
      </Link>
    )
  }
  return <div className={clases}>{cuerpo}</div>
}
