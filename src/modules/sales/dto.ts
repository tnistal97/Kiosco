/**
 * Ventas tal como viajan por la API.
 */

import { esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'

export type EstadoVenta = 'completed' | 'canceled'

export interface ItemVentaDTO {
  id: number
  quantity: number
  price: number
  product: { id: number; name: string }
}

export interface VentaDTO {
  id: number
  date: string
  status: EstadoVenta
  total: number
  paymentMethod: string | null
  canceledAt: string | null
  cancelReason: string | null
  user: { id: number; name: string }
  canceledBy: { id: number; name: string } | null
  items: ItemVentaDTO[]
}

function parsePersona(raw: unknown): { id: number; name: string } {
  if (!esObjeto(raw)) return { id: 0, name: 'Desconocido' }
  return { id: numero(raw.id), name: texto(raw.name, 'Desconocido') }
}

function parsePersonaOpcional(raw: unknown): { id: number; name: string } | null {
  return esObjeto(raw) ? parsePersona(raw) : null
}

export function parseItemVenta(raw: unknown): ItemVentaDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un item de venta')
  }
  return {
    id: numero(raw.id),
    quantity: numero(raw.quantity),
    price: numero(raw.price),
    product: parsePersona(raw.product),
  }
}

/** Cualquier estado desconocido se trata como completada, que es lo neutro. */
function parseEstado(raw: unknown): EstadoVenta {
  return texto(raw) === 'canceled' ? 'canceled' : 'completed'
}

export function parseVenta(raw: unknown): VentaDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de una venta')
  }
  const items = lista(raw.items, parseItemVenta)
  return {
    id: numero(raw.id),
    date: texto(raw.date),
    status: parseEstado(raw.status),
    // El servidor ya manda el total calculado; si faltara se recalcula aca
    // con los mismos items, nunca con un valor que haya puesto el navegador.
    total:
      typeof raw.total === 'number'
        ? numero(raw.total)
        : items.reduce((suma, i) => suma + i.price * i.quantity, 0),
    paymentMethod: textoOpcional(raw.paymentMethod),
    canceledAt: textoOpcional(raw.canceledAt),
    cancelReason: textoOpcional(raw.cancelReason),
    user: parsePersona(raw.user),
    canceledBy: parsePersonaOpcional(raw.canceledBy),
    items,
  }
}

export function parseVentas(raw: unknown): VentaDTO[] {
  if (esObjeto(raw) && 'sales' in raw) return lista(raw.sales, parseVenta)
  return lista(raw, parseVenta)
}
