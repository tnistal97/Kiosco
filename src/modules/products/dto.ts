/**
 * Forma de los productos y categorias tal como viajan por la API.
 *
 * Los `parse*` toman `unknown` y devuelven un tipo concreto. Ahi termina el
 * `any` que introduce `res.json()`: a partir de este punto el compilador
 * vuelve a saber que hay.
 */

import { esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { montoODefecto, type Monto } from '@/lib/money'
import { estadoDeStock, type EstadoStock } from '@/modules/inventory/minimum'

export interface CategoriaDTO {
  id: number
  name: string
}

export interface ProveedorDTO {
  id: number
  name: string
}

export interface ProductoDTO {
  id: number
  name: string
  barcode: string | null
  description: string | null
  price: Monto
  /** Un producto dado de baja no aparece en la caja. */
  isActive: boolean
  category: CategoriaDTO
  supplier: ProveedorDTO | null
  totalStock: number
  /** Unidades por debajo de las cuales hay que reponer. Cero: sin configurar. */
  minimumStock: number
  /** OK | LOW | OUT. Lo calcula el servidor; si no viene, se calcula aca. */
  estado: EstadoStock
}

const CATEGORIA_VACIA: CategoriaDTO = { id: 0, name: 'Sin categoria' }

export function parseCategoria(raw: unknown): CategoriaDTO {
  if (!esObjeto(raw)) return CATEGORIA_VACIA
  return { id: numero(raw.id), name: texto(raw.name, 'Sin categoria') }
}

export function parseCategorias(raw: unknown): CategoriaDTO[] {
  return lista(raw, parseCategoria)
}

/** Estado que llego del servidor, si es uno de los tres que existen. */
function parseEstado(raw: unknown): EstadoStock | null {
  return raw === 'OK' || raw === 'LOW' || raw === 'OUT' ? raw : null
}

export function parseProducto(raw: unknown): ProductoDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un producto')
  }
  const totalStock = numero(raw.totalStock)
  const minimumStock = numero(raw.minimumStock)

  return {
    id: numero(raw.id),
    name: texto(raw.name),
    barcode: textoOpcional(raw.barcode),
    description: textoOpcional(raw.description),
    price: montoODefecto(raw.price),
    // Sin el campo se asume activo: es como se comportaba el catalogo antes
    // de que existiera la baja logica.
    isActive: raw.isActive !== false,
    category: parseCategoria(raw.category),
    supplier: esObjeto(raw.supplier)
      ? { id: numero(raw.supplier.id), name: texto(raw.supplier.name) }
      : null,
    totalStock,
    minimumStock,
    // El servidor lo manda calculado. Si no viene --una respuesta vieja
    // cacheada, un endpoint que todavia no lo incluye-- se calcula aca con la
    // MISMA funcion, no con una copia de la regla.
    estado: parseEstado(raw.estado) ?? estadoDeStock(totalStock, minimumStock),
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
