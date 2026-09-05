'use client'

import { StatusBadge, type BadgeTone } from './Badge'
import { TONO_DE_ESTADO, etiquetaDeEstado as etiquetaDeCompra } from '@/modules/purchases/status'
import { TONO_DE_DEVOLUCION, etiquetaDeEstadoDeDevolucion } from '@/modules/purchases/return-status'
import {
  etiquetaDeEstado as etiquetaDeInventario,
  tonoDeEstado as tonoDeInventario,
} from '@/modules/inventory-counts/estados'
import { etiquetaDeEstadoDeDeuda, type EstadoDeDeuda } from '@/modules/suppliers/movement-types'

/**
 * El estado de algo, con su palabra, su tono y su glifo. Un solo lugar.
 *
 * Cada modulo ya sabe como se llama cada estado (`etiquetaDeEstado`) y que
 * tono le toca; lo que faltaba era que las pantallas no lo armaran cada una
 * a su manera --unas con `Badge`, otras con texto suelto, otras con el codigo
 * crudo--. Esto lo cierra: la pantalla dice de que dominio es el estado y
 * nada mas.
 *
 * Nunca solo color: el glifo sobrevive a una impresion en blanco y negro.
 */
export type DominioDeEstado = 'compra' | 'devolucion' | 'inventario' | 'venta' | 'deuda'

const GLIFO: Record<BadgeTone, string> = {
  success: '✓',
  danger: '✕',
  warning: '▲',
  primary: '●',
  neutral: '○',
}

const TONO_DE_DEUDA: Record<EstadoDeDeuda, BadgeTone> = {
  PENDIENTE: 'primary',
  PARCIAL: 'warning',
  VENCIDA: 'danger',
  PAGADA: 'success',
}

function tonoDe<T extends string>(tabla: Record<T, BadgeTone>, estado: string): BadgeTone {
  const tono: BadgeTone | undefined = (tabla as Record<string, BadgeTone | undefined>)[estado]
  return tono ?? 'neutral'
}

export function describirEstado(
  dominio: DominioDeEstado,
  estado: string,
): { etiqueta: string; tono: BadgeTone } {
  switch (dominio) {
    case 'compra':
      return { etiqueta: etiquetaDeCompra(estado), tono: tonoDe(TONO_DE_ESTADO, estado) }
    case 'devolucion':
      return {
        etiqueta: etiquetaDeEstadoDeDevolucion(estado),
        tono: tonoDe(TONO_DE_DEVOLUCION, estado),
      }
    case 'inventario':
      return { etiqueta: etiquetaDeInventario(estado), tono: tonoDeInventario(estado) }
    case 'venta':
      return estado === 'canceled'
        ? { etiqueta: 'Anulada', tono: 'danger' }
        : { etiqueta: 'Vigente', tono: 'success' }
    case 'deuda': {
      const tono = tonoDe(TONO_DE_DEUDA, estado)
      const etiqueta =
        tono === 'neutral' ? estado : etiquetaDeEstadoDeDeuda(estado as EstadoDeDeuda)
      return { etiqueta, tono }
    }
  }
}

export function EstadoBadge({
  dominio,
  estado,
  className,
}: {
  dominio: DominioDeEstado
  estado: string
  className?: string
}) {
  const d = describirEstado(dominio, estado)
  return (
    <StatusBadge tone={d.tono} glyph={GLIFO[d.tono]} className={className}>
      {d.etiqueta}
    </StatusBadge>
  )
}
