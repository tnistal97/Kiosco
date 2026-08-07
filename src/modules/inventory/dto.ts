/**
 * Movimientos de stock tal como viajan por la API.
 *
 * Se parsean campo por campo en vez de confiar en la forma de la respuesta: la
 * pantalla tiene que seguir dibujandose aunque el servidor cambie algo, y una
 * fila incompleta es mejor que una pantalla en blanco.
 */

import { esObjeto, lista, numero, numeroOpcional, texto, textoOpcional } from '@/lib/api-client'
import type { Pagination } from '@/server/http/pagination'
import { etiquetaDeTipo } from './movement-types'

export interface MovimientoDTO {
  id: number
  createdAt: string
  type: string
  /** Nombre para mostrar. El codigo crudo no llega a la pantalla. */
  typeLabel: string
  /** Delta con signo: negativo sale, positivo entra. */
  quantity: number
  previousQuantity: number
  resultingQuantity: number
  referenceType: string | null
  referenceId: number | null
  reason: string | null
  product: { id: number; name: string; barcode: string | null }
  user: { id: number; name: string }
  branch: { id: number; name: string }
}

export interface PaginaMovimientos {
  data: MovimientoDTO[]
  pagination: Pagination
}

export function parseMovimiento(raw: unknown): MovimientoDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un movimiento de stock')

  const type = texto(raw.type)

  return {
    id: numero(raw.id),
    createdAt: texto(raw.createdAt),
    type,
    // Si el servidor no mando la etiqueta, se resuelve aca. Un codigo crudo en
    // pantalla es una fila que nadie entiende.
    typeLabel: textoOpcional(raw.typeLabel) ?? etiquetaDeTipo(type),
    quantity: numero(raw.quantity),
    previousQuantity: numero(raw.previousQuantity),
    resultingQuantity: numero(raw.resultingQuantity),
    referenceType: textoOpcional(raw.referenceType),
    referenceId: numeroOpcional(raw.referenceId),
    reason: textoOpcional(raw.reason),
    product: esObjeto(raw.product)
      ? {
          id: numero(raw.product.id),
          name: texto(raw.product.name, 'Producto'),
          barcode: textoOpcional(raw.product.barcode),
        }
      : { id: 0, name: 'Producto', barcode: null },
    user: esObjeto(raw.user)
      ? { id: numero(raw.user.id), name: texto(raw.user.name, 'Desconocido') }
      : { id: 0, name: 'Desconocido' },
    branch: esObjeto(raw.branch)
      ? { id: numero(raw.branch.id), name: texto(raw.branch.name, 'Sucursal') }
      : { id: 0, name: 'Sucursal' },
  }
}

function parsePaginacion(raw: unknown): Pagination {
  if (!esObjeto(raw)) return { page: 1, pageSize: 0, total: 0, totalPages: 1 }
  return {
    page: numero(raw.page, 1),
    pageSize: numero(raw.pageSize),
    total: numero(raw.total),
    totalPages: numero(raw.totalPages, 1),
  }
}

export function parsePaginaMovimientos(raw: unknown): PaginaMovimientos {
  if (!esObjeto(raw)) {
    return { data: [], pagination: { page: 1, pageSize: 0, total: 0, totalPages: 1 } }
  }
  return { data: lista(raw.data, parseMovimiento), pagination: parsePaginacion(raw.pagination) }
}

export interface ReposicionDTO {
  agotados: number
  bajoMinimo: number
  sinMinimo: number
}

export function parseReposicion(raw: unknown): ReposicionDTO {
  if (!esObjeto(raw)) return { agotados: 0, bajoMinimo: 0, sinMinimo: 0 }
  return {
    agotados: numero(raw.agotados),
    bajoMinimo: numero(raw.bajoMinimo),
    sinMinimo: numero(raw.sinMinimo),
  }
}
