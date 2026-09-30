/**
 * El cierre del dia tal como lo lee la pantalla. Espejo de `CierreDelDia`
 * del servicio, parseado a la defensiva como el resto de los DTO de caja.
 */

import { esObjeto, lista, numero, texto, textoOpcional, booleano } from '@/lib/api-client'
import { montoODefecto, montoOpcional, type Monto } from '@/lib/money'

export interface RenglonDeMedioDTO {
  medio: string
  etiqueta: string
  cobrado: Monto
  operaciones: number
  entraAlCajon: boolean
  esFiado: boolean
}

export interface TurnoDelCierreDTO {
  id: number
  status: string
  openedAt: string
  closedAt: string | null
  openedBy: string
  closedBy: string | null
  openingAmount: Monto
  ventasEnEfectivo: Monto
  ingresos: Monto
  egresos: Monto
  expectedAmount: Monto
  countedAmount: Monto | null
  difference: Monto | null
  deOtroDia: boolean
}

export type EstadoCajaDelDia = 'sin_caja' | 'abierta' | 'cerrada' | 'varias'

export interface CierreDelDiaDTO {
  fecha: string
  esHoy: boolean
  ventas: { total: Monto; operaciones: number; anuladas: number; ticketPromedio: Monto }
  porMedio: RenglonDeMedioDTO[]
  caja: {
    estado: EstadoCajaDelDia
    cajaInicial: Monto
    ventasEnEfectivo: Monto
    ingresos: Monto
    egresos: Monto
    deberiaHaber: Monto
    contado: Monto | null
    diferencia: Monto | null
  }
  turnos: TurnoDelCierreDTO[]
  avisos: Array<{ codigo: string; texto: string }>
}

function parseEstado(raw: unknown): EstadoCajaDelDia {
  const t = texto(raw)
  return t === 'abierta' || t === 'cerrada' || t === 'varias' ? t : 'sin_caja'
}

function parseMedio(raw: unknown): RenglonDeMedioDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un medio de pago')
  return {
    medio: texto(raw.medio),
    etiqueta: texto(raw.etiqueta, texto(raw.medio)),
    cobrado: montoODefecto(raw.cobrado),
    operaciones: numero(raw.operaciones),
    entraAlCajon: booleano(raw.entraAlCajon),
    esFiado: booleano(raw.esFiado),
  }
}

function parseTurnoDelCierre(raw: unknown): TurnoDelCierreDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un turno')
  return {
    id: numero(raw.id),
    status: texto(raw.status),
    openedAt: texto(raw.openedAt),
    closedAt: textoOpcional(raw.closedAt),
    openedBy: texto(raw.openedBy),
    closedBy: textoOpcional(raw.closedBy),
    openingAmount: montoODefecto(raw.openingAmount),
    ventasEnEfectivo: montoODefecto(raw.ventasEnEfectivo),
    ingresos: montoODefecto(raw.ingresos),
    egresos: montoODefecto(raw.egresos),
    expectedAmount: montoODefecto(raw.expectedAmount),
    countedAmount: montoOpcional(raw.countedAmount),
    difference: montoOpcional(raw.difference),
    deOtroDia: booleano(raw.deOtroDia),
  }
}

export function parseCierreDelDia(raw: unknown): CierreDelDiaDTO {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un cierre del día')
  const ventas = esObjeto(raw.ventas) ? raw.ventas : {}
  const caja = esObjeto(raw.caja) ? raw.caja : {}
  return {
    fecha: texto(raw.fecha),
    esHoy: booleano(raw.esHoy),
    ventas: {
      total: montoODefecto(ventas.total),
      operaciones: numero(ventas.operaciones),
      anuladas: numero(ventas.anuladas),
      ticketPromedio: montoODefecto(ventas.ticketPromedio),
    },
    porMedio: lista(raw.porMedio, parseMedio),
    caja: {
      estado: parseEstado(caja.estado),
      cajaInicial: montoODefecto(caja.cajaInicial),
      ventasEnEfectivo: montoODefecto(caja.ventasEnEfectivo),
      ingresos: montoODefecto(caja.ingresos),
      egresos: montoODefecto(caja.egresos),
      deberiaHaber: montoODefecto(caja.deberiaHaber),
      contado: montoOpcional(caja.contado),
      diferencia: montoOpcional(caja.diferencia),
    },
    turnos: lista(raw.turnos, parseTurnoDelCierre),
    avisos: lista(raw.avisos, (a) =>
      esObjeto(a) ? { codigo: texto(a.codigo), texto: texto(a.texto) } : { codigo: '', texto: '' },
    ),
  }
}
