'use client'

import type { ReactNode } from 'react'
import { cn } from './cn'

/**
 * El contenedor de toda pantalla.
 *
 * Existe por un hallazgo concreto de la auditoria (H-09): dieciseis pantallas
 * no tenian margen ni ancho maximo, y en un telefono los botones tocaban o
 * superaban el borde. Las demas tenian cada una su propia combinacion de
 * clases. Ahora hay UNA.
 *
 * Cuatro anchos, y no mas:
 *
 *   narrow       formularios y textos: configuracion, comprobantes
 *   default      la mayoria de las pantallas (listas, fichas, caja)
 *   wide         tablas anchas: productos, ventas
 *   full         sin tope: reportes largos
 *   operational  el punto de venta. Sin margen ni tope: la pantalla ES la
 *                herramienta y cada pixel es una linea de ticket
 *
 * El margen sale de los tokens `gutter` y respeta la zona segura del telefono
 * abajo, que es donde una barra de gestos tapa el ultimo boton.
 */
export type PageWidth = 'narrow' | 'default' | 'wide' | 'full' | 'operational'

const ANCHOS: Record<Exclude<PageWidth, 'operational'>, string> = {
  narrow: 'max-w-3xl',
  default: 'max-w-6xl',
  wide: 'max-w-7xl',
  full: 'max-w-none',
}

export function PageContainer({
  width = 'default',
  as: Tag = 'div',
  className,
  children,
}: {
  width?: PageWidth
  as?: 'div' | 'section' | 'article'
  className?: string
  children: ReactNode
}) {
  if (width === 'operational') {
    return <Tag className={cn('flex h-full min-h-0 w-full', className)}>{children}</Tag>
  }
  return (
    <Tag
      className={cn(
        'mx-auto flex w-full flex-col gap-4 p-gutter sm:p-gutter-lg pb-safe',
        ANCHOS[width],
        className,
      )}
    >
      {children}
    </Tag>
  )
}
