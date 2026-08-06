/**
 * Reglas de negocio de la caja.
 *
 * Todo lo que toca `Branch.currentCash` pasa por aca. Dos invariantes:
 *
 *   1. El saldo se mueve con `increment`, nunca leyendo y reescribiendo.
 *      `increment` se traduce a `SET currentCash = currentCash + $1`, que es
 *      atomico; leer, sumar en JavaScript y escribir hace que dos operaciones
 *      simultaneas lean el mismo valor y una de las dos se pierda.
 *
 *   2. El signo lo decide el servidor a partir del tipo de movimiento. El
 *      cliente manda siempre un monto positivo.
 */

import { prisma } from '@/lib/prisma'
import { audit } from '@/server/audit/audit'
import { conflict, invalid, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { ArqueoInput, ListarMovimientosQuery, MovimientoManualInput } from './schemas'

/** Redondeo a dos decimales, en el mismo punto para todos los importes. */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

const CAMPOS_MOVIMIENTO = {
  id: true,
  amount: true,
  paymentMethod: true,
  description: true,
  date: true,
  type: true,
  saleId: true,
  user: { select: { id: true, name: true } },
  sale: {
    select: {
      id: true,
      status: true,
      items: {
        select: {
          id: true,
          quantity: true,
          price: true,
          product: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const

export interface MovimientoListado {
  id: number
  amount: number
  paymentMethod: string
  description: string | null
  date: Date
  type: string
  saleId: number | null
  saleStatus: string | null
  saleItems: Array<{
    id: number
    quantity: number
    price: number
    product: { id: number; name: string }
  }> | null
  user: { id: number; name: string }
}

/**
 * Movimientos de la sucursal, paginados.
 *
 * Los items de cada venta se traen con un `include` sobre la relacion `sale`,
 * no con una consulta por movimiento: con 26 movimientos eran 27 consultas.
 * La relacion se resuelve por la clave foranea `saleId`, no parseando
 * "Venta #123" del texto de la descripcion.
 */
export async function listarMovimientos(
  session: Session,
  query: ListarMovimientosQuery,
): Promise<Paginated<MovimientoListado>> {
  const ahora = new Date()
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())
  const finHoy = new Date(inicioHoy.getTime() + 24 * 60 * 60 * 1000 - 1)
  // `dias: 2` significa ayer y hoy, que es lo que muestra la pantalla.
  const desde = new Date(inicioHoy.getTime() - (query.dias - 1) * 24 * 60 * 60 * 1000)

  const where = {
    branchId: session.branchId,
    date: { gte: desde, lte: finHoy },
    ...(query.tipo === 'todos' ? {} : { type: query.tipo }),
  }

  const [total, movimientos] = await Promise.all([
    prisma.cashRegisterMovement.count({ where }),
    prisma.cashRegisterMovement.findMany({
      where,
      select: CAMPOS_MOVIMIENTO,
      orderBy: { date: 'desc' },
      ...toSkipTake(query),
    }),
  ])

  const data = movimientos.map(({ sale, ...mov }) => ({
    ...mov,
    saleStatus: sale?.status ?? null,
    saleItems: sale?.items ?? null,
  }))

  return paginado(data, total, query)
}

export interface Saldo {
  balance: number
  efectivoHoy: number
}

export async function saldoActual(session: Session): Promise<Saldo> {
  const sucursal = await prisma.branch.findUnique({
    where: { id: session.branchId },
    select: { currentCash: true },
  })
  if (!sucursal) throw notFound('Sucursal no encontrada')

  const ahora = new Date()
  const inicioHoy = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate())

  const hoy = await prisma.cashRegisterMovement.aggregate({
    where: {
      branchId: session.branchId,
      paymentMethod: 'efectivo',
      date: { gte: inicioHoy },
    },
    _sum: { amount: true },
  })

  return {
    balance: sucursal.currentCash,
    efectivoHoy: hoy._sum.amount ?? 0,
  }
}

export interface MovimientoCreado {
  id: number
  amount: number
  paymentMethod: string
  description: string | null
  date: Date
  type: string
}

/**
 * Movimiento manual: ingreso, retiro o deposito.
 *
 * La version anterior guardaba el movimiento y no tocaba `currentCash`, asi
 * que el saldo que mostraba la pantalla nunca reflejaba los retiros.
 */
export async function registrarMovimientoManual(
  session: Session,
  input: MovimientoManualInput,
): Promise<MovimientoCreado> {
  // Un retiro o un deposito solo tienen sentido en efectivo: mueven el dinero
  // fisico del cajon.
  if (input.movementType !== 'ingreso' && input.paymentMethod !== 'efectivo') {
    throw invalid('Los retiros y depositos solo aplican a movimientos en efectivo')
  }

  const signo = input.movementType === 'retiro' ? -1 : 1
  const importe = redondear(input.amount * signo)

  return prisma.$transaction(async (tx) => {
    if (input.paymentMethod === 'efectivo') {
      const sucursal = await tx.branch.findUniqueOrThrow({
        where: { id: session.branchId },
        select: { currentCash: true },
      })

      if (signo < 0 && sucursal.currentCash + importe < 0) {
        throw conflict(
          `No se puede retirar ${input.amount}: el saldo en caja es ${sucursal.currentCash}`,
          { code: 'INSUFFICIENT_CASH' },
        )
      }

      await tx.branch.update({
        where: { id: session.branchId },
        data: { currentCash: { increment: importe } },
      })
    }

    const creado = await tx.cashRegisterMovement.create({
      data: {
        branchId: session.branchId,
        userId: session.userId,
        amount: importe,
        paymentMethod: input.paymentMethod,
        description: input.description ?? '',
        type: input.movementType,
      },
      select: {
        id: true,
        amount: true,
        paymentMethod: true,
        description: true,
        date: true,
        type: true,
      },
    })

    await audit(tx, {
      userId: session.userId,
      table: 'CashRegisterMovement',
      recordId: creado.id,
      action: 'create',
      after: creado,
      origin: 'POST /api/cash',
    })

    return creado
  })
}

export interface ArqueoRegistrado {
  id: number
  amount: number
  date: Date
  notes: string | null
  esperado: number
  diferencia: number
}

/**
 * Arqueo de caja: cuanto dinero hay fisicamente en el cajon.
 *
 * El monto esperado y la diferencia los calcula el servidor. Si los mandara
 * el cliente, se podria declarar un arqueo cuadrado sobre una caja que no lo
 * esta, que es exactamente lo que un arqueo tiene que detectar.
 *
 * Los dos valores calculados se guardan hoy dentro de `notes`, porque
 * `CashCount` solo tiene la columna `amount`. Es una solucion provisoria: no
 * se puede consultar "arqueos con diferencia mayor a X" sin leer texto. Pasan
 * a columnas propias junto con `CashSession`, cuando el arqueo deje de
 * compararse contra el total corrido desde la instalacion y pase a compararse
 * contra un turno real. Ver docs/PHASE0_DECISIONS.md.
 */
export async function registrarArqueo(
  session: Session,
  input: ArqueoInput,
): Promise<ArqueoRegistrado> {
  return prisma.$transaction(async (tx) => {
    const sucursal = await tx.branch.findUniqueOrThrow({
      where: { id: session.branchId },
      select: { currentCash: true },
    })

    const esperado = redondear(sucursal.currentCash)
    const contado = redondear(input.amount)
    const diferencia = redondear(contado - esperado)

    const notas = [
      input.notes,
      `Esperado: ${esperado}. Contado: ${contado}. Diferencia: ${diferencia}.`,
    ]
      .filter(Boolean)
      .join(' | ')

    const arqueo = await tx.cashCount.create({
      data: {
        branchId: session.branchId,
        userId: session.userId,
        amount: contado,
        notes: notas,
      },
      select: { id: true, amount: true, date: true, notes: true },
    })

    await audit(tx, {
      userId: session.userId,
      table: 'CashCount',
      recordId: arqueo.id,
      action: 'create',
      after: {
        contado,
        esperado,
        diferencia,
        motivo: input.notes ?? null,
        branchId: session.branchId,
      },
      origin: 'POST /api/cash/count',
    })

    return { ...arqueo, esperado, diferencia }
  })
}
