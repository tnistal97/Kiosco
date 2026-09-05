'use client'

import { cn } from './cn'
import type { TextoCantidad } from '@/lib/cantidad'
import {
  formatearCantidadDeCompra,
  formatearCantidadDeCompraConUnidad,
  formatearNumeroDeCantidad,
  type UnidadDeCompra,
  type UnidadDeVenta,
} from '@/modules/products/units'

/**
 * Cantidades.
 *
 * Un unico formato en todo el sistema, hermano de `Money`. La regla, con la
 * unidad como unica fuente de decimales:
 *
 *   UNIT, G, ML     `30`            nunca `30.000`
 *   KG, L           `1,250 kg`      coma decimal, tres cifras
 *   PACK, BOX       `2 cajas`       enteros, con plural
 *   sin unidad      `7` / `0,425`   totales que mezclan productos
 *
 * Coma para decimales y punto para miles, como se lee en es-AR. Un `30.000`
 * en una pantalla de deposito se leia como treinta mil (auditoria, H-02).
 *
 * `value` es una CADENA decimal --`"30.000"`--, no un numero: viaja asi desde
 * el servidor y no pasa por `Number`. Ver docs/PHASE3_QUANTITY_MIGRATION.md.
 */
export type UnidadDeCantidad = UnidadDeVenta | UnidadDeCompra

/** Formatea sin JSX. Para textos, atributos y mensajes. */
export function formatQuantity(
  value: TextoCantidad,
  unit?: UnidadDeCantidad | null,
  showUnit = true,
): string {
  try {
    if (unit === undefined || unit === null) return formatearNumeroDeCantidad(value)
    return showUnit
      ? formatearCantidadDeCompraConUnidad(value, unit)
      : formatearCantidadDeCompra(value, unit)
  } catch {
    // Algo que no es una cantidad --un texto viejo, una respuesta rota--. Se
    // muestra tal cual antes que romper la pantalla entera por un renglon.
    return value
  }
}

export interface QuantityTextProps {
  value: TextoCantidad
  /** Sin unidad, o `null`: solo el numero, para totales de productos mezclados. */
  unit?: UnidadDeCantidad | null
  /** Con `false` va el numero solo aunque haya unidad (tablas con la unidad en el encabezado). */
  showUnit?: boolean
  className?: string
}

export function QuantityText({ value, unit, showUnit = true, className }: QuantityTextProps) {
  return (
    <span data-numeric="" className={cn('whitespace-nowrap', className)}>
      {formatQuantity(value, unit, showUnit)}
    </span>
  )
}
