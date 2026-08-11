/**
 * Cuenta de proveedores tal como viaja por la API.
 *
 * Se parsea campo por campo en vez de confiar en la forma de la respuesta: la
 * pantalla tiene que seguir dibujandose aunque el servidor cambie algo, y una
 * fila incompleta es mejor que una pantalla en blanco.
 *
 * Archivo aparte de `dto.ts` --que ya existia para la ficha del proveedor--
 * porque son dos materias distintas: alla, quien es el proveedor; aca, que le
 * debemos. La ficha se sigue leyendo sin permiso de cuentas.
 */

import { booleano, esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { montoODefecto, montoOpcional, type Monto } from '@/lib/money'
import type { Pagination } from '@/server/http/pagination'
import type { EstadoDeDeuda } from './movement-types'
import { ESTADOS_DE_DEUDA } from './movement-types'

// ---------------------------------------------------------------- resumen

/** La cabecera de la pestania: los cinco numeros del objetivo 25. */
export interface ResumenDeCuentaDTO {
  supplierId: number
  name: string
  /** POSITIVO = le debemos. NEGATIVO = tenemos credito con el. */
  balance: Monto
  /** Cuanto de lo que se debe ya vencio. */
  vencido: Monto
  /** La fecha mas proxima entre las deudas abiertas. `null` si ninguna la tiene. */
  proximoVencimiento: string | null
  ultimaCompra: string | null
  ultimoPago: string | null
  deudasAbiertas: number
}

export function parseResumenDeCuenta(raw: unknown): ResumenDeCuentaDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de una cuenta')
  return {
    supplierId: numero(raw.supplierId),
    name: texto(raw.name),
    balance: montoODefecto(raw.balance),
    vencido: montoODefecto(raw.vencido),
    proximoVencimiento: textoOpcional(raw.proximoVencimiento),
    ultimaCompra: textoOpcional(raw.ultimaCompra),
    ultimoPago: textoOpcional(raw.ultimoPago),
    deudasAbiertas: numero(raw.deudasAbiertas),
  }
}

// ---------------------------------------------------------------- deudas

/**
 * Una obligacion abierta. Es una RECEPCION, nunca una orden.
 *
 * `estado` viene calculado del servidor y no se recalcula en el navegador: el
 * "hoy" que decide si algo vencio es el dia comercial de la sucursal, y el
 * navegador no lo conoce. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
 */
export interface DeudaDTO {
  receiptId: number
  /** El numero de la orden de la que salio esta entrega. `OC-00000042`. */
  orderNumber: string
  orderId: number
  receivedAt: string
  dueDate: string | null
  total: Monto
  pagado: Monto
  pendiente: Monto
  estado: EstadoDeDeuda
}

function estadoDeDeuda(valor: unknown): EstadoDeDeuda {
  const t = typeof valor === 'string' ? valor : ''
  // Un estado desconocido cae en 'PENDIENTE' en vez de romper la fila. Es el
  // mas inocuo de los cuatro: no promete que este pagada ni grita que vencio.
  return (ESTADOS_DE_DEUDA as readonly string[]).includes(t) ? (t as EstadoDeDeuda) : 'PENDIENTE'
}

export function parseDeuda(raw: unknown): DeudaDTO {
  if (!esObjeto(raw)) throw new Error('Deuda invalida')
  return {
    receiptId: numero(raw.receiptId),
    orderNumber: texto(raw.orderNumber),
    orderId: numero(raw.orderId),
    receivedAt: texto(raw.receivedAt),
    dueDate: textoOpcional(raw.dueDate),
    total: montoODefecto(raw.total),
    pagado: montoODefecto(raw.pagado),
    pendiente: montoODefecto(raw.pendiente),
    estado: estadoDeDeuda(raw.estado),
  }
}

export interface PaginaDeudas {
  data: DeudaDTO[]
  pagination: Pagination
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

export function parsePaginaDeudas(raw: unknown): PaginaDeudas {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  return { data: lista(raw.data, parseDeuda), pagination: paginacion(raw.pagination) }
}

// ---------------------------------------------------------------- extracto

export interface MovimientoDeProveedorDTO {
  id: number
  createdAt: string
  type: string
  typeLabel: string
  amount: Monto
  previousBalance: Monto
  resultingBalance: Monto
  receiptId: number | null
  paymentId: number | null
  /** El numero del comprobante, cuando el movimiento vino de un pago. */
  paymentNumber: string | null
  /** El numero de la orden, cuando vino de una recepcion. */
  orderNumber: string | null
  reason: string | null
  reference: string | null
  user: { id: number; name: string }
  authorizedBy: { id: number; name: string } | null
}

function persona(raw: unknown): { id: number; name: string } {
  const p = esObjeto(raw) ? raw : {}
  return { id: numero(p.id), name: texto(p.name, '—') }
}

export function parseMovimientoDeProveedor(raw: unknown): MovimientoDeProveedorDTO {
  if (!esObjeto(raw)) throw new Error('Movimiento invalido')
  return {
    id: numero(raw.id),
    createdAt: texto(raw.createdAt),
    type: texto(raw.type),
    // El respaldo de la etiqueta es el codigo crudo, no una raya: un tipo que
    // el servidor conozca y este DTO no tiene que verse, aunque se vea feo.
    typeLabel: texto(raw.typeLabel, typeof raw.type === 'string' ? raw.type : '—'),
    amount: montoODefecto(raw.amount),
    previousBalance: montoODefecto(raw.previousBalance),
    resultingBalance: montoODefecto(raw.resultingBalance),
    receiptId: raw.receiptId == null ? null : numero(raw.receiptId),
    paymentId: raw.paymentId == null ? null : numero(raw.paymentId),
    paymentNumber: textoOpcional(raw.paymentNumber),
    orderNumber: textoOpcional(raw.orderNumber),
    reason: textoOpcional(raw.reason),
    reference: textoOpcional(raw.reference),
    user: persona(raw.user),
    authorizedBy: raw.authorizedBy == null ? null : persona(raw.authorizedBy),
  }
}

export interface PaginaMovimientosDeProveedor {
  data: MovimientoDeProveedorDTO[]
  pagination: Pagination
}

export function parsePaginaMovimientosDeProveedor(raw: unknown): PaginaMovimientosDeProveedor {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  return {
    data: lista(raw.data, parseMovimientoDeProveedor),
    pagination: paginacion(raw.pagination),
  }
}

// ---------------------------------------------------------------- pago

export interface ImputacionDTO {
  receiptId: number
  orderNumber: string
  amount: Monto
}

/** El comprobante de un pago, tal como se imprime. */
export interface PagoAProveedorDTO {
  id: number
  number: string
  supplierId: number
  supplierName: string
  amount: Monto
  method: string
  methodLabel: string
  previousBalance: Monto
  resultingBalance: Monto
  /** Cuanto quedo a favor NUESTRO. `"0.00"` si el saldo no quedo negativo. */
  saldoAFavor: Monto
  /** Cuanto del pago no se imputo a ninguna obligacion concreta. */
  sinImputar: Monto
  imputaciones: ImputacionDTO[]
  reference: string | null
  notes: string | null
  paidBy: { id: number; name: string }
  shiftId: number | null
  /** Si esta plata salio del cajon. Falso en transferencia y tarjeta. */
  salioDeCaja: boolean
  paidAt: string
}

export function parsePagoAProveedor(raw: unknown): PagoAProveedorDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un pago')
  return {
    id: numero(raw.id),
    number: texto(raw.number),
    supplierId: numero(raw.supplierId),
    supplierName: texto(raw.supplierName),
    amount: montoODefecto(raw.amount),
    method: texto(raw.method),
    methodLabel: texto(raw.methodLabel, '—'),
    previousBalance: montoODefecto(raw.previousBalance),
    resultingBalance: montoODefecto(raw.resultingBalance),
    saldoAFavor: montoODefecto(raw.saldoAFavor),
    sinImputar: montoODefecto(raw.sinImputar),
    imputaciones: lista(raw.imputaciones, (i) => {
      if (!esObjeto(i)) throw new Error('Imputacion invalida')
      return {
        receiptId: numero(i.receiptId),
        orderNumber: texto(i.orderNumber, '—'),
        amount: montoODefecto(i.amount),
      }
    }),
    reference: textoOpcional(raw.reference),
    notes: textoOpcional(raw.notes),
    paidBy: persona(raw.paidBy),
    shiftId: raw.shiftId == null ? null : numero(raw.shiftId),
    salioDeCaja: booleano(raw.salioDeCaja),
    paidAt: texto(raw.paidAt),
  }
}

/** El comprobante completo, con los datos del comercio para imprimirlo. */
export interface ComprobanteDePagoDTO extends PagoAProveedorDTO {
  supplier: { id: number; name: string; taxId: string | null; phone: string | null }
  branch: { id: number; name: string; address: string | null; phone: string | null }
}

export function parseComprobanteDePago(raw: unknown): ComprobanteDePagoDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un comprobante')
  const s = esObjeto(raw.supplier) ? raw.supplier : {}
  const b = esObjeto(raw.branch) ? raw.branch : {}
  return {
    ...parsePagoAProveedor(raw),
    supplier: {
      id: numero(s.id),
      name: texto(s.name, '—'),
      taxId: textoOpcional(s.taxId),
      phone: textoOpcional(s.phone),
    },
    branch: {
      id: numero(b.id),
      name: texto(b.name, '—'),
      address: textoOpcional(b.address),
      phone: textoOpcional(b.phone),
    },
  }
}

// ---------------------------------------------------------------- cartera

/** El tablero: lo que se debe en total, y lo que aprieta. */
export interface CarteraDeProveedoresDTO {
  total: Monto
  vencido: Monto
  proximos7Dias: Monto
  proveedoresConDeuda: number
  deudasVencidas: number
  comprasPendientes: number
  recepcionesParciales: number
}

export function parseCarteraDeProveedores(raw: unknown): CarteraDeProveedoresDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  return {
    total: montoODefecto(raw.total),
    vencido: montoODefecto(raw.vencido),
    proximos7Dias: montoODefecto(raw.proximos7Dias),
    proveedoresConDeuda: numero(raw.proveedoresConDeuda),
    deudasVencidas: numero(raw.deudasVencidas),
    comprasPendientes: numero(raw.comprasPendientes),
    recepcionesParciales: numero(raw.recepcionesParciales),
  }
}

/** Se re-exporta para que la pantalla no tenga que importar de dos lugares. */
export { montoOpcional }
