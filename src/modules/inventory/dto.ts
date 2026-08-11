/**
 * Movimientos de stock tal como viajan por la API.
 *
 * Se parsean campo por campo en vez de confiar en la forma de la respuesta: la
 * pantalla tiene que seguir dibujandose aunque el servidor cambie algo, y una
 * fila incompleta es mejor que una pantalla en blanco.
 */

import { esObjeto, lista, numero, numeroOpcional, texto, textoOpcional } from '@/lib/api-client'
import type { Pagination } from '@/server/http/pagination'
import { cantidadODefecto, type TextoCantidad } from '@/lib/cantidad'
import { unidadDeVentaODefecto, type UnidadDeVenta } from '@/modules/products/units'
import { etiquetaDeTipo } from './movement-types'

export interface MovimientoDTO {
  id: number
  createdAt: string
  type: string
  /** Nombre para mostrar. El codigo crudo no llega a la pantalla. */
  typeLabel: string
  /**
   * Delta con signo: negativo sale, positivo entra. CADENA decimal.
   *
   * Desde la Fase 3B viaja como `"-0.750"` y no como numero. Parsearlo con
   * `numero()` --que devuelve el valor por omision cuando no recibe un
   * numero-- hacia que la pantalla mostrara "0" en cada movimiento
   * fraccionado. Lo encontro la prueba de extremo a extremo del ajuste por
   * rotura.
   */
  quantity: TextoCantidad
  previousQuantity: TextoCantidad
  resultingQuantity: TextoCantidad
  referenceType: string | null
  referenceId: number | null
  reason: string | null
  /** Con su unidad: sin ella, un `-0,750` no dice si son kilos o unidades. */
  product: { id: number; name: string; barcode: string | null; saleUnit: UnidadDeVenta }
  user: { id: number; name: string }
  branch: { id: number; name: string }
  /**
   * De que partida movio. Fase 4D.
   *
   * `null` es la respuesta correcta en dos casos y no un dato faltante: un
   * producto sin rastreo, y uno con rastreo opcional cuyo movimiento salio del
   * stock no atribuido. La pantalla los muestra igual --"—"-- porque en los dos
   * la respuesta a "de que partida" es "de ninguna".
   */
  lotId: number | null
  lotCode: string | null
  lotExpirationDate: string | null
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
    quantity: cantidadODefecto(raw.quantity),
    previousQuantity: cantidadODefecto(raw.previousQuantity),
    resultingQuantity: cantidadODefecto(raw.resultingQuantity),
    referenceType: textoOpcional(raw.referenceType),
    referenceId: numeroOpcional(raw.referenceId),
    reason: textoOpcional(raw.reason),
    product: esObjeto(raw.product)
      ? {
          id: numero(raw.product.id),
          name: texto(raw.product.name, 'Producto'),
          barcode: textoOpcional(raw.product.barcode),
          saleUnit: unidadDeVentaODefecto(raw.product.saleUnit),
        }
      : { id: 0, name: 'Producto', barcode: null, saleUnit: 'UNIT' },
    user: esObjeto(raw.user)
      ? { id: numero(raw.user.id), name: texto(raw.user.name, 'Desconocido') }
      : { id: 0, name: 'Desconocido' },
    branch: esObjeto(raw.branch)
      ? { id: numero(raw.branch.id), name: texto(raw.branch.name, 'Sucursal') }
      : { id: 0, name: 'Sucursal' },
    lotId: numeroOpcional(raw.lotId),
    lotCode: textoOpcional(raw.lotCode),
    lotExpirationDate: textoOpcional(raw.lotExpirationDate),
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
