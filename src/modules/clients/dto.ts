/**
 * Clientes y cuenta corriente tal como viajan por la API.
 *
 * Se parsean campo por campo en vez de confiar en la forma de la respuesta: la
 * pantalla tiene que seguir dibujandose aunque el servidor cambie algo, y una
 * fila incompleta es mejor que una pantalla en blanco.
 *
 * Este modulo NO importa Prisma: lo usan las pantallas.
 */

import { booleano, esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { monto, montoOpcional, type Monto } from '@/lib/money'
import type { Pagination } from '@/server/http/pagination'

export interface ClienteDTO {
  id: number
  name: string
  document: string | null
  taxId: string | null
  phone: string | null
  email: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  isCreditEnabled: boolean
  /** Positivo = debe. Negativo = tiene a favor. */
  balance: Monto
  /** `null` = sin limite configurado. `"0.00"` = no se le fia. */
  creditLimit: Monto | null
  /** Cuanto mas puede fiar. `null` cuando no hay limite. Nunca negativo. */
  disponible: Monto | null
}

export interface ClienteListadoDTO extends ClienteDTO {
  ultimaCompra: string | null
  ultimaActividad: string | null
}

export interface PaginaClientes {
  data: ClienteListadoDTO[]
  pagination: Pagination
}

export function parseCliente(raw: unknown): ClienteDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un cliente')
  return {
    id: numero(raw.id),
    name: texto(raw.name),
    document: textoOpcional(raw.document),
    taxId: textoOpcional(raw.taxId),
    phone: textoOpcional(raw.phone),
    email: textoOpcional(raw.email),
    address: textoOpcional(raw.address),
    notes: textoOpcional(raw.notes),
    isActive: booleano(raw.isActive, true),
    isCreditEnabled: booleano(raw.isCreditEnabled, true),
    balance: monto(texto(raw.balance, '0.00')),
    creditLimit: montoOpcional(raw.creditLimit),
    disponible: montoOpcional(raw.disponible),
  }
}

export function parseClienteListado(raw: unknown): ClienteListadoDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un cliente')
  return {
    ...parseCliente(raw),
    ultimaCompra: textoOpcional(raw.ultimaCompra),
    ultimaActividad: textoOpcional(raw.ultimaActividad),
  }
}

export function parsePaginaClientes(raw: unknown): PaginaClientes {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  const p = esObjeto(raw.pagination) ? raw.pagination : {}
  return {
    data: lista(raw.data, parseClienteListado),
    pagination: {
      page: numero(p.page, 1),
      pageSize: numero(p.pageSize, 25),
      total: numero(p.total),
      totalPages: numero(p.totalPages, 1),
    },
  }
}

/** La busqueda del mostrador devuelve una lista pelada, no una pagina. */
export function parseClientes(raw: unknown): ClienteDTO[] {
  return lista(raw, parseCliente)
}

/**
 * Lo que hace falta para decidir si se le fia, ANTES de intentarlo.
 *
 * Lo calcula el servidor con las mismas tres condiciones que aplica el libro.
 * La pantalla NO las replica: replicarlas garantizaria que algun dia digan
 * cosas distintas.
 */
export interface EstadoDeCreditoDTO extends ClienteDTO {
  saldoResultante: Monto
  entra: boolean
  excedente: Monto
  motivo: string | null
}

export function parseEstadoDeCredito(raw: unknown): EstadoDeCreditoDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  return {
    ...parseCliente(raw),
    saldoResultante: monto(texto(raw.saldoResultante, '0.00')),
    entra: booleano(raw.entra),
    excedente: monto(texto(raw.excedente, '0.00')),
    motivo: textoOpcional(raw.motivo),
  }
}

export interface MovimientoDeCuentaDTO {
  id: number
  createdAt: string
  type: string
  typeLabel: string
  amount: Monto
  previousBalance: Monto
  resultingBalance: Monto
  saleId: number | null
  paymentId: number | null
  paymentNumber: string | null
  reason: string | null
  user: { id: number; name: string }
  autorizadoPor: string | null
}

export interface PaginaMovimientosDeCuenta {
  data: MovimientoDeCuentaDTO[]
  pagination: Pagination
}

function parseMovimientoDeCuenta(raw: unknown): MovimientoDeCuentaDTO {
  if (!esObjeto(raw)) throw new Error('Movimiento invalido')
  const u = esObjeto(raw.user) ? raw.user : {}
  const a = esObjeto(raw.authorizedBy) ? raw.authorizedBy : null
  return {
    id: numero(raw.id),
    createdAt: texto(raw.createdAt),
    type: texto(raw.type),
    typeLabel: texto(raw.typeLabel, texto(raw.type)),
    amount: monto(texto(raw.amount, '0.00')),
    previousBalance: monto(texto(raw.previousBalance, '0.00')),
    resultingBalance: monto(texto(raw.resultingBalance, '0.00')),
    saleId: raw.saleId === null || raw.saleId === undefined ? null : numero(raw.saleId),
    paymentId: raw.paymentId === null || raw.paymentId === undefined ? null : numero(raw.paymentId),
    paymentNumber: textoOpcional(raw.paymentNumber),
    reason: textoOpcional(raw.reason),
    user: { id: numero(u.id), name: texto(u.name, '—') },
    autorizadoPor: a === null ? null : textoOpcional(a.name),
  }
}

export function parsePaginaMovimientos(raw: unknown): PaginaMovimientosDeCuenta {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  const p = esObjeto(raw.pagination) ? raw.pagination : {}
  return {
    data: lista(raw.data, parseMovimientoDeCuenta),
    pagination: {
      page: numero(p.page, 1),
      pageSize: numero(p.pageSize, 25),
      total: numero(p.total),
      totalPages: numero(p.totalPages, 1),
    },
  }
}

export interface PagoDeClienteDTO {
  id: number
  number: string
  amount: Monto
  method: string
  methodLabel: string
  reference: string | null
  notes: string | null
  createdAt: string
  entroACaja: boolean
  receivedBy: { id: number; name: string }
  previousBalance: Monto | null
  resultingBalance: Monto | null
}

export function parsePagoDeCliente(raw: unknown): PagoDeClienteDTO {
  if (!esObjeto(raw)) throw new Error('Pago invalido')
  const u = esObjeto(raw.receivedBy) ? raw.receivedBy : {}
  return {
    id: numero(raw.id),
    number: texto(raw.number),
    amount: monto(texto(raw.amount, '0.00')),
    method: texto(raw.method),
    methodLabel: texto(raw.methodLabel, texto(raw.method)),
    reference: textoOpcional(raw.reference),
    notes: textoOpcional(raw.notes),
    createdAt: texto(raw.createdAt),
    entroACaja: booleano(raw.entroACaja),
    receivedBy: { id: numero(u.id), name: texto(u.name, '—') },
    previousBalance: montoOpcional(raw.previousBalance),
    resultingBalance: montoOpcional(raw.resultingBalance),
  }
}

export interface PaginaPagos {
  data: PagoDeClienteDTO[]
  pagination: Pagination
}

export function parsePaginaPagos(raw: unknown): PaginaPagos {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  const p = esObjeto(raw.pagination) ? raw.pagination : {}
  return {
    data: lista(raw.data, parsePagoDeCliente),
    pagination: {
      page: numero(p.page, 1),
      pageSize: numero(p.pageSize, 25),
      total: numero(p.total),
      totalPages: numero(p.totalPages, 1),
    },
  }
}

export interface VentaDeClienteDTO {
  id: number
  date: string
  total: Monto
  status: string
  items: number
  aCuenta: Monto
}

export interface PaginaVentasDeCliente {
  data: VentaDeClienteDTO[]
  pagination: Pagination
}

export function parsePaginaVentasDeCliente(raw: unknown): PaginaVentasDeCliente {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  const p = esObjeto(raw.pagination) ? raw.pagination : {}
  return {
    data: lista(raw.data, (v) => {
      if (!esObjeto(v)) throw new Error('Venta invalida')
      return {
        id: numero(v.id),
        date: texto(v.date),
        total: monto(texto(v.total, '0.00')),
        status: texto(v.status, 'completed'),
        items: numero(v.items),
        aCuenta: monto(texto(v.aCuenta, '0.00')),
      }
    }),
    pagination: {
      page: numero(p.page, 1),
      pageSize: numero(p.pageSize, 25),
      total: numero(p.total),
      totalPages: numero(p.totalPages, 1),
    },
  }
}

export interface DetalleClienteDTO extends ClienteDTO {
  resumen: {
    ventasACuenta: number
    cuantasVentas: number
    cuantosMovimientos: number
    cuantosPagos: number
    ultimaCompra: { id: number; date: string; total: Monto; status: string } | null
    tieneSaldoAFavor: boolean
  }
}

export function parseDetalleCliente(raw: unknown): DetalleClienteDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un cliente')
  const r = esObjeto(raw.resumen) ? raw.resumen : {}
  const uc = esObjeto(r.ultimaCompra) ? r.ultimaCompra : null

  return {
    ...parseCliente(raw),
    resumen: {
      ventasACuenta: numero(r.ventasACuenta),
      cuantasVentas: numero(r.cuantasVentas),
      cuantosMovimientos: numero(r.cuantosMovimientos),
      cuantosPagos: numero(r.cuantosPagos),
      ultimaCompra:
        uc === null
          ? null
          : {
              id: numero(uc.id),
              date: texto(uc.date),
              total: monto(texto(uc.total, '0.00')),
              status: texto(uc.status, 'completed'),
            },
      tieneSaldoAFavor: booleano(r.tieneSaldoAFavor),
    },
  }
}

/** El comprobante de un cobro, tal como lo necesita la vista de impresion. */
export interface ComprobanteDTO {
  id: number
  number: string
  amount: Monto
  method: string
  methodLabel: string
  reference: string | null
  notes: string | null
  createdAt: string
  client: { id: number; name: string; document: string | null; phone: string | null }
  branch: { id: number; name: string; address: string | null; phone: string | null }
  receivedBy: { id: number; name: string }
  previousBalance: Monto | null
  resultingBalance: Monto | null
}

export function parseComprobante(raw: unknown): ComprobanteDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un comprobante')
  const c = esObjeto(raw.client) ? raw.client : {}
  const b = esObjeto(raw.branch) ? raw.branch : {}
  const u = esObjeto(raw.receivedBy) ? raw.receivedBy : {}

  return {
    id: numero(raw.id),
    number: texto(raw.number),
    amount: monto(texto(raw.amount, '0.00')),
    method: texto(raw.method),
    methodLabel: texto(raw.methodLabel, texto(raw.method)),
    reference: textoOpcional(raw.reference),
    notes: textoOpcional(raw.notes),
    createdAt: texto(raw.createdAt),
    client: {
      id: numero(c.id),
      name: texto(c.name, '—'),
      document: textoOpcional(c.document),
      phone: textoOpcional(c.phone),
    },
    branch: {
      id: numero(b.id),
      name: texto(b.name, '—'),
      address: textoOpcional(b.address),
      phone: textoOpcional(b.phone),
    },
    receivedBy: { id: numero(u.id), name: texto(u.name, '—') },
    previousBalance: montoOpcional(raw.previousBalance),
    resultingBalance: montoOpcional(raw.resultingBalance),
  }
}

/** La cuenta de una venta recien hecha: cuanto quedo debiendo el cliente. */
export interface CuentaDeVentaDTO {
  clientId: number
  clientName: string
  charged: Monto
  previousBalance: Monto
  resultingBalance: Monto
  creditApplied: Monto
  limitOverridden: boolean
}

export function parseCuentaDeVenta(raw: unknown): CuentaDeVentaDTO | null {
  if (!esObjeto(raw)) return null
  return {
    clientId: numero(raw.clientId),
    clientName: texto(raw.clientName, '—'),
    charged: monto(texto(raw.charged, '0.00')),
    previousBalance: monto(texto(raw.previousBalance, '0.00')),
    resultingBalance: monto(texto(raw.resultingBalance, '0.00')),
    creditApplied: monto(texto(raw.creditApplied, '0.00')),
    limitOverridden: booleano(raw.limitOverridden),
  }
}
