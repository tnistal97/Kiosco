/**
 * Operaciones sobre la cuenta corriente: cobrar, ajustar y leer el extracto.
 *
 * Este archivo NO escribe saldos: se los pide a `applyAccountMovement`, que es
 * la unica puerta. Lo que hace es lo que la puerta no tiene por que saber: de
 * donde sale el numero de comprobante, si el cobro entra al cajon, quien
 * autorizo y que queda en la bitacora.
 *
 * Ver docs/CUSTOMER_PAYMENT_FLOW.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { Monto } from '@/lib/money'
import { CERO_D, aMonto, absoluto, dinero, esNegativo, negar, restar } from '@/server/money'
import { esEfectivo, etiquetaDeMedio, type MedioDeCobranza } from '@/modules/sales/payment-methods'
import { turnoParaOperar } from '@/modules/cash/service.turnos'
import { applyAccountMovement } from './cuenta'
import { etiquetaDeCuenta } from './movement-types'
import { clientePorId } from './service'
import type {
  AjustarCuentaInput,
  ListarMovimientosCuentaQuery,
  RegistrarPagoInput,
} from './schemas'

// ---------------------------------------------------------------------------
// Numeracion
// ---------------------------------------------------------------------------

/**
 * El siguiente numero de comprobante. `RC-00000182`.
 *
 * Sale de una SECUENCIA de PostgreSQL, no de `count() + 1`, por lo mismo que el
 * numero de orden de compra: dos personas cobrando en el mismo segundo leerian
 * el mismo count() y el indice unico rechazaria a una de las dos.
 *
 * Se pide FUERA de la transaccion a proposito: `nextval` no se deshace con un
 * ROLLBACK, asi que pedirlo adentro no evitaria el hueco y solo alargaria la
 * transaccion.
 */
async function siguienteNumeroDeRecibo(): Promise<string> {
  const filas = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT nextval('"CustomerPayment_numero_seq"') AS n
  `
  const n = filas[0]?.n
  if (n === undefined) throw new Error('No se pudo obtener el numero de comprobante')
  return `RC-${String(n).padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// Cobro
// ---------------------------------------------------------------------------

export interface ComprobanteDePago {
  id: number
  number: string
  clientId: number
  clientName: string
  amount: Monto
  method: MedioDeCobranza
  /** Nombre para mostrar. El codigo crudo no llega a la pantalla. */
  methodLabel: string
  previousBalance: Monto
  resultingBalance: Monto
  /** Cuanto queda a favor del cliente. `"0.00"` si el saldo no quedo negativo. */
  saldoAFavor: Monto
  reference: string | null
  notes: string | null
  receivedBy: { id: number; name: string }
  /** Turno en el que entro, si entro al cajon. */
  shiftId: number | null
  /** Si esta plata aumento el efectivo del cajon. */
  entroACaja: boolean
  createdAt: Date
}

/**
 * Registra un pago del cliente.
 *
 * Las tres cosas ocurren juntas o no ocurren:
 *
 *   1. el comprobante (`CustomerPayment`),
 *   2. el movimiento del libro, que baja el saldo,
 *   3. el movimiento de caja, SOLO si se cobro en efectivo.
 *
 * No existe forma de crear un pago sin su movimiento de cuenta: es la misma
 * transaccion y no hay otro camino que escriba `CustomerPayment`.
 *
 * SOBREPAGO. Se permite --el cliente redondea para arriba, y prohibirlo
 * obligaria a rechazar plata que ya esta sobre el mostrador-- pero nunca en
 * silencio: sin `aceptarSaldoAFavor` la operacion se rechaza con un 409 que
 * dice cuanto sobra. Es el mismo mecanismo que la autorizacion de una
 * diferencia de arqueo, y por el mismo motivo: lo que hay que evitar no es el
 * caso, es que ocurra sin que nadie lo haya visto.
 */
export async function registrarPago(
  session: Session,
  clientId: number,
  input: RegistrarPagoInput,
): Promise<ComprobanteDePago> {
  const cliente = await clientePorId(session, clientId)
  const importe = dinero(input.amount)

  // El sobrepago se comprueba ANTES de abrir la transaccion para poder decir
  // cuanto sobra sin haber tocado nada. Se vuelve a mirar adentro: entre esta
  // lectura y el cobro puede entrar una venta a cuenta que cambie el saldo, y
  // en ese caso lo que aca era sobrepago ya no lo es.
  const sobra = restar(importe, cliente.balance)
  if (sobra.greaterThan(CERO_D) && !input.aceptarSaldoAFavor) {
    const debe = cliente.balance.greaterThan(CERO_D) ? cliente.balance : CERO_D
    throw conflict(
      `${cliente.name} debe ${aMonto(debe)} y el pago es de ${aMonto(importe)}: ` +
        `quedan ${aMonto(sobra)} a favor. Confirmá para registrarlo así.`,
      { code: 'PAYMENT_LEAVES_CREDIT' },
    )
  }

  const number = await siguienteNumeroDeRecibo()

  return prisma.$transaction(async (tx) => {
    // El turno se pide antes de mover nada, igual que en la venta: rechazar el
    // cobro despues de haber bajado el saldo obligaria a devolverlo.
    //
    // Solo hace falta si la plata ENTRA al cajon. Una transferencia no toca la
    // caja, asi que no tiene por que exigir un turno abierto: cobrar por
    // transferencia con la caja cerrada es una operacion legitima.
    const turno = esEfectivo(input.method) ? await turnoParaOperar(tx, session.branchId) : null

    const pago = await tx.customerPayment.create({
      data: {
        number,
        branchId: session.branchId,
        clientId,
        amount: importe,
        method: input.method,
        cashShiftId: turno?.id ?? null,
        receivedById: session.userId,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true, createdAt: true },
    })

    // El movimiento del libro. NEGATIVO: un pago reduce lo que el cliente debe.
    const movimiento = await applyAccountMovement(tx, {
      branchId: session.branchId,
      clientId,
      type: 'PAYMENT',
      amount: negar(importe),
      userId: session.userId,
      paymentId: pago.id,
    })

    // Segunda comprobacion del sobrepago, ya con el saldo real y bajo el
    // bloqueo de fila que tomo el libro. Sin esto, una venta a cuenta que
    // entrara entre la lectura de arriba y esta transaccion dejaria pasar un
    // saldo a favor que nadie confirmo.
    if (esNegativo(movimiento.resultingBalance) && !input.aceptarSaldoAFavor) {
      throw conflict(
        `El saldo cambió mientras se cobraba: el pago dejaría ` +
          `${aMonto(absoluto(movimiento.resultingBalance))} a favor. Confirmá para registrarlo así.`,
        { code: 'PAYMENT_LEAVES_CREDIT' },
      )
    }

    // La caja recibe SOLO el efectivo. Una transferencia baja el saldo del
    // cliente y no aumenta el cajon: es la misma regla que en la venta, y es lo
    // que pide el objetivo 29.
    if (esEfectivo(input.method)) {
      await tx.cashRegisterMovement.create({
        data: {
          branchId: session.branchId,
          userId: session.userId,
          amount: importe,
          paymentMethod: input.method,
          description: `Cobro ${number} · ${cliente.name}`,
          type: 'customer_payment',
          shiftId: turno?.id ?? null,
          // El vinculo de verdad. La descripcion es para leerla en el listado
          // de caja; esto es lo que usa la reconciliacion para unir las dos
          // tablas sin tener que parsear una frase.
          customerPaymentId: pago.id,
        },
      })

      await tx.branch.update({
        where: { id: session.branchId },
        data: { currentCash: { increment: importe } },
      })
    }

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'CustomerPayment',
      recordId: pago.id,
      action: 'create',
      after: {
        numero: number,
        clientId,
        cliente: cliente.name,
        importe: aMonto(importe),
        medio: input.method,
        turno: turno?.id ?? null,
        saldoAnterior: aMonto(movimiento.previousBalance),
        saldoNuevo: aMonto(movimiento.resultingBalance),
        movimientoId: movimiento.movementId,
      },
      origin: 'POST /api/clients/:id/pagos',
    })

    return {
      id: pago.id,
      number,
      clientId,
      clientName: cliente.name,
      amount: aMonto(importe),
      method: input.method,
      methodLabel: etiquetaDeMedio(input.method),
      previousBalance: aMonto(movimiento.previousBalance),
      resultingBalance: aMonto(movimiento.resultingBalance),
      saldoAFavor: esNegativo(movimiento.resultingBalance)
        ? aMonto(absoluto(movimiento.resultingBalance))
        : aMonto(CERO_D),
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      receivedBy: { id: session.userId, name: session.name },
      shiftId: turno?.id ?? null,
      entroACaja: esEfectivo(input.method),
      createdAt: pago.createdAt,
    }
  })
}

// ---------------------------------------------------------------------------
// Ajuste manual
// ---------------------------------------------------------------------------

/**
 * Corrige un saldo con un movimiento nuevo.
 *
 * Se declara el DELTA, no el saldo final, y esa diferencia es todo el punto:
 * "sumale 2.000 por deuda anterior a la migracion" deja un movimiento que se
 * entiende dentro de dos anios; "poneme el saldo en 7.000" no dice de donde
 * salieron los 2.000 ni contra que saldo se estaba operando.
 *
 * NO comprueba el limite de credito. Un ajuste es una correccion
 * administrativa, no una venta: cargar la deuda historica de alguien que ya
 * debia mas que su limite tiene que poder hacerse, y el permiso
 * (`accounts.adjust`) es lo que lo restringe.
 */
export async function ajustarCuenta(session: Session, clientId: number, input: AjustarCuentaInput) {
  const cliente = await clientePorId(session, clientId)
  const delta = dinero(input.delta)

  return prisma.$transaction(async (tx) => {
    const movimiento = await applyAccountMovement(tx, {
      branchId: session.branchId,
      clientId,
      type: 'MANUAL_ADJUSTMENT',
      amount: delta,
      userId: session.userId,
      reason: input.reason,
      // Un ajuste no pasa por el limite --ver arriba-- y por eso viaja con el
      // autorizante puesto: es la forma que tiene `applyAccountMovement` de
      // saber que esta comprobacion no corresponde. Queda registrado quien lo
      // hizo, que es lo que importa.
      authorizedById: session.userId,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'CustomerAccountMovement',
      recordId: movimiento.movementId,
      action: 'create',
      reason: input.reason,
      before: { saldo: aMonto(movimiento.previousBalance) },
      after: {
        tipo: 'MANUAL_ADJUSTMENT',
        clientId,
        cliente: cliente.name,
        delta: aMonto(delta),
        saldo: aMonto(movimiento.resultingBalance),
        motivo: input.reason,
      },
      origin: 'POST /api/clients/:id/ajuste',
    })

    return {
      movementId: movimiento.movementId,
      clientId,
      clientName: cliente.name,
      delta: aMonto(delta),
      previousBalance: aMonto(movimiento.previousBalance),
      resultingBalance: aMonto(movimiento.resultingBalance),
      reason: input.reason,
    }
  })
}

// ---------------------------------------------------------------------------
// Lectura del extracto
// ---------------------------------------------------------------------------

export interface MovimientoDeCuenta {
  id: number
  createdAt: Date
  type: string
  typeLabel: string
  amount: Monto
  previousBalance: Monto
  resultingBalance: Monto
  saleId: number | null
  paymentId: number | null
  /** El numero del comprobante, cuando el movimiento vino de un cobro. */
  paymentNumber: string | null
  reason: string | null
  user: { id: number; name: string }
  authorizedBy: { id: number; name: string } | null
}

/**
 * El extracto del cliente, paginado y en orden cronologico inverso.
 *
 * Siempre paginado: un cliente de dos anios tiene cientos de movimientos, y no
 * existe endpoint que devuelva el libro entero.
 *
 * Usuario, autorizante y comprobante vienen con un `select` anidado en la misma
 * consulta. Resolverlos despues, de a uno, seria una consulta por fila.
 */
export async function listarMovimientosDeCuenta(
  session: Session,
  clientId: number,
  query: ListarMovimientosCuentaQuery,
): Promise<Paginated<MovimientoDeCuenta>> {
  // Comprueba que el cliente sea de esta sucursal antes de leer nada suyo.
  await clientePorId(session, clientId)

  const where: Prisma.CustomerAccountMovementWhereInput = {
    clientId,
    branchId: session.branchId,
    ...(query.tipo === 'todos' ? {} : { type: query.tipo }),
  }

  const [total, movimientos] = await Promise.all([
    prisma.customerAccountMovement.count({ where }),
    prisma.customerAccountMovement.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        type: true,
        amount: true,
        previousBalance: true,
        resultingBalance: true,
        saleId: true,
        paymentId: true,
        reason: true,
        user: { select: { id: true, name: true } },
        authorizedBy: { select: { id: true, name: true } },
        payment: { select: { number: true } },
      },
      // Por fecha descendente y, a igualdad de fecha, por id: una venta y su
      // cargo comparten el milisegundo, y sin el segundo criterio el orden
      // entre dos movimientos cambiaria de una consulta a otra.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = movimientos.map(({ payment, ...m }) => ({
    ...m,
    typeLabel: etiquetaDeCuenta(m.type),
    amount: aMonto(m.amount),
    previousBalance: aMonto(m.previousBalance),
    resultingBalance: aMonto(m.resultingBalance),
    paymentNumber: payment?.number ?? null,
  }))

  return paginado(data, total, query)
}

/** Los cobros de un cliente, paginados. Para la ficha y para reimprimir. */
export async function listarPagosDeCliente(
  session: Session,
  clientId: number,
  query: { page: number; pageSize: number },
) {
  await clientePorId(session, clientId)

  const where: Prisma.CustomerPaymentWhereInput = { clientId, branchId: session.branchId }

  const [total, pagos] = await Promise.all([
    prisma.customerPayment.count({ where }),
    prisma.customerPayment.findMany({
      where,
      select: {
        id: true,
        number: true,
        amount: true,
        method: true,
        reference: true,
        notes: true,
        createdAt: true,
        cashShiftId: true,
        receivedBy: { select: { id: true, name: true } },
        movements: { select: { previousBalance: true, resultingBalance: true }, take: 1 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = pagos.map(({ movements, ...p }) => ({
    id: p.id,
    number: p.number,
    amount: aMonto(p.amount),
    method: p.method,
    methodLabel: etiquetaDeMedio(p.method),
    reference: p.reference,
    notes: p.notes,
    createdAt: p.createdAt,
    shiftId: p.cashShiftId,
    receivedBy: p.receivedBy,
    entroACaja: esEfectivo(p.method),
    previousBalance: movements[0] ? aMonto(movements[0].previousBalance) : null,
    resultingBalance: movements[0] ? aMonto(movements[0].resultingBalance) : null,
  }))

  return paginado(data, total, query)
}

/** Las ventas de un cliente, paginadas. La tercera lista de la ficha. */
export async function listarVentasDeCliente(
  session: Session,
  clientId: number,
  query: { page: number; pageSize: number },
) {
  await clientePorId(session, clientId)

  const where: Prisma.SaleWhereInput = { clientId, branchId: session.branchId }

  const [total, ventas] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.findMany({
      where,
      select: {
        id: true,
        date: true,
        total: true,
        status: true,
        payments: { select: { method: true, amount: true } },
        _count: { select: { items: true } },
      },
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = ventas.map((v) => ({
    id: v.id,
    date: v.date,
    total: aMonto(v.total),
    status: v.status,
    items: v._count.items,
    // Cuanto de esta venta fue a cuenta. Es el dato que distingue "compro y
    // pago" de "compro y quedo debiendo" sin tener que abrir el ticket.
    aCuenta: aMonto(
      v.payments
        .filter((p) => p.method === 'ACCOUNT')
        .reduce((total, p) => total.plus(p.amount), CERO_D),
    ),
  }))

  return paginado(data, total, query)
}

/** Un comprobante por id, para reimprimirlo. */
export async function obtenerComprobante(session: Session, paymentId: number) {
  const pago = await prisma.customerPayment.findFirst({
    where: { id: paymentId, branchId: session.branchId },
    select: {
      id: true,
      number: true,
      amount: true,
      method: true,
      reference: true,
      notes: true,
      createdAt: true,
      cashShiftId: true,
      client: { select: { id: true, name: true, document: true, phone: true } },
      branch: { select: { id: true, name: true, address: true, phone: true } },
      receivedBy: { select: { id: true, name: true } },
      movements: { select: { previousBalance: true, resultingBalance: true }, take: 1 },
    },
  })

  // Mismo trato que "no existe": no se confirma que exista en otra sucursal.
  if (!pago) throw notFound('El comprobante no existe')

  const saldos = pago.movements[0]

  return {
    id: pago.id,
    number: pago.number,
    amount: aMonto(pago.amount),
    method: pago.method,
    methodLabel: etiquetaDeMedio(pago.method),
    reference: pago.reference,
    notes: pago.notes,
    createdAt: pago.createdAt,
    shiftId: pago.cashShiftId,
    client: pago.client,
    branch: pago.branch,
    receivedBy: pago.receivedBy,
    previousBalance: saldos ? aMonto(saldos.previousBalance) : null,
    resultingBalance: saldos ? aMonto(saldos.resultingBalance) : null,
  }
}
