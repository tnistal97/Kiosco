/**
 * Ventas tal como viajan por la API.
 */

import { esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { unidadDeVentaODefecto, type UnidadDeVenta } from '@/modules/products/units'
import { aMilesimas, type TextoCantidad } from '@/lib/cantidad'
import {
  CERO,
  montoODefecto,
  montoOpcional,
  multiplicarMonto,
  sumarMontos,
  type Monto,
} from '@/lib/money'

export type EstadoVenta = 'completed' | 'canceled'

export interface ItemVentaDTO {
  id: number
  quantity: number
  /** La cantidad tal como la manda el servidor ("0.425"), para escribirla con su unidad. */
  cantidad: TextoCantidad
  /** En que unidad se vendio. Sin ella "0,425" no se puede leer. */
  saleUnit: UnidadDeVenta
  price: Monto
  product: { id: number; name: string }
}

/** Una linea de pago de una venta: como se cobro y, en efectivo, con cuanto y el vuelto. */
export interface PagoVentaDTO {
  method: string
  amount: Monto
  cashReceived: Monto | null
  changeGiven: Monto | null
  reference: string | null
}

export interface VentaDTO {
  id: number
  date: string
  status: EstadoVenta
  total: Monto
  paymentMethod: string | null
  canceledAt: string | null
  cancelReason: string | null
  user: { id: number; name: string }
  canceledBy: { id: number; name: string } | null
  /** A quien se le vendio; null en la venta al mostrador. */
  cliente: { id: number; name: string } | null
  /** Los pagos, en orden. Vacio si el servidor no los mando. */
  pagos: PagoVentaDTO[]
  items: ItemVentaDTO[]
}

function parsePersona(raw: unknown): { id: number; name: string } {
  if (!esObjeto(raw)) return { id: 0, name: 'Desconocido' }
  return { id: numero(raw.id), name: texto(raw.name, 'Desconocido') }
}

function parsePersonaOpcional(raw: unknown): { id: number; name: string } | null {
  return esObjeto(raw) ? parsePersona(raw) : null
}

/** "2.000" → 2. Una cadena que no es cantidad vale 0 en vez de romper el listado. */
function cantidadEnNumero(texto: string): number {
  try {
    return aMilesimas(texto) / 1000
  } catch {
    return 0
  }
}

export function parseItemVenta(raw: unknown): ItemVentaDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un item de venta')
  }
  // El servidor manda la cantidad como TEXTO ("2.000", "0.425") desde que
  // existen los productos por peso. `numero()` solo acepta numeros y la
  // dejaba en 0: el detalle mostraba "×0" y subtotales de $ 0,00.
  const crudo = raw.quantity
  const cantidad: TextoCantidad = typeof crudo === 'string' ? crudo : String(numero(crudo))
  return {
    id: numero(raw.id),
    quantity: typeof crudo === 'string' ? cantidadEnNumero(crudo) : numero(crudo),
    cantidad,
    saleUnit: unidadDeVentaODefecto(raw.saleUnit),
    price: montoODefecto(raw.price),
    product: parsePersona(raw.product),
  }
}

export function parsePagoVenta(raw: unknown): PagoVentaDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un pago')
  }
  return {
    method: texto(raw.method, 'OTHER'),
    amount: montoODefecto(raw.amount),
    cashReceived: montoOpcional(raw.cashReceived),
    changeGiven: montoOpcional(raw.changeGiven),
    reference: textoOpcional(raw.reference),
  }
}

/** Cualquier estado desconocido se trata como completada, que es lo neutro. */
function parseEstado(raw: unknown): EstadoVenta {
  return texto(raw) === 'canceled' ? 'canceled' : 'completed'
}

export function parseVenta(raw: unknown): VentaDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de una venta')
  }
  const items = lista(raw.items, parseItemVenta)
  return {
    id: numero(raw.id),
    date: texto(raw.date),
    status: parseEstado(raw.status),
    // El servidor ya manda el total calculado; si faltara se recalcula aca
    // con los mismos items, nunca con un valor que haya puesto el navegador.
    total:
      montoOpcional(raw.total) ??
      (items.length === 0
        ? CERO
        : sumarMontos(...items.map((i) => multiplicarMonto(i.price, i.quantity)))),
    paymentMethod: textoOpcional(raw.paymentMethod),
    canceledAt: textoOpcional(raw.canceledAt),
    cancelReason: textoOpcional(raw.cancelReason),
    user: parsePersona(raw.user),
    canceledBy: parsePersonaOpcional(raw.canceledBy),
    cliente: parsePersonaOpcional(raw.client),
    pagos: lista(raw.payments, parsePagoVenta),
    items,
  }
}

export function parseVentas(raw: unknown): VentaDTO[] {
  // `/api/admin/sales` pagina desde la Fase 1 y devuelve { data, pagination,
  // totales }. Antes devolvia { sales }, y se conserva por compatibilidad.
  if (esObjeto(raw) && 'data' in raw) return lista(raw.data, parseVenta)
  if (esObjeto(raw) && 'sales' in raw) return lista(raw.sales, parseVenta)
  return lista(raw, parseVenta)
}

export interface TotalesVentas {
  ventas: number
  anuladas: number
  recaudado: Monto
}

export interface PaginaVentas {
  data: VentaDTO[]
  page: number
  totalPages: number
  totales: TotalesVentas
}

/** Igual que `parseVentas`, pero conservando totales y paginacion. */
export function parsePaginaVentas(raw: unknown): PaginaVentas {
  const data = parseVentas(raw)
  const paginacion = esObjeto(raw) && esObjeto(raw.pagination) ? raw.pagination : {}
  const totales = esObjeto(raw) && esObjeto(raw.totales) ? raw.totales : {}

  return {
    data,
    page: numero(paginacion.page, 1),
    totalPages: numero(paginacion.totalPages, 1),
    totales: {
      ventas: numero(totales.ventas, data.length),
      anuladas: numero(totales.anuladas),
      recaudado: montoODefecto(totales.recaudado),
    },
  }
}
