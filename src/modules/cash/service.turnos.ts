/**
 * Turnos de caja.
 *
 * La invariante que gobierna el modulo:
 *
 *   EL SALDO ESPERADO SE DERIVA, NO SE GUARDA.
 *
 *   esperado = openingAmount + Σ (movimientos en efectivo de ESTE turno)
 *
 * Guardarlo en una columna obligaria a mantenerlo sincronizado en cada venta,
 * cada retiro y cada anulacion, y el dia que un camino se olvide de tocarlo el
 * numero deja de significar nada. Eso es exactamente lo que pasaba con
 * `Branch.currentCash`, que la Fase 2 tuvo que tapar con una advertencia.
 *
 * Al CERRAR, el derivado se congela en `expectedAmount`. Ahi si es una columna
 * y es correcta: un turno cerrado no vuelve a cambiar.
 *
 * Ver docs/CASH_SHIFT_MODEL.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, forbidden, invalid, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Monto } from '@/lib/money'
import {
  aMonto,
  absoluto,
  comparar,
  dinero,
  restar,
  sumar,
  sumaODefecto,
  type Dinero,
} from '@/server/money'
import type { AbrirTurnoInput, CerrarTurnoInput, ListarTurnosQuery } from './schemas'
import { MEDIO_EFECTIVO } from '@/modules/sales/payment-methods'

/** Cliente de Prisma o de una transaccion. Todo lo de aca acepta los dos. */
type Cliente = Prisma.TransactionClient | typeof prisma

export interface TurnoAbierto {
  id: number
  openedAt: Date
  openingAmount: Dinero
  openedById: number
}

const CAMPOS_TURNO_ABIERTO = {
  id: true,
  openedAt: true,
  openingAmount: true,
  openedById: true,
} as const

/**
 * El turno abierto de la sucursal, o null.
 *
 * Un turno `legacy` NO cuenta: existe para colgarle la historia anterior, y al
 * dia siguiente de migrar la sucursal necesita abrir una caja de verdad.
 */
export async function turnoAbiertoDe(
  cliente: Cliente,
  branchId: number,
): Promise<TurnoAbierto | null> {
  return cliente.cashShift.findFirst({
    where: { branchId, status: 'open' },
    select: CAMPOS_TURNO_ABIERTO,
  })
}

/**
 * Exige un turno abierto, si la sucursal lo pide.
 *
 * Devuelve el turno --o null cuando la politica esta apagada-- para que quien
 * llama enganche el `shiftId` en lo que registre.
 *
 * El mensaje dice QUE HACER, no que algo fallo: quien lo lee esta con un
 * cliente enfrente.
 */
export async function turnoParaOperar(
  cliente: Cliente,
  branchId: number,
): Promise<TurnoAbierto | null> {
  const sucursal = await cliente.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { requireOpenShift: true },
  })

  const turno = await turnoAbiertoDe(cliente, branchId)
  if (turno) return turno

  if (sucursal.requireOpenShift) {
    throw conflict('No hay una caja abierta. Abrí la caja antes de vender.', {
      code: 'NO_OPEN_SHIFT',
    })
  }
  return null
}

/**
 * Saldo esperado de un turno: lo que TIENE que haber en el cajon.
 *
 * Solo efectivo. Una venta con transferencia no entra al cajon, asi que no
 * mueve este numero. Es la regla que hace que el arqueo signifique algo.
 */
export async function saldoEsperadoDe(
  cliente: Cliente,
  turno: { id: number; openingAmount: Dinero },
): Promise<Dinero> {
  const efectivo = await cliente.cashRegisterMovement.aggregate({
    where: { shiftId: turno.id, paymentMethod: MEDIO_EFECTIVO },
    _sum: { amount: true },
  })
  return sumar(turno.openingAmount, sumaODefecto(efectivo._sum.amount))
}

export interface ResumenTurno {
  id: number
  status: string
  openedAt: Date
  closedAt: Date | null
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
  /** Cuanto entro y salio, para no tener que abrir el listado. */
  ventasEnEfectivo: Monto
  ingresos: Monto
  egresos: Monto
  cantidadDeVentas: number
}

const CAMPOS_TURNO = {
  id: true,
  status: true,
  openedAt: true,
  closedAt: true,
  openingAmount: true,
  expectedAmount: true,
  countedAmount: true,
  difference: true,
  openingNotes: true,
  closingNotes: true,
  openedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  authorizedBy: { select: { id: true, name: true } },
} as const

type TurnoCrudo = Prisma.CashShiftGetPayload<{ select: typeof CAMPOS_TURNO }>

/**
 * Totales de un turno en UNA consulta agregada por tipo.
 *
 * Con `groupBy` en vez de cuatro `aggregate`: el historial muestra diez turnos
 * por pagina y cuatro consultas por turno serian cuarenta.
 */
async function totalesDe(
  cliente: Cliente,
  shiftIds: number[],
): Promise<Map<number, { ventas: Dinero; ingresos: Dinero; egresos: Dinero; cuantas: number }>> {
  const salida = new Map<
    number,
    { ventas: Dinero; ingresos: Dinero; egresos: Dinero; cuantas: number }
  >()
  if (shiftIds.length === 0) return salida

  const filas = await cliente.cashRegisterMovement.groupBy({
    by: ['shiftId', 'type'],
    where: { shiftId: { in: shiftIds }, paymentMethod: MEDIO_EFECTIVO },
    _sum: { amount: true },
    _count: { _all: true },
  })

  for (const id of shiftIds) {
    salida.set(id, { ventas: dinero(0), ingresos: dinero(0), egresos: dinero(0), cuantas: 0 })
  }

  for (const fila of filas) {
    if (fila.shiftId === null) continue
    const acumulado = salida.get(fila.shiftId)
    if (!acumulado) continue

    const monto = sumaODefecto(fila._sum.amount)
    if (fila.type === 'sale') {
      acumulado.ventas = sumar(acumulado.ventas, monto)
      acumulado.cuantas += fila._count._all
    } else if (fila.type === 'sale_cancel' || fila.type === 'retiro') {
      acumulado.egresos = sumar(acumulado.egresos, monto)
    } else {
      acumulado.ingresos = sumar(acumulado.ingresos, monto)
    }
  }

  return salida
}

async function aResumen(cliente: Cliente, turnos: TurnoCrudo[]): Promise<ResumenTurno[]> {
  const totales = await totalesDe(
    cliente,
    turnos.map((t) => t.id),
  )

  // El esperado de los turnos ABIERTOS se deriva; el de los cerrados ya esta
  // congelado en la columna y no se recalcula: si un movimiento se colara
  // despues del cierre, recalcular reescribiria la historia en silencio.
  const salida: ResumenTurno[] = []
  for (const t of turnos) {
    const acumulado = totales.get(t.id)
    const esperado =
      t.expectedAmount ??
      (t.status === 'open' ? await saldoEsperadoDe(cliente, t) : t.openingAmount)

    salida.push({
      id: t.id,
      status: t.status,
      openedAt: t.openedAt,
      closedAt: t.closedAt,
      openingAmount: aMonto(t.openingAmount),
      expectedAmount: aMonto(esperado),
      countedAmount: t.countedAmount === null ? null : aMonto(t.countedAmount),
      difference: t.difference === null ? null : aMonto(t.difference),
      openedBy: t.openedBy,
      closedBy: t.closedBy,
      authorizedBy: t.authorizedBy,
      openingNotes: t.openingNotes,
      closingNotes: t.closingNotes,
      ventasEnEfectivo: aMonto(acumulado?.ventas ?? dinero(0)),
      ingresos: aMonto(acumulado?.ingresos ?? dinero(0)),
      egresos: aMonto(acumulado?.egresos ?? dinero(0)),
      cantidadDeVentas: acumulado?.cuantas ?? 0,
    })
  }
  return salida
}

/** El turno de la sucursal tal como lo necesita la pantalla. `null` si no hay. */
export async function turnoActual(session: Session): Promise<ResumenTurno | null> {
  const turno = await prisma.cashShift.findFirst({
    where: { branchId: session.branchId, status: 'open' },
    select: CAMPOS_TURNO,
  })
  if (!turno) return null

  const [resumen] = await aResumen(prisma, [turno])
  return resumen ?? null
}

/** Politica de caja de la sucursal. La pantalla la necesita para saber que ofrecer. */
export async function politicaDeCaja(
  session: Session,
): Promise<{ requiereTurno: boolean; umbralDiferencia: Monto }> {
  const sucursal = await prisma.branch.findUniqueOrThrow({
    where: { id: session.branchId },
    select: { requireOpenShift: true, cashDifferenceThreshold: true },
  })
  return {
    requiereTurno: sucursal.requireOpenShift,
    umbralDiferencia: aMonto(sucursal.cashDifferenceThreshold),
  }
}

/**
 * Abre la caja.
 *
 * La unicidad NO se comprueba con un `SELECT` previo: dos peticiones
 * simultaneas pasarian las dos. La garantiza un indice unico parcial en
 * PostgreSQL, y aca se traduce la violacion a un mensaje legible.
 */
export async function abrirTurno(session: Session, input: AbrirTurnoInput): Promise<ResumenTurno> {
  return prisma.$transaction(async (tx) => {
    let turno: TurnoCrudo
    try {
      turno = await tx.cashShift.create({
        data: {
          branchId: session.branchId,
          openedById: session.userId,
          openingAmount: dinero(input.openingAmount),
          openingNotes: input.notes ?? null,
          status: 'open',
        },
        select: CAMPOS_TURNO,
      })
    } catch (err) {
      if (esViolacionDeUnicidad(err)) {
        throw conflict('Ya hay una caja abierta en esta sucursal.', { code: 'SHIFT_ALREADY_OPEN' })
      }
      throw err
    }

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'CashShift',
      recordId: turno.id,
      action: 'open',
      reason: input.notes ?? null,
      after: {
        turno: turno.id,
        montoInicial: aMonto(turno.openingAmount),
        abiertoPor: session.userId,
      },
      origin: 'POST /api/cash/shift',
    })

    const [resumen] = await aResumen(tx, [turno])
    if (!resumen) throw new Error('No se pudo resumir el turno recien abierto')
    return resumen
  })
}

export interface CierreDeTurno {
  turno: ResumenTurno
  /** Verdadero cuando la diferencia supero el umbral y hubo que autorizarla. */
  necesitoAutorizacion: boolean
}

/**
 * Cierra la caja.
 *
 * El esperado lo calcula el servidor y se congela; el contado lo trae quien
 * cuenta. Si el cliente mandara el esperado se podria declarar un cierre
 * cuadrado sobre una caja que no lo esta, que es justo lo que el cierre tiene
 * que detectar.
 */
export async function cerrarTurno(
  session: Session,
  shiftId: number,
  input: CerrarTurnoInput,
): Promise<CierreDeTurno> {
  return prisma.$transaction(async (tx) => {
    const turno = await tx.cashShift.findUnique({
      where: { id: shiftId },
      select: { ...CAMPOS_TURNO, branchId: true, openedById: true },
    })

    if (!turno) throw notFound('El turno no existe')
    // Mismo trato que "no existe": no se confirma que exista en otra sucursal.
    if (turno.branchId !== session.branchId) throw notFound('El turno no existe')

    if (turno.status === 'legacy') {
      throw conflict(
        'El turno histórico no se cierra: agrupa lo anterior a que existieran los turnos.',
        { code: 'LEGACY_SHIFT' },
      )
    }
    if (turno.status !== 'open') throw conflict('El turno ya estaba cerrado')

    if (turno.openedById !== session.userId && !session.permissions.has('cash.shift.close.other')) {
      throw forbidden('No tiene permiso para cerrar el turno de otra persona')
    }

    const esperado = await saldoEsperadoDe(tx, turno)
    const contado = dinero(input.countedAmount)
    const diferencia = restar(contado, esperado)

    // Umbral: por encima, hace falta que alguien con permiso lo autorice.
    const sucursal = await tx.branch.findUniqueOrThrow({
      where: { id: session.branchId },
      select: { cashDifferenceThreshold: true },
    })
    const umbral = sucursal.cashDifferenceThreshold
    const superaUmbral =
      comparar(umbral, dinero(0)) > 0 && comparar(absoluto(diferencia), umbral) > 0

    let autorizadoPor: number | null = null
    if (superaUmbral) {
      if (!input.autorizar) {
        throw conflict(
          `La diferencia es de ${aMonto(absoluto(diferencia))} y supera el límite de ` +
            `${aMonto(umbral)}. Necesita que un responsable la autorice.`,
          { code: 'DIFFERENCE_NEEDS_AUTHORIZATION' },
        )
      }
      if (!session.permissions.has('cash.shift.authorize')) {
        throw forbidden('No tiene permiso para autorizar una diferencia de caja')
      }
      autorizadoPor = session.userId
    }

    // El UPDATE va condicionado al estado: dos cierres simultaneos y el
    // segundo afecta 0 filas.
    const cerradas = await tx.$executeRaw`
      UPDATE "CashShift"
      SET "status" = 'closed',
          "closedAt" = NOW(),
          "closedById" = ${session.userId},
          "expectedAmount" = ${esperado.toFixed(2)}::numeric,
          "countedAmount" = ${contado.toFixed(2)}::numeric,
          "difference" = ${diferencia.toFixed(2)}::numeric,
          "closingNotes" = ${input.notes ?? null},
          "authorizedById" = ${autorizadoPor}
      WHERE "id" = ${shiftId} AND "status" = 'open'
    `
    if (cerradas !== 1) throw conflict('El turno ya estaba cerrado')

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'CashShift',
      recordId: shiftId,
      action: 'close',
      reason: input.notes ?? null,
      before: { estado: 'open', montoInicial: aMonto(turno.openingAmount) },
      after: {
        estado: 'closed',
        esperado: aMonto(esperado),
        contado: aMonto(contado),
        diferencia: aMonto(diferencia),
        superaUmbral,
        autorizadoPor,
        cerradoPor: session.userId,
      },
      origin: 'POST /api/cash/shift/:id/close',
    })

    const cerrado = await tx.cashShift.findUniqueOrThrow({
      where: { id: shiftId },
      select: CAMPOS_TURNO,
    })
    const [resumen] = await aResumen(tx, [cerrado])
    if (!resumen) throw new Error('No se pudo resumir el turno cerrado')

    return { turno: resumen, necesitoAutorizacion: superaUmbral }
  })
}

/** Historial de turnos de la sucursal, paginado. */
export async function listarTurnos(
  session: Session,
  query: ListarTurnosQuery,
): Promise<Paginated<ResumenTurno>> {
  const where: Prisma.CashShiftWhereInput = {
    branchId: session.branchId,
    ...(query.estado === 'todos' ? {} : { status: query.estado }),
  }

  const [total, turnos] = await Promise.all([
    prisma.cashShift.count({ where }),
    prisma.cashShift.findMany({
      where,
      select: CAMPOS_TURNO,
      orderBy: { openedAt: 'desc' },
      ...toSkipTake(query),
    }),
  ])

  return paginado(await aResumen(prisma, turnos), total, query)
}

/**
 * Violacion de unicidad de PostgreSQL, a traves de Prisma.
 *
 * Se mira el codigo `P2002` sin importar `@prisma/client` para el tipo: la
 * forma del error es estable y afirmar el tipo obligaria a un `instanceof`
 * contra una clase que cambia de nombre entre versiones.
 */
function esViolacionDeUnicidad(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  )
}

/** Motivo obligatorio, ya recortado. Compartido por apertura y cierre. */
export function exigirMotivo(texto: string | null | undefined, que: string): string {
  const limpio = (texto ?? '').trim()
  if (!limpio) throw invalid(`${que} es obligatorio`)
  return limpio
}
