/**
 * Cierre del dia. V1 comercial.
 *
 * La pantalla mas mirada del producto despues del punto de venta. El dueño
 * tiene que poder responder en segundos:
 *
 *   ¿Cuanto vendi hoy?  ¿Cuantas ventas?  ¿Como me pagaron?
 *   ¿Cuanto efectivo tendria que haber?  ¿Cuanto conte?  ¿Hay diferencia?
 *
 * TODOS los numeros salen del servidor y de lo que ya existe: las ventas y
 * sus pagos (`Sale`, `SalePayment`), el turno de caja (`CashShift`) y sus
 * movimientos. No hay una segunda cuenta en el navegador que pueda dar otra
 * cosa. Y la distincion que la pantalla tiene que hacer visible:
 *
 *   "VENTAS TOTALES"  ≠  "EFECTIVO QUE DEBERIA HABER EN EL CAJON".
 *
 * Lo primero suma todos los medios, incluido lo fiado. Lo segundo suma SOLO el
 * efectivo, arranca en la caja inicial y resta las salidas. Ver
 * docs/CASH_SHIFT_MODEL.md.
 */

import { prisma } from '@/lib/prisma'
import type { Session } from '@/server/auth/session'
import { forbidden, invalid } from '@/server/http/errors'
import { type Monto, CERO } from '@/lib/money'
import { absoluto, aMonto, dinero, sumar, type Dinero } from '@/server/money'
import {
  comoTimestampUTC,
  esFechaLocal,
  hoyEnSucursal,
  rangoDeSucursal,
  type FechaLocal,
} from '@/server/tiempo'
import { etiquetaDeMedio, esEfectivo, esCuenta } from '@/modules/sales/payment-methods'
import { turnosDelDia, type ResumenTurno } from './service.turnos'

export interface RenglonDeMedio {
  medio: string
  etiqueta: string
  cobrado: Monto
  operaciones: number
  /** Si entro al cajon. Solo el efectivo. */
  entraAlCajon: boolean
  /** Si es fiado: cubre parte de la venta pero no es plata que entro. */
  esFiado: boolean
}

export interface TurnoDelCierre {
  id: number
  status: string
  openedAt: string
  closedAt: string | null
  openedBy: string
  closedBy: string | null
  openingAmount: Monto
  ventasEnEfectivo: Monto
  ingresos: Monto
  /** En positivo, a diferencia del turno, que las guarda con signo. */
  egresos: Monto
  expectedAmount: Monto
  countedAmount: Monto | null
  difference: Monto | null
  /** Se abrio ANTES del dia consultado y sigue abierto: la caja de ayer. */
  deOtroDia: boolean
}

export interface CierreDelDia {
  fecha: FechaLocal
  /** Si `fecha` es hoy en la sucursal. La pantalla dice "HOY" o la fecha. */
  esHoy: boolean
  ventas: {
    total: Monto
    operaciones: number
    anuladas: number
    ticketPromedio: Monto
  }
  porMedio: RenglonDeMedio[]
  /**
   * La suma de la caja. Si hubo mas de un turno en el dia, es la suma de
   * todos; el detalle por turno esta en `turnos`.
   */
  caja: {
    /** 'sin_caja' | 'abierta' | 'cerrada' | 'varias' */
    estado: 'sin_caja' | 'abierta' | 'cerrada' | 'varias'
    cajaInicial: Monto
    ventasEnEfectivo: Monto
    ingresos: Monto
    egresos: Monto
    /** Lo que TIENE que haber en el cajon: inicial + ventas efectivo + ingresos - egresos. */
    deberiaHaber: Monto
    /** Lo que se conto al cerrar. `null` mientras la caja siga abierta. */
    contado: Monto | null
    /** contado - deberiaHaber. `null` mientras la caja siga abierta. */
    diferencia: Monto | null
  }
  turnos: TurnoDelCierre[]
  avisos: Array<{
    codigo: 'sin_caja' | 'caja_abierta' | 'caja_de_otro_dia' | 'varios_turnos'
    texto: string
  }>
}

type Fila = Record<string, string | null>

async function filas(sql: string, ...valores: unknown[]): Promise<Fila[]> {
  return prisma.$queryRawUnsafe<Fila[]>(sql, ...valores)
}

const monto = (v: string | null | undefined): Monto => v ?? CERO

function aTurnoDelCierre(t: ResumenTurno, inicioDelDia: Date): TurnoDelCierre {
  return {
    id: t.id,
    status: t.status,
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt === null ? null : t.closedAt.toISOString(),
    openedBy: t.openedBy.name,
    closedBy: t.closedBy?.name ?? null,
    openingAmount: t.openingAmount,
    ventasEnEfectivo: t.ventasEnEfectivo,
    ingresos: t.ingresos,
    egresos: aMonto(absoluto(dinero(t.egresos))),
    expectedAmount: t.expectedAmount,
    countedAmount: t.countedAmount,
    difference: t.difference,
    deOtroDia: t.status === 'open' && t.openedAt < inicioDelDia,
  }
}

function sumarMontos(valores: Monto[]): Dinero {
  return valores.reduce<Dinero>((acc, v) => sumar(acc, dinero(v)), dinero(0))
}

/**
 * El cierre de un dia de la sucursal. Sin `fecha`, el de hoy.
 *
 * Exige `reports.cash.view`: es la recaudacion completa del dia, que un
 * cajero no ve --su pantalla de caja ya le muestra lo que le corresponde,
 * que es el esperado de SU turno--.
 */
export async function cierreDelDia(
  session: Session,
  query: { fecha?: string | undefined },
): Promise<CierreDelDia> {
  if (!session.permissions.has('reports.cash.view')) {
    throw forbidden('No tiene permiso para ver el cierre del día')
  }
  const hoy = await hoyEnSucursal(prisma, session.branchId)
  const fecha = query.fecha ?? hoy
  if (!esFechaLocal(fecha)) throw invalid('La fecha va como AAAA-MM-DD')

  const rango = await rangoDeSucursal(prisma, session.branchId, fecha, fecha)
  const desde = comoTimestampUTC(rango.desde)
  const hasta = comoTimestampUTC(rango.hasta)
  const branchId = session.branchId

  const [resumen, porMedio, turnos] = await Promise.all([
    filas(
      `SELECT
         COALESCE(sum("total") FILTER (WHERE "status" = 'completed'), 0)::numeric(14,2)::text AS total,
         count(*) FILTER (WHERE "status" = 'completed')::text                                AS operaciones,
         count(*) FILTER (WHERE "status" = 'canceled')::text                                 AS anuladas
       FROM "Sale"
       WHERE "branchId" = $1 AND "date" >= $2::timestamp AND "date" <= $3::timestamp`,
      branchId,
      desde,
      hasta,
    ),
    // Mismo criterio que el reporte de ventas: los pagos de las ventas
    // COMPLETADAS del dia, agrupados por medio. Una anulada no cuenta.
    filas(
      `SELECT p."method"                          AS medio,
              sum(p."amount")::numeric(14,2)::text AS cobrado,
              count(*)::text                       AS operaciones
         FROM "SalePayment" p JOIN "Sale" s ON s."id" = p."saleId"
        WHERE s."branchId" = $1 AND s."date" >= $2::timestamp AND s."date" <= $3::timestamp
          AND s."status" = 'completed'
        GROUP BY p."method" ORDER BY sum(p."amount") DESC`,
      branchId,
      desde,
      hasta,
    ),
    turnosDelDia(session, rango),
  ])

  const r = resumen[0]
  const operaciones = Number(r?.operaciones ?? 0)
  const total = monto(r?.total)

  const detalle = turnos.map((t) => aTurnoDelCierre(t, rango.desde))
  const abiertos = detalle.filter((t) => t.status === 'open')
  const todosCerrados = detalle.length > 0 && abiertos.length === 0

  const estado: CierreDelDia['caja']['estado'] =
    detalle.length === 0
      ? 'sin_caja'
      : detalle.length > 1
        ? 'varias'
        : abiertos.length > 0
          ? 'abierta'
          : 'cerrada'

  const caja: CierreDelDia['caja'] = {
    estado,
    cajaInicial: aMonto(sumarMontos(detalle.map((t) => t.openingAmount))),
    ventasEnEfectivo: aMonto(sumarMontos(detalle.map((t) => t.ventasEnEfectivo))),
    ingresos: aMonto(sumarMontos(detalle.map((t) => t.ingresos))),
    // El turno guarda las salidas con signo (negativas). Aca van en positivo:
    // el renglon dice "− Egresos" y el signo lo pone la etiqueta, no el numero.
    egresos: aMonto(absoluto(sumarMontos(detalle.map((t) => t.egresos)))),
    deberiaHaber: aMonto(sumarMontos(detalle.map((t) => t.expectedAmount))),
    contado: todosCerrados
      ? aMonto(sumarMontos(detalle.map((t) => t.countedAmount ?? CERO)))
      : null,
    diferencia: todosCerrados
      ? aMonto(sumarMontos(detalle.map((t) => t.difference ?? CERO)))
      : null,
  }

  const avisos: CierreDelDia['avisos'] = []
  if (estado === 'sin_caja') {
    avisos.push({
      codigo: 'sin_caja',
      texto:
        fecha === hoy
          ? 'Hoy no se abrió la caja. Las ventas se ven igual, pero no hay contra qué comparar el efectivo.'
          : 'Ese día no se abrió la caja.',
    })
  }
  for (const t of abiertos) {
    if (t.deOtroDia) {
      avisos.push({
        codigo: 'caja_de_otro_dia',
        texto: `Hay una caja abierta desde otro día (${t.openedBy}). Cerrala para que el cierre de hoy tenga sentido.`,
      })
    } else {
      avisos.push({
        codigo: 'caja_abierta',
        texto: 'La caja sigue abierta. "Contaste" y "Diferencia" aparecen cuando la cierres.',
      })
    }
  }
  if (detalle.length > 1) {
    avisos.push({
      codigo: 'varios_turnos',
      texto: `Hubo ${String(detalle.length)} turnos de caja. Los números de CAJA son la suma; abajo está cada uno.`,
    })
  }

  return {
    fecha,
    esHoy: fecha === hoy,
    ventas: {
      total,
      operaciones,
      anuladas: Number(r?.anuladas ?? 0),
      ticketPromedio: operaciones === 0 ? CERO : (Number(total) / operaciones).toFixed(2),
    },
    porMedio: porMedio.map((f) => {
      const medio = f.medio ?? ''
      return {
        medio,
        etiqueta: esCuenta(medio) ? 'Fiado' : etiquetaDeMedio(medio),
        cobrado: monto(f.cobrado),
        operaciones: Number(f.operaciones ?? 0),
        entraAlCajon: esEfectivo(medio),
        esFiado: esCuenta(medio),
      }
    }),
    caja,
    turnos: detalle,
    avisos,
  }
}
