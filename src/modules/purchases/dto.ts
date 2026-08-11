/**
 * Compras tal como viajan por la API.
 *
 * Regla que atraviesa el archivo: **una clave AUSENTE no es lo mismo que una
 * clave en null.** El servidor omite los importes para quien no tiene
 * `products.cost.view`; si el parseo los convirtiera en `null`, la pantalla
 * mostraria "$0,00" o "sin costo" en vez de no mostrar nada, y quien lo mire
 * creeria que la compra no tiene importe.
 */

import { booleano, esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { montoOpcional, type Monto } from '@/lib/money'
import { cantidadODefecto, type TextoCantidad } from '@/lib/cantidad'
import {
  unidadDeCompraODefecto,
  unidadDeVentaODefecto,
  type UnidadDeCompra,
  type UnidadDeVenta,
} from '@/modules/products/units'
import { esEstadoDeCompra, etiquetaDeEstado, type EstadoDeCompra } from './status'
import type { Pagination } from '@/server/http/pagination'

/**
 * Estado valido o `DRAFT`.
 *
 * Se COMPRUEBA en vez de castear. Un `as EstadoDeCompra` haria que el tipo
 * mienta: la pantalla indexa tablas de tonos y de etiquetas con este valor, y
 * un estado inventado por un servidor mas nuevo devolveria `undefined` en un
 * lugar donde el tipo promete que no puede haberlo.
 *
 * `statusLabel` viene del servidor y SI muestra el codigo crudo cuando no lo
 * conoce, asi que la fila sigue diciendo la verdad aunque el tono sea el de
 * un borrador.
 */
function estado(v: unknown): EstadoDeCompra {
  const crudo = texto(v, 'DRAFT')
  return esEstadoDeCompra(crudo) ? crudo : 'DRAFT'
}

export interface OrdenDTO {
  id: number
  number: string
  status: EstadoDeCompra
  statusLabel: string
  supplier: { id: number; name: string }
  createdBy: { id: number; name: string }
  createdAt: string
  orderedAt: string | null
  lineas: number
  lineasCompletas: number
  recepciones: number
  expectedTotal?: Monto | null
}

function persona(raw: unknown): { id: number; name: string } {
  return esObjeto(raw) ? { id: numero(raw.id), name: texto(raw.name) } : { id: 0, name: '—' }
}

export function parseOrden(raw: unknown): OrdenDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de una orden de compra')
  const st = estado(raw.status)
  return {
    id: numero(raw.id),
    number: texto(raw.number),
    status: st,
    statusLabel: texto(raw.statusLabel) || etiquetaDeEstado(st),
    supplier: persona(raw.supplier),
    createdBy: persona(raw.createdBy),
    createdAt: texto(raw.createdAt),
    orderedAt: textoOpcional(raw.orderedAt),
    lineas: numero(raw.lineas),
    lineasCompletas: numero(raw.lineasCompletas),
    recepciones: numero(raw.recepciones),
    ...('expectedTotal' in raw ? { expectedTotal: montoOpcional(raw.expectedTotal) } : {}),
  }
}

export interface PaginaOrdenes {
  data: OrdenDTO[]
  pagination: Pagination
}

export function parsePaginaOrdenes(raw: unknown): PaginaOrdenes {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  const p = esObjeto(raw.pagination) ? raw.pagination : {}
  return {
    data: lista(raw.data, parseOrden),
    pagination: {
      page: numero(p.page, 1),
      pageSize: numero(p.pageSize, 25),
      total: numero(p.total),
      totalPages: numero(p.totalPages, 1),
    },
  }
}

export interface LineaDTO {
  id: number
  product: { id: number; name: string; saleUnit: UnidadDeVenta }
  purchaseUnit: UnidadDeCompra
  unitsPerPurchaseUnit: TextoCantidad
  orderedQuantity: TextoCantidad
  receivedQuantity: TextoCantidad
  pendingQuantity: TextoCantidad
  pendingStockQuantity: TextoCantidad
  unitCost?: Monto | null
  subtotal?: Monto | null
}

function parseLinea(raw: unknown): LineaDTO {
  if (!esObjeto(raw)) throw new Error('Linea invalida')
  const prod = esObjeto(raw.product) ? raw.product : {}
  return {
    id: numero(raw.id),
    product: {
      id: numero(prod.id),
      name: texto(prod.name),
      saleUnit: unidadDeVentaODefecto(prod.saleUnit),
    },
    purchaseUnit: unidadDeCompraODefecto(raw.purchaseUnit),
    unitsPerPurchaseUnit: cantidadODefecto(raw.unitsPerPurchaseUnit, '1.000'),
    orderedQuantity: cantidadODefecto(raw.orderedQuantity),
    receivedQuantity: cantidadODefecto(raw.receivedQuantity),
    pendingQuantity: cantidadODefecto(raw.pendingQuantity),
    pendingStockQuantity: cantidadODefecto(raw.pendingStockQuantity),
    ...('unitCost' in raw ? { unitCost: montoOpcional(raw.unitCost) } : {}),
    ...('subtotal' in raw ? { subtotal: montoOpcional(raw.subtotal) } : {}),
  }
}

export interface DiferenciaDTO {
  esperado: Monto
  recibido: Monto
  diferencia: Monto
  porcentaje: string | null
  hayDiferencia: boolean
}

export interface LineaRecibidaDTO {
  id: number
  orderItemId: number
  product: { id: number; name: string; saleUnit: UnidadDeVenta }
  purchaseUnit: UnidadDeCompra
  receivedQuantity: TextoCantidad
  /** Lo que volvio al proveedor, en unidad de compra. Fase 4C. */
  returnedQuantity: TextoCantidad
  /** `receivedQuantity - returnedQuantity`. Lo que quedo. Fase 4C. */
  netQuantity: TextoCantidad
  stockQuantity: TextoCantidad
  unitCost?: Monto | null
  expectedUnitCost?: Monto | null
  stockUnitCost?: Monto | null
  diferencia?: DiferenciaDTO
}

/** El desglose financiero de una entrega. Los cinco numeros del objetivo 22. */
export interface FinancieroDeEntregaDTO {
  /** Lo que costo. NUNCA se pisa: lo devuelto va al lado, no en su lugar. */
  total: Monto
  devuelto: Monto
  neto: Monto
  imputado: Monto
  pendiente: Monto
  /** Lo pagado por encima del neto. Solo aparece devolviendo lo ya pagado. */
  exceso: Monto
}

export interface RecepcionDTO {
  id: number
  receivedAt: string
  notes: string | null
  receivedBy: { id: number; name: string }
  /** Solo con `products.cost.view`: es informacion financiera entera. */
  financiero?: FinancieroDeEntregaDTO
  items: LineaRecibidaDTO[]
}

function parseRecepcion(raw: unknown): RecepcionDTO {
  if (!esObjeto(raw)) throw new Error('Recepcion invalida')
  return {
    id: numero(raw.id),
    receivedAt: texto(raw.receivedAt),
    notes: textoOpcional(raw.notes),
    receivedBy: persona(raw.receivedBy),
    ...(esObjeto(raw.financiero)
      ? {
          financiero: {
            total: montoOpcional(raw.financiero.total) ?? '0.00',
            devuelto: montoOpcional(raw.financiero.devuelto) ?? '0.00',
            neto: montoOpcional(raw.financiero.neto) ?? '0.00',
            imputado: montoOpcional(raw.financiero.imputado) ?? '0.00',
            pendiente: montoOpcional(raw.financiero.pendiente) ?? '0.00',
            exceso: montoOpcional(raw.financiero.exceso) ?? '0.00',
          },
        }
      : {}),
    items: lista(raw.items, (i): LineaRecibidaDTO => {
      if (!esObjeto(i)) throw new Error('Linea de recepcion invalida')
      const prod = esObjeto(i.product) ? i.product : {}
      const dif = esObjeto(i.diferencia) ? i.diferencia : null
      return {
        id: numero(i.id),
        orderItemId: numero(i.orderItemId),
        product: {
          id: numero(prod.id),
          name: texto(prod.name),
          saleUnit: unidadDeVentaODefecto(prod.saleUnit),
        },
        purchaseUnit: unidadDeCompraODefecto(i.purchaseUnit),
        receivedQuantity: cantidadODefecto(i.receivedQuantity),
        returnedQuantity: cantidadODefecto(i.returnedQuantity),
        // Sin `netQuantity`, lo recibido: una respuesta anterior a la Fase 4C no
        // lo trae, y en ese mundo el neto ERA lo recibido.
        netQuantity: cantidadODefecto(i.netQuantity, cantidadODefecto(i.receivedQuantity)),
        stockQuantity: cantidadODefecto(i.stockQuantity),
        ...('unitCost' in i ? { unitCost: montoOpcional(i.unitCost) } : {}),
        ...('expectedUnitCost' in i ? { expectedUnitCost: montoOpcional(i.expectedUnitCost) } : {}),
        ...('stockUnitCost' in i ? { stockUnitCost: montoOpcional(i.stockUnitCost) } : {}),
        ...(dif === null
          ? {}
          : {
              diferencia: {
                esperado: montoOpcional(dif.esperado) ?? '0.00',
                recibido: montoOpcional(dif.recibido) ?? '0.00',
                diferencia: montoOpcional(dif.diferencia) ?? '0.00',
                porcentaje: textoOpcional(dif.porcentaje),
                hayDiferencia: booleano(dif.hayDiferencia),
              },
            }),
      }
    }),
  }
}

export interface DetalleOrdenDTO extends OrdenDTO {
  notes: string | null
  cancelledAt: string | null
  cancelReason: string | null
  cancelledBy: { id: number; name: string } | null
  puedeEditar: boolean
  puedeConfirmar: boolean
  puedeRecibir: boolean
  puedeCancelar: boolean
  items: LineaDTO[]
  receipts: RecepcionDTO[]
}

export function parseDetalleOrden(raw: unknown): DetalleOrdenDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de una orden de compra')
  return {
    ...parseOrden(raw),
    notes: textoOpcional(raw.notes),
    cancelledAt: textoOpcional(raw.cancelledAt),
    cancelReason: textoOpcional(raw.cancelReason),
    cancelledBy: esObjeto(raw.cancelledBy) ? persona(raw.cancelledBy) : null,
    puedeEditar: booleano(raw.puedeEditar),
    puedeConfirmar: booleano(raw.puedeConfirmar),
    puedeRecibir: booleano(raw.puedeRecibir),
    puedeCancelar: booleano(raw.puedeCancelar),
    items: lista(raw.items, parseLinea),
    receipts: lista(raw.receipts, parseRecepcion),
  }
}

export interface ResumenComprasDTO {
  pendientes: number
  parciales: number
  borradores: number
  totalPendiente?: Monto | null
}

export function parseResumenCompras(raw: unknown): ResumenComprasDTO {
  if (!esObjeto(raw)) return { pendientes: 0, parciales: 0, borradores: 0 }
  return {
    pendientes: numero(raw.pendientes),
    parciales: numero(raw.parciales),
    borradores: numero(raw.borradores),
    ...('totalPendiente' in raw ? { totalPendiente: montoOpcional(raw.totalPendiente) } : {}),
  }
}
