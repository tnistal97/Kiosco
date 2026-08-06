/**
 * Forma de los productos y categorias tal como viajan por la API.
 *
 * Los `parse*` toman `unknown` y devuelven un tipo concreto. Ahi termina el
 * `any` que introduce `res.json()`: a partir de este punto el compilador
 * vuelve a saber que hay.
 */

import { esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'

export interface CategoriaDTO {
  id: number
  name: string
}

export interface ProductoDTO {
  id: number
  name: string
  barcode: string | null
  description: string | null
  price: number
  category: CategoriaDTO
  totalStock: number
}

const CATEGORIA_VACIA: CategoriaDTO = { id: 0, name: 'Sin categoria' }

export function parseCategoria(raw: unknown): CategoriaDTO {
  if (!esObjeto(raw)) return CATEGORIA_VACIA
  return { id: numero(raw.id), name: texto(raw.name, 'Sin categoria') }
}

export function parseCategorias(raw: unknown): CategoriaDTO[] {
  return lista(raw, parseCategoria)
}

export function parseProducto(raw: unknown): ProductoDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un producto')
  }
  return {
    id: numero(raw.id),
    name: texto(raw.name),
    barcode: textoOpcional(raw.barcode),
    description: textoOpcional(raw.description),
    price: numero(raw.price),
    category: parseCategoria(raw.category),
    totalStock: numero(raw.totalStock),
  }
}

/**
 * Acepta tanto `{ data, pagination }` como un array pelado.
 *
 * `/api/products` pagina desde la Fase 1. La forma de array se conserva
 * porque `/api/categories` y otros listados chicos siguen devolviendola.
 */
export function parseProductos(raw: unknown): ProductoDTO[] {
  if (esObjeto(raw) && 'data' in raw) return lista(raw.data, parseProducto)
  return lista(raw, parseProducto)
}

/** Igual que `parseProductos`, pero conservando el total del servidor. */
export function parsePaginaProductos(raw: unknown): {
  data: ProductoDTO[]
  total: number
  totalPages: number
} {
  const data = parseProductos(raw)
  if (esObjeto(raw) && esObjeto(raw.pagination)) {
    return {
      data,
      total: numero(raw.pagination.total, data.length),
      totalPages: numero(raw.pagination.totalPages, 1),
    }
  }
  return { data, total: data.length, totalPages: 1 }
}
