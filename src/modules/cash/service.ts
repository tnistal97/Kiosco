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
import type { Monto } from '@/lib/money'
import {
  aMonto,
  dinero,
  esNegativo,
  multiplicar,
  restar,
  sumar,
  sumaODefecto,
  type Dinero,
} from '@/server/money'

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
  amount: Monto
  paymentMethod: string
  description: string | null
  date: Date
  type: string
  saleId: number | null
  saleStatus: string | null
  saleItems: Array<{
    id: number
    quantity: number
    price: Monto
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

  const data = movimientos.map(({ sale, amount, ...mov }) => ({
    ...mov,
    amount: aMonto(amount),
    saleStatus: sale?.status ?? null,
    saleItems: sale?.items.map((i) => ({ ...i, price: aMonto(i.price) })) ?? null,
  }))

  return paginado(data, total, query)
}

export interface Saldo {
  balance: Monto
  efectivoHoy: Monto
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
    balance: aMonto(sucursal.currentCash),
    efectivoHoy: aMonto(sumaODefecto(hoy._sum.amount)),
  }
}

export interface MovimientoCreado {
  id: number
  amount: Monto
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
  // El cliente manda siempre un monto positivo; el signo lo pone el servidor.
  const importe: Dinero = multiplicar(dinero(input.amount), signo)

  return prisma.$transaction(async (tx) => {
    if (input.paymentMethod === 'efectivo') {
      const sucursal = await tx.branch.findUniqueOrThrow({
        where: { id: session.branchId },
        select: { currentCash: true },
      })

      if (signo < 0 && esNegativo(sumar(sucursal.currentCash, importe))) {
        throw conflict(
          `No se puede retirar ${aMonto(dinero(input.amount))}: ` +
            `el saldo en caja es ${aMonto(sucursal.currentCash)}`,
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

    const salida: MovimientoCreado = { ...creado, amount: aMonto(creado.amount) }

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'CashRegisterMovement',
      recordId: creado.id,
      action: 'create',
      reason: input.description ?? null,
      after: salida,
      origin: 'POST /api/cash',
    })

    return salida
  })
}

export interface ArqueoRegistrado {
  id: number
  amount: Monto
  date: Date
  notes: string | null
  esperado: Monto
  diferencia: Monto
}

/**
 * Arqueo de caja: cuanto dinero hay fisicamente en el cajon.
 *
 * El monto esperado y la diferencia los calcula el servidor. Si los mandara
 * el cliente, se podria declarar un arqueo cuadrado sobre una caja que no lo
 * esta, que es exactamente lo que un arqueo tiene que detectar.
 *
 * Desde la Fase 2 el esperado y la diferencia son columnas propias, no una
 * frase dentro de `notes`. Lo que sigue pendiente es contra QUE se compara:
 * hoy es el total corrido de la sucursal desde la instalacion, no el de un
 * turno. Eso llega con `CashSession`. Ver docs/PHASE0_DECISIONS.md.
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

    const esperado = sucursal.currentCash
    const contado = dinero(input.amount)
    const diferencia = restar(contado, esperado)

    const arqueo = await tx.cashCount.create({
      data: {
        branchId: session.branchId,
        userId: session.userId,
        amount: contado,
        expected: esperado,
        difference: diferencia,
        // `notes` vuelve a ser lo que el usuario escribio, nada mas.
        notes: input.notes ?? null,
      },
      select: { id: true, amount: true, date: true, notes: true },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'CashCount',
      recordId: arqueo.id,
      action: 'create',
      reason: input.notes ?? null,
      after: {
        contado: aMonto(contado),
        esperado: aMonto(esperado),
        diferencia: aMonto(diferencia),
        motivo: input.notes ?? null,
        branchId: session.branchId,
      },
      origin: 'POST /api/cash/count',
    })

    return {
      ...arqueo,
      amount: aMonto(arqueo.amount),
      esperado: aMonto(esperado),
      diferencia: aMonto(diferencia),
    }
  })
}

export interface ArqueoListado {
  id: number
  amount: Monto
  expected: Monto
  difference: Monto
  date: Date
  notes: string | null
  user: { id: number; name: string }
}

/**
 * Ultimos arqueos de la sucursal.
 *
 * Sin paginacion completa a proposito: la pantalla muestra los ultimos, y un
 * historial largo de arqueos es un informe, no una lista de trabajo. El tope
 * esta acotado en el esquema.
 */
export async function listarArqueos(session: Session, limite: number): Promise<ArqueoListado[]> {
  const arqueos = await prisma.cashCount.findMany({
    where: { branchId: session.branchId },
    select: {
      id: true,
      amount: true,
      expected: true,
      difference: true,
      date: true,
      notes: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: { date: 'desc' },
    take: limite,
  })

  return arqueos.map((a) => ({
    ...a,
    amount: aMonto(a.amount),
    expected: aMonto(a.expected),
    difference: aMonto(a.difference),
  }))
}
