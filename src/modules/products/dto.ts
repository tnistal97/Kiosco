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

export function parseProductos(raw: unknown): ProductoDTO[] {
  return lista(raw, parseProducto)
}
