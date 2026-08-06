/**
 * Entradas de la bitacora de auditoria tal como viajan por la API.
 */

import { esObjeto, lista, numero, texto } from '@/lib/api-client'
import type { Pagination } from '@/server/http/pagination'

export interface EntradaAuditoriaDTO {
  id: number
  tableName: string
  recordId: number
  actionType: string
  origin: string | null
  timestamp: string
  changes: {
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
  }
  user: { id: number; name: string }
}

export interface PaginaAuditoria {
  data: EntradaAuditoriaDTO[]
  pagination: Pagination
}

function parseSnapshot(raw: unknown): Record<string, unknown> | null {
  return esObjeto(raw) ? raw : null
}

function parseCambios(raw: unknown): EntradaAuditoriaDTO['changes'] {
  if (!esObjeto(raw)) return { before: null, after: null }
  return { before: parseSnapshot(raw.before), after: parseSnapshot(raw.after) }
}

export function parseEntradaAuditoria(raw: unknown): EntradaAuditoriaDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de una entrada de auditoria')
  }
  return {
    id: numero(raw.id),
    tableName: texto(raw.tableName),
    recordId: numero(raw.recordId),
    actionType: texto(raw.actionType),
    origin: typeof raw.origin === 'string' ? raw.origin : null,
    timestamp: texto(raw.timestamp),
    changes: parseCambios(raw.changes),
    user: esObjeto(raw.user)
      ? { id: numero(raw.user.id), name: texto(raw.user.name, 'Desconocido') }
      : { id: 0, name: 'Desconocido' },
  }
}

export function parsePaginacion(raw: unknown): Pagination {
  if (!esObjeto(raw)) return { page: 1, pageSize: 0, total: 0, totalPages: 1 }
  return {
    page: numero(raw.page, 1),
    pageSize: numero(raw.pageSize),
    total: numero(raw.total),
    totalPages: numero(raw.totalPages, 1),
  }
}

/**
 * Linea de venta tal como quedo guardada dentro de un snapshot de auditoria.
 *
 * No es lo mismo que `ItemVentaDTO`: esto es un JSON historico, escrito por
 * la version del codigo que corria ese dia. Puede no tener todos los campos,
 * asi que se lee con valores por defecto en vez de suponer la forma.
 */
export interface ItemSnapshot {
  id: number
  productId: number
  name: string
  quantity: number
  price: number
}

export function parseItemsDeSnapshot(raw: unknown): ItemSnapshot[] {
  return lista(raw, (item): ItemSnapshot => {
    if (!esObjeto(item)) return { id: 0, productId: 0, name: 'Producto', quantity: 0, price: 0 }
    return {
      id: numero(item.id),
      productId: numero(item.productId),
      name: texto(item.name, 'Producto'),
      quantity: numero(item.quantity),
      price: numero(item.price),
    }
  })
}

export function parsePaginaAuditoria(raw: unknown): PaginaAuditoria {
  if (!esObjeto(raw)) {
    return { data: [], pagination: { page: 1, pageSize: 0, total: 0, totalPages: 1 } }
  }
  return {
    data: lista(raw.data, parseEntradaAuditoria),
    pagination: parsePaginacion(raw.pagination),
  }
}
