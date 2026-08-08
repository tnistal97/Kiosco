/**
 * Proveedores tal como viajan por la API.
 *
 * Se parsean campo por campo en vez de confiar en la forma de la respuesta: la
 * pantalla tiene que seguir dibujandose aunque el servidor cambie algo, y una
 * fila incompleta es mejor que una pantalla en blanco.
 */

import { booleano, esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { montoOpcional, type Monto } from '@/lib/money'
import type { Pagination } from '@/server/http/pagination'

export interface ProveedorDTO {
  id: number
  name: string
  legalName: string | null
  taxId: string | null
  phone: string | null
  email: string | null
  address: string | null
  contactName: string | null
  notes: string | null
  isActive: boolean
  productos: number
  ordenes: number
  ultimaCompra: string | null
}

export interface PaginaProveedores {
  data: ProveedorDTO[]
  pagination: Pagination
}

export function parseProveedor(raw: unknown): ProveedorDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un proveedor')
  return {
    id: numero(raw.id),
    name: texto(raw.name),
    legalName: textoOpcional(raw.legalName),
    taxId: textoOpcional(raw.taxId),
    phone: textoOpcional(raw.phone),
    email: textoOpcional(raw.email),
    address: textoOpcional(raw.address),
    contactName: textoOpcional(raw.contactName),
    notes: textoOpcional(raw.notes),
    isActive: booleano(raw.isActive, true),
    productos: numero(raw.productos),
    ordenes: numero(raw.ordenes),
    ultimaCompra: textoOpcional(raw.ultimaCompra),
  }
}

export function parsePaginaProveedores(raw: unknown): PaginaProveedores {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  const p = esObjeto(raw.pagination) ? raw.pagination : {}
  return {
    data: lista(raw.data, parseProveedor),
    pagination: {
      page: numero(p.page, 1),
      pageSize: numero(p.pageSize, 25),
      total: numero(p.total),
      totalPages: numero(p.totalPages, 1),
    },
  }
}

export interface ProductoDeProveedorDTO {
  productId: number
  name: string
  supplierCode: string | null
  isPreferred: boolean
  /**
   * Solo si quien mira tiene `products.cost.view`. `undefined` significa "no
   * lo puedo ver"; `null`, "no hay costo cargado". Son dos cosas distintas y
   * la pantalla las dice distinto.
   */
  lastCost?: Monto | null
}

export interface CompraDeProveedorDTO {
  id: number
  number: string
  status: string
  createdAt: string
  expectedTotal?: Monto | null
}

export interface DetalleProveedorDTO extends ProveedorDTO {
  productos_lista: ProductoDeProveedorDTO[]
  compras: CompraDeProveedorDTO[]
}

export function parseDetalleProveedor(raw: unknown): DetalleProveedorDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un proveedor')

  const productos = lista(raw.productos, (p) => {
    if (!esObjeto(p)) throw new Error('Producto invalido')
    return {
      productId: numero(p.productId),
      name: texto(p.name),
      supplierCode: textoOpcional(p.supplierCode),
      isPreferred: booleano(p.isPreferred),
      // La clave ausente se conserva ausente: `'lastCost' in p` distingue
      // "no lo puedo ver" de "no hay costo".
      ...('lastCost' in p ? { lastCost: montoOpcional(p.lastCost) } : {}),
    }
  })

  return {
    ...parseProveedor(raw),
    // `productos` en la respuesta es la lista; el conteo viene aparte solo en
    // el listado. En el detalle se deriva de la lista.
    productos: productos.length,
    productos_lista: productos,
    compras: lista(raw.compras, (c) => {
      if (!esObjeto(c)) throw new Error('Compra invalida')
      return {
        id: numero(c.id),
        number: texto(c.number),
        status: texto(c.status),
        createdAt: texto(c.createdAt),
        ...('expectedTotal' in c ? { expectedTotal: montoOpcional(c.expectedTotal) } : {}),
      }
    }),
  }
}
