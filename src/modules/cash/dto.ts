/**
 * Movimientos de caja, saldo y arqueo tal como viajan por la API.
 */

import { esObjeto, lista, numero, texto, textoOpcional, numeroOpcional } from '@/lib/api-client'

export type MetodoPago = 'efectivo' | 'tarjeta' | 'mercado_pago' | 'transferencia'

export interface ItemMovimientoDTO {
  id: number
  quantity: number
  price: number
  product: { id: number; name: string }
}

export interface MovimientoDTO {
  id: number
  amount: number
  paymentMethod: string
  /** 'sale' | 'sale_cancel' | 'manual' | 'withdrawal' | 'deposit' */
  type: string
  description: string | null
  date: string
  /** Venta asociada, cuando el movimiento nace de una. */
  saleId: number | null
  /** 'completed' | 'canceled', o null si el movimiento no viene de una venta. */
  saleStatus: string | null
  /** Detalle de lo vendido. null en movimientos manuales. */
  saleItems: ItemMovimientoDTO[] | null
  user: { id: number; name: string }
}

export interface SaldoDTO {
  balance: number
  efectivoHoy: number
}

export interface ArqueoDTO {
  id: number
  amount: number
  expected: number
  difference: number
  date: string
  notes: string | null
  user: { id: number; name: string }
}

const USUARIO_DESCONOCIDO = { id: 0, name: 'Desconocido' }

function parseUsuario(raw: unknown): { id: number; name: string } {
  if (!esObjeto(raw)) return USUARIO_DESCONOCIDO
  return { id: numero(raw.id), name: texto(raw.name, 'Desconocido') }
}

function parseItemMovimiento(raw: unknown): ItemMovimientoDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un item de venta')
  }
  return {
    id: numero(raw.id),
    quantity: numero(raw.quantity),
    price: numero(raw.price),
    product: parseUsuario(raw.product),
  }
}

export function parseMovimiento(raw: unknown): MovimientoDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un movimiento de caja')
  }
  return {
    id: numero(raw.id),
    amount: numero(raw.amount),
    paymentMethod: texto(raw.paymentMethod, 'efectivo'),
    type: texto(raw.type, 'manual'),
    description: textoOpcional(raw.description),
    date: texto(raw.date),
    saleId: numeroOpcional(raw.saleId),
    saleStatus: textoOpcional(raw.saleStatus),
    saleItems: Array.isArray(raw.saleItems) ? raw.saleItems.map(parseItemMovimiento) : null,
    user: parseUsuario(raw.user),
  }
}

/**
 * Acepta tanto `{ data, pagination }` como un array pelado.
 *
 * `/api/cash` pagina desde la Fase 1. Se conserva el segundo caso porque
 * otros listados todavia no lo hacen y este parser se comparte.
 */
export function parseMovimientos(raw: unknown): MovimientoDTO[] {
  if (esObjeto(raw) && 'data' in raw) return lista(raw.data, parseMovimiento)
  return lista(raw, parseMovimiento)
}

export function parseSaldo(raw: unknown): SaldoDTO {
  if (!esObjeto(raw)) return { balance: 0, efectivoHoy: 0 }
  return { balance: numero(raw.balance), efectivoHoy: numero(raw.efectivoHoy) }
}

export function parseArqueo(raw: unknown): ArqueoDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un arqueo')
  }
  return {
    id: numero(raw.id),
    amount: numero(raw.amount),
    expected: numero(raw.expected),
    difference: numero(raw.difference),
    date: texto(raw.date),
    notes: textoOpcional(raw.notes),
    user: parseUsuario(raw.user),
  }
}

export function parseArqueos(raw: unknown): ArqueoDTO[] {
  if (esObjeto(raw) && 'data' in raw) return lista(raw.data, parseArqueo)
  return lista(raw, parseArqueo)
}
