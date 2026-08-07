/**
 * Movimientos de caja, saldo y arqueo tal como viajan por la API.
 */

import { esObjeto, lista, numero, texto, textoOpcional, numeroOpcional } from '@/lib/api-client'
import { montoODefecto, montoOpcional, type Monto } from '@/lib/money'

export type MetodoPago = 'efectivo' | 'tarjeta' | 'mercado_pago' | 'transferencia'

export interface ItemMovimientoDTO {
  id: number
  quantity: number
  price: Monto
  product: { id: number; name: string }
}

export interface MovimientoDTO {
  id: number
  amount: Monto
  paymentMethod: string
  /** 'sale' | 'sale_cancel' | 'manual' | 'withdrawal' | 'deposit' */
  type: string
  description: string | null
  date: string
  /** Venta asociada, cuando el movimiento nace de una. */
  saleId: number | null
  /** 'completed' | 'canceled', o null si el movimiento no viene de una venta. */
  saleStatus: string | null
  /** Detalle de lo vendido. null en movimientos manuales. */
  saleItems: ItemMovimientoDTO[] | null
  user: { id: number; name: string }
}

export interface SaldoDTO {
  /** Esperado del turno abierto. `null` cuando no hay caja abierta. */
  balance: Monto | null
  efectivoHoy: Monto
  /** Acumulado historico de la sucursal. Se muestra con su nombre, no como "saldo". */
  acumuladoHistorico: Monto
  turnoAbierto: boolean
}

export interface ArqueoDTO {
  id: number
  amount: Monto
  expected: Monto
  difference: Monto
  date: string
  notes: string | null
  user: { id: number; name: string }
}

const USUARIO_DESCONOCIDO = { id: 0, name: 'Desconocido' }

function parseUsuario(raw: unknown): { id: number; name: string } {
  if (!esObjeto(raw)) return USUARIO_DESCONOCIDO
  return { id: numero(raw.id), name: texto(raw.name, 'Desconocido') }
}

function parseItemMovimiento(raw: unknown): ItemMovimientoDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un item de venta')
  }
  return {
    id: numero(raw.id),
    quantity: numero(raw.quantity),
    price: montoODefecto(raw.price),
    product: parseUsuario(raw.product),
  }
}

export function parseMovimiento(raw: unknown): MovimientoDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un movimiento de caja')
  }
  return {
    id: numero(raw.id),
    amount: montoODefecto(raw.amount),
    paymentMethod: texto(raw.paymentMethod, 'efectivo'),
    type: texto(raw.type, 'manual'),
    description: textoOpcional(raw.description),
    date: texto(raw.date),
    saleId: numeroOpcional(raw.saleId),
    saleStatus: textoOpcional(raw.saleStatus),
    saleItems: Array.isArray(raw.saleItems) ? raw.saleItems.map(parseItemMovimiento) : null,
    user: parseUsuario(raw.user),
  }
}

/**
 * Acepta tanto `{ data, pagination }` como un array pelado.
 *
 * `/api/cash` pagina desde la Fase 1. Se conserva el segundo caso porque
 * otros listados todavia no lo hacen y este parser se comparte.
 */
export function parseMovimientos(raw: unknown): MovimientoDTO[] {
  if (esObjeto(raw) && 'data' in raw) return lista(raw.data, parseMovimiento)
  return lista(raw, parseMovimiento)
}

const SIN_CAJA: SaldoDTO = {
  balance: null,
  efectivoHoy: '0.00',
  acumuladoHistorico: '0.00',
  turnoAbierto: false,
}

export function parseSaldo(raw: unknown): SaldoDTO {
  if (!esObjeto(raw)) return SIN_CAJA
  return {
    balance: montoOpcional(raw.balance),
    efectivoHoy: montoODefecto(raw.efectivoHoy),
    acumuladoHistorico: montoODefecto(raw.acumuladoHistorico),
    turnoAbierto: raw.turnoAbierto === true,
  }
}

export function parseArqueo(raw: unknown): ArqueoDTO {
  if (!esObjeto(raw)) {
    throw new Error('La respuesta no tiene la forma de un arqueo')
  }
  return {
    id: numero(raw.id),
    amount: montoODefecto(raw.amount),
    expected: montoODefecto(raw.expected),
    difference: montoODefecto(raw.difference),
    date: texto(raw.date),
    notes: textoOpcional(raw.notes),
    user: parseUsuario(raw.user),
  }
}

export function parseArqueos(raw: unknown): ArqueoDTO[] {
  if (esObjeto(raw) && 'data' in raw) return lista(raw.data, parseArqueo)
  return lista(raw, parseArqueo)
}

// ---------------------------------------------------------------- turnos

export type EstadoTurno = 'open' | 'closed' | 'legacy'

export interface TurnoDTO {
  id: number
  status: EstadoTurno
  openedAt: string
  closedAt: string | null
  openingAmount: Monto
  /** Derivado mientras esta abierto; congelado al cerrar. */
  expectedAmount: Monto
  countedAmount: Monto | null
  difference: Monto | null
  openedBy: { id: number; name: string }
  closedBy: { id: number; name: string } | null
  authorizedBy: { id: number; name: string } | null
  openingNotes: string | null
  closingNotes: string | null
  ventasEnEfectivo: Monto
  ingresos: Monto
  egresos: Monto
  cantidadDeVentas: number
}

export interface PoliticaDeCajaDTO {
  requiereTurno: boolean
  umbralDiferencia: Monto
}

/** Un estado desconocido se trata como cerrado: es lo que menos habilita. */
function parseEstadoTurno(raw: unknown): EstadoTurno {
  const t = texto(raw)
  return t === 'open' || t === 'legacy' ? t : 'closed'
}

export function parseTurno(raw: unknown): TurnoDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un turno')
  return {
    id: numero(raw.id),
    status: parseEstadoTurno(raw.status),
    openedAt: texto(raw.openedAt),
    closedAt: textoOpcional(raw.closedAt),
    openingAmount: montoODefecto(raw.openingAmount),
    expectedAmount: montoODefecto(raw.expectedAmount),
    countedAmount: montoOpcional(raw.countedAmount),
    difference: montoOpcional(raw.difference),
    openedBy: parseUsuario(raw.openedBy),
    closedBy: esObjeto(raw.closedBy) ? parseUsuario(raw.closedBy) : null,
    authorizedBy: esObjeto(raw.authorizedBy) ? parseUsuario(raw.authorizedBy) : null,
    openingNotes: textoOpcional(raw.openingNotes),
    closingNotes: textoOpcional(raw.closingNotes),
    ventasEnEfectivo: montoODefecto(raw.ventasEnEfectivo),
    ingresos: montoODefecto(raw.ingresos),
    egresos: montoODefecto(raw.egresos),
    cantidadDeVentas: numero(raw.cantidadDeVentas),
  }
}

export interface EstadoDeCajaDTO {
  turno: TurnoDTO | null
  politica: PoliticaDeCajaDTO
}

export function parseEstadoDeCaja(raw: unknown): EstadoDeCajaDTO {
  const politica =
    esObjeto(raw) && esObjeto(raw.politica)
      ? {
          requiereTurno: raw.politica.requiereTurno !== false,
          umbralDiferencia: montoODefecto(raw.politica.umbralDiferencia),
        }
      : { requiereTurno: true, umbralDiferencia: '0.00' }

  const turno = esObjeto(raw) && esObjeto(raw.turno) ? parseTurno(raw.turno) : null
  return { turno, politica }
}

export function parseTurnos(raw: unknown): TurnoDTO[] {
  if (esObjeto(raw) && 'data' in raw) return lista(raw.data, parseTurno)
  return lista(raw, parseTurno)
}

/** El turno recien abierto o cerrado, tal como lo devuelve la ruta. */
export function parseTurnoEnvuelto(raw: unknown): TurnoDTO {
  if (esObjeto(raw) && esObjeto(raw.turno)) return parseTurno(raw.turno)
  return parseTurno(raw)
}
