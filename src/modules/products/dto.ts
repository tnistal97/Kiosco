/**
 * Forma de los productos y categorias tal como viajan por la API.
 *
 * Los `parse*` toman `unknown` y devuelven un tipo concreto. Ahi termina el
 * `any` que introduce `res.json()`: a partir de este punto el compilador
 * vuelve a saber que hay.
 */

import { esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { montoODefecto, montoOpcional, type Monto } from '@/lib/money'
import { cantidadODefecto, type TextoCantidad } from '@/lib/cantidad'
import { estadoDeStock, type EstadoStock } from '@/modules/inventory/minimum'
import {
  unidadDeCompraODefecto,
  unidadDeVentaODefecto,
  type UnidadDeCompra,
  type UnidadDeVenta,
} from './units'
import { calcularRentabilidad, type Rentabilidad } from './margen'

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
  /** El codigo PRINCIPAL. Los alternativos solo vienen en el detalle. */
  barcode: string | null
  description: string | null
  price: Monto
  /** Un producto dado de baja no aparece en la caja. */
  isActive: boolean
  category: CategoriaDTO
  supplier: ProveedorDTO | null
  saleUnit: UnidadDeVenta
  purchaseUnit: UnidadDeCompra
  unitsPerPurchaseUnit: TextoCantidad
  totalStock: TextoCantidad
  /**
   * Lo que el cobro va a dejar vender: el total menos lo vencido.
   *
   * Es AYUDA, no autoridad: el servidor lo vuelve a calcular al cobrar, con los
   * lotes bloqueados. Sirve para no dejar armar un ticket que se va a rechazar.
   * Sin lotes vencidos es igual a `totalStock`.
   */
  sellableStock: TextoCantidad
  /** Lo que hay y no se puede vender por estar vencido. Cero en casi todo. */
  expiredStock: TextoCantidad
  /** Cantidad por debajo de la cual hay que reponer. Cero: sin configurar. */
  minimumStock: TextoCantidad
  /** OK | LOW | OUT. Lo calcula el servidor; si no viene, se calcula aca. */
  estado: EstadoStock
  /**
   * Costo de compra. `undefined` cuando la sesion no tiene
   * `products.cost.view`: el servidor NO manda la clave, y aca no se inventa.
   *
   * `undefined` y `null` significan cosas distintas y la diferencia importa:
   * `undefined` es "no te lo puedo mostrar", `null` es "no hay costo cargado".
   */
  cost?: Monto | null
  rentabilidad?: Rentabilidad
}

export interface ProductoDetalladoDTO extends ProductoDTO {
  alternateBarcodes: string[]
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
  const totalStock = cantidadODefecto(raw.totalStock)
  const minimumStock = cantidadODefecto(raw.minimumStock)
  const price = montoODefecto(raw.price)
  // Sin la clave --una respuesta vieja del cache, un endpoint que todavia no la
  // manda-- lo vendible es el total y lo vencido cero. Es la respuesta correcta
  // para el catalogo sin lotes, que es donde puede haber respuestas viejas.
  const sellableStock = cantidadODefecto(raw.sellableStock, totalStock)
  const expiredStock = cantidadODefecto(raw.expiredStock, '0.000')

  const producto: ProductoDTO = {
    id: numero(raw.id),
    name: texto(raw.name),
    barcode: textoOpcional(raw.barcode),
    description: textoOpcional(raw.description),
    price,
    // Sin el campo se asume activo: es como se comportaba el catalogo antes
    // de que existiera la baja logica.
    isActive: raw.isActive !== false,
    category: parseCategoria(raw.category),
    supplier: esObjeto(raw.supplier)
      ? { id: numero(raw.supplier.id), name: texto(raw.supplier.name) }
      : null,
    saleUnit: unidadDeVentaODefecto(raw.saleUnit),
    purchaseUnit: unidadDeCompraODefecto(raw.purchaseUnit),
    unitsPerPurchaseUnit: cantidadODefecto(raw.unitsPerPurchaseUnit, '1.000'),
    totalStock,
    sellableStock,
    expiredStock,
    minimumStock,
    // El servidor lo manda calculado. Si no viene --una respuesta vieja
    // cacheada, un endpoint que todavia no lo incluye-- se calcula aca con la
    // MISMA funcion, no con una copia de la regla.
    estado: parseEstado(raw.estado) ?? estadoDeStock(totalStock, minimumStock),
  }

  // La clave `cost` solo existe si el servidor la mando, y solo la manda a
  // quien puede verla. Copiarla como `null` cuando no vino haria imposible
  // distinguir "sin permiso" de "sin costo cargado".
  if ('cost' in raw) {
    const cost = montoOpcional(raw.cost)
    producto.cost = cost
    // El servidor ya la manda calculada; se recalcula aca si no vino, con la
    // misma funcion, para que las dos puntas no puedan discrepar.
    producto.rentabilidad = parseRentabilidad(raw.rentabilidad) ?? calcularRentabilidad(price, cost)
  }

  return producto
}

function parseRentabilidad(raw: unknown): Rentabilidad | null {
  if (!esObjeto(raw)) return null
  return {
    ganancia: montoOpcional(raw.ganancia),
    margen: typeof raw.margen === 'string' ? raw.margen : null,
    markup: typeof raw.markup === 'string' ? raw.markup : null,
    bajoCosto: raw.bajoCosto === true,
  }
}

export function parseProductoDetallado(raw: unknown): ProductoDetalladoDTO {
  const producto = parseProducto(raw)
  const alternativos =
    esObjeto(raw) && Array.isArray(raw.alternateBarcodes)
      ? raw.alternateBarcodes.filter((c): c is string => typeof c === 'string')
      : []
  return { ...producto, alternateBarcodes: alternativos }
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

export interface EventoDeProductoDTO {
  tipo: 'precio' | 'costo' | 'stock'
  fecha: string
  texto: string
  usuario: string
  motivo: string | null
}

export function parseActividad(raw: unknown): EventoDeProductoDTO[] {
  const filas = esObjeto(raw) && 'data' in raw ? raw.data : raw
  if (!Array.isArray(filas)) return []

  return filas.flatMap((fila: unknown): EventoDeProductoDTO[] => {
    if (!esObjeto(fila)) return []
    const tipo = fila.tipo
    if (tipo !== 'precio' && tipo !== 'costo' && tipo !== 'stock') return []
    return [
      {
        tipo,
        fecha: texto(fila.fecha),
        texto: texto(fila.texto),
        usuario: texto(fila.usuario, 'Alguien'),
        motivo: textoOpcional(fila.motivo),
      },
    ]
  })
}
