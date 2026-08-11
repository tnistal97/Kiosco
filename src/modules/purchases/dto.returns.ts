/**
 * Devoluciones tal como viajan por la API.
 *
 * Se parsea campo por campo en vez de confiar en la forma de la respuesta: la
 * pantalla tiene que seguir dibujandose aunque el servidor cambie algo, y una
 * fila incompleta es mejor que una pantalla en blanco.
 */

import { booleano, esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { montoODefecto, type Monto } from '@/lib/money'
import { cantidadODefecto, type TextoCantidad } from '@/lib/cantidad'
import type { Pagination } from '@/server/http/pagination'
import { ESTADOS_DE_DEVOLUCION, type EstadoDeDevolucion } from './return-status'

function estado(valor: unknown): EstadoDeDevolucion {
  const t = typeof valor === 'string' ? valor : ''
  // Un estado desconocido cae en 'DRAFT', que es el mas inocuo de los tres: no
  // promete que la mercaderia salio ni que alguien la descarto.
  return (ESTADOS_DE_DEVOLUCION as readonly string[]).includes(t)
    ? (t as EstadoDeDevolucion)
    : 'DRAFT'
}

function paginacion(raw: unknown): Pagination {
  const p = esObjeto(raw) ? raw : {}
  return {
    page: numero(p.page, 1),
    pageSize: numero(p.pageSize, 25),
    total: numero(p.total),
    totalPages: numero(p.totalPages, 1),
  }
}

// -------------------------------------------------------------- retornables

/** Un renglon de la entrega, con sus DOS topes y su costo original. */
export interface RenglonRetornableDTO {
  receiptItemId: number
  productId: number
  productName: string
  saleUnit: string
  purchaseUnit: string
  unitsPerPurchaseUnit: TextoCantidad
  recibido: TextoCantidad
  devuelto: TextoCantidad
  /** `recibido - devuelto`. El tope historico. */
  disponible: TextoCantidad
  /** Lo que hay hoy en el deposito, en unidad de venta. El otro tope. */
  stockActual: TextoCantidad
  unitCost: string
}

export interface RetornablesDTO {
  receiptId: number
  orderNumber: string
  receivedAt: string
  supplier: { id: number; name: string }
  lineas: RenglonRetornableDTO[]
}

export function parseRetornables(raw: unknown): RetornablesDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  const s = esObjeto(raw.supplier) ? raw.supplier : {}
  return {
    receiptId: numero(raw.receiptId),
    orderNumber: texto(raw.orderNumber, '—'),
    receivedAt: texto(raw.receivedAt),
    supplier: { id: numero(s.id), name: texto(s.name, '—') },
    lineas: lista(raw.lineas, (l) => {
      if (!esObjeto(l)) throw new Error('Renglón inválido')
      return {
        receiptItemId: numero(l.receiptItemId),
        productId: numero(l.productId),
        productName: texto(l.productName, '—'),
        saleUnit: texto(l.saleUnit, 'UNIT'),
        purchaseUnit: texto(l.purchaseUnit, 'UNIT'),
        unitsPerPurchaseUnit: cantidadODefecto(l.unitsPerPurchaseUnit),
        recibido: cantidadODefecto(l.recibido),
        devuelto: cantidadODefecto(l.devuelto),
        disponible: cantidadODefecto(l.disponible),
        stockActual: cantidadODefecto(l.stockActual),
        unitCost: texto(l.unitCost, '0.0000'),
      }
    }),
  }
}

// -------------------------------------------------------------- devolucion

export interface DevolucionDTO {
  id: number
  number: string
  createdAt: string
  confirmedAt: string | null
  status: EstadoDeDevolucion
  statusLabel: string
  supplier: { id: number; name: string }
  receiptId: number
  orderNumber: string
  reason: string
  reasonLabel: string
  total: Monto
  renglones: number
}

export function parseDevolucion(raw: unknown): DevolucionDTO {
  if (!esObjeto(raw)) throw new Error('Devolución inválida')
  const s = esObjeto(raw.supplier) ? raw.supplier : {}
  return {
    id: numero(raw.id),
    number: texto(raw.number, '—'),
    createdAt: texto(raw.createdAt),
    confirmedAt: textoOpcional(raw.confirmedAt),
    status: estado(raw.status),
    statusLabel: texto(raw.statusLabel, typeof raw.status === 'string' ? raw.status : '—'),
    supplier: { id: numero(s.id), name: texto(s.name, '—') },
    receiptId: numero(raw.receiptId),
    orderNumber: texto(raw.orderNumber, '—'),
    reason: texto(raw.reason, 'OTHER'),
    reasonLabel: texto(raw.reasonLabel, '—'),
    total: montoODefecto(raw.total),
    renglones: numero(raw.renglones),
  }
}

export interface PaginaDevoluciones {
  data: DevolucionDTO[]
  pagination: Pagination
}

export function parsePaginaDevoluciones(raw: unknown): PaginaDevoluciones {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  return { data: lista(raw.data, parseDevolucion), pagination: paginacion(raw.pagination) }
}

export interface DevolucionDetalladaDTO extends DevolucionDTO {
  notes: string | null
  cancelReason: string | null
  cancelledAt: string | null
  createdBy: { id: number; name: string }
  confirmedBy: { id: number; name: string } | null
  lineas: Array<{
    productId: number
    productName: string
    saleUnit: string
    quantity: TextoCantidad
    purchaseUnit: string
    stockQuantity: TextoCantidad
    unitCost: string
    amount: Monto
  }>
  puede: { editar: boolean; confirmar: boolean; cancelar: boolean }
}

function persona(raw: unknown): { id: number; name: string } {
  const p = esObjeto(raw) ? raw : {}
  return { id: numero(p.id), name: texto(p.name, '—') }
}

export function parseDevolucionDetallada(raw: unknown): DevolucionDetalladaDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  const puede = esObjeto(raw.puede) ? raw.puede : {}
  return {
    ...parseDevolucion(raw),
    notes: textoOpcional(raw.notes),
    cancelReason: textoOpcional(raw.cancelReason),
    cancelledAt: textoOpcional(raw.cancelledAt),
    createdBy: persona(raw.createdBy),
    confirmedBy: raw.confirmedBy == null ? null : persona(raw.confirmedBy),
    lineas: lista(raw.lineas, (l) => {
      if (!esObjeto(l)) throw new Error('Renglón inválido')
      return {
        productId: numero(l.productId),
        productName: texto(l.productName, '—'),
        saleUnit: texto(l.saleUnit, 'UNIT'),
        quantity: cantidadODefecto(l.quantity),
        purchaseUnit: texto(l.purchaseUnit, 'UNIT'),
        stockQuantity: cantidadODefecto(l.stockQuantity),
        unitCost: texto(l.unitCost, '0.0000'),
        amount: montoODefecto(l.amount),
      }
    }),
    puede: {
      editar: booleano(puede.editar),
      confirmar: booleano(puede.confirmar),
      cancelar: booleano(puede.cancelar),
    },
  }
}

// -------------------------------------------------------------- anticipos

/** Un pago con saldo disponible. La lista de la que se elige para imputar. */
export interface AnticipoDTO {
  paymentId: number
  number: string
  paidAt: string
  method: string
  methodLabel: string
  amount: Monto
  allocatedAmount: Monto
  unallocatedAmount: Monto
  reference: string | null
}

export function parseAnticipo(raw: unknown): AnticipoDTO {
  if (!esObjeto(raw)) throw new Error('Anticipo inválido')
  return {
    paymentId: numero(raw.paymentId),
    number: texto(raw.number, '—'),
    paidAt: texto(raw.paidAt),
    method: texto(raw.method),
    methodLabel: texto(raw.methodLabel, '—'),
    amount: montoODefecto(raw.amount),
    allocatedAmount: montoODefecto(raw.allocatedAmount),
    unallocatedAmount: montoODefecto(raw.unallocatedAmount),
    reference: textoOpcional(raw.reference),
  }
}

export interface PaginaAnticipos {
  data: AnticipoDTO[]
  pagination: Pagination
}

export function parsePaginaAnticipos(raw: unknown): PaginaAnticipos {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  return { data: lista(raw.data, parseAnticipo), pagination: paginacion(raw.pagination) }
}
