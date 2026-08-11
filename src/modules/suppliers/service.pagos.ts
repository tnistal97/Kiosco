/**
 * Pagos a proveedores.
 *
 * Este archivo NO escribe saldos: se los pide a `applySupplierAccountMovement`,
 * que es la unica puerta. Lo que hace es lo que la puerta no tiene por que
 * saber: de donde sale el numero de comprobante, si la plata sale del cajon, a
 * que obligaciones se imputa y que queda en la bitacora.
 *
 * Ver docs/SUPPLIER_PAYMENT_FLOW.md y docs/SUPPLIER_PAYMENT_ALLOCATION.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, notFound } from '@/server/http/errors'
import { paginado, toSkipTake } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { Monto } from '@/lib/money'
import {
  CERO_D,
  aMonto,
  absoluto,
  dinero,
  esNegativo,
  esPositivo,
  minimo,
  negar,
  restar,
  sumar,
  type Dinero,
} from '@/server/money'
import { esEfectivo, etiquetaDeMedio } from '@/modules/sales/payment-methods'
import { turnoParaOperar } from '@/modules/cash/service.turnos'
import { applySupplierAccountMovement, autorizanteDelSobrepago } from './cuenta'
import { deudasDeProveedor, inicioDeHoyEnSucursal, proveedorDeCuenta } from './service.cuenta'
import type { ImputacionInput, PagarProveedorInput } from './schemas.cuenta'

// ---------------------------------------------------------------------------
// Numeracion
// ---------------------------------------------------------------------------

/**
 * El siguiente numero de comprobante. `PP-00000128`.
 *
 * Sale de una SECUENCIA de PostgreSQL, no de `count() + 1`, por lo mismo que el
 * numero de orden de compra y el de cobro: dos personas pagando en el mismo
 * segundo leerian el mismo count() y el indice unico rechazaria a una de las
 * dos.
 *
 * Se pide FUERA de la transaccion a proposito: `nextval` no se deshace con un
 * ROLLBACK, asi que pedirlo adentro no evitaria el hueco y solo alargaria la
 * transaccion.
 */
export async function siguienteNumeroDePagoAProveedor(): Promise<string> {
  const filas = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT nextval('"SupplierPayment_numero_seq"') AS n
  `
  const n = filas[0]?.n
  if (n === undefined) throw new Error('No se pudo obtener el numero de comprobante')
  return `PP-${String(n).padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// Imputacion
// ---------------------------------------------------------------------------

interface Reparto {
  receiptId: number
  orderNumber: string
  amount: Dinero
}

/**
 * El reparto automatico: FIFO por vencimiento.
 *
 * NO decide el orden. El orden ya viene resuelto por `deudasDeProveedor`, que es
 * donde vive la regla del objetivo 23 y donde vive UNA SOLA VEZ. Reordenar aca
 * seria una segunda implementacion de la misma regla, y dos implementaciones de
 * una regla es una que alguien se va a olvidar de cambiar.
 *
 * Lo que hace es repartir: a cada obligacion, lo menor entre lo que le falta y
 * lo que queda del pago. Lo que sobre despues de cubrir todo lo pendiente queda
 * SIN IMPUTAR --no se fuerza contra nada-- y aparece como tal en el comprobante.
 *
 * Se exporta para poder probarla sola, sin base de datos.
 */
export function repartirFIFO(
  deudas: ReadonlyArray<{ receiptId: number; orderNumber: string; pendiente: Monto }>,
  importe: Dinero,
): Reparto[] {
  const reparto: Reparto[] = []
  let resto = importe

  for (const d of deudas) {
    if (!esPositivo(resto)) break
    const pendiente = dinero(d.pendiente)
    if (!esPositivo(pendiente)) continue

    const cuanto = minimo(resto, pendiente)
    reparto.push({ receiptId: d.receiptId, orderNumber: d.orderNumber, amount: cuanto })
    resto = restar(resto, cuanto)
  }

  return reparto
}

/**
 * Comprueba y arma el reparto MANUAL.
 *
 * Las dos reglas se comprueban DENTRO de la transaccion, contra el pendiente
 * leido en ese momento y no contra el que vio el navegador. Comprobarlo antes
 * dejaria pasar el cuarto caso de concurrencia del objetivo 34: dos pagos
 * simultaneos que juntos cancelan dos veces el mismo importe pendiente.
 */
function repartirAMano(
  deudas: ReadonlyArray<{ receiptId: number; orderNumber: string; pendiente: Monto }>,
  pedido: readonly ImputacionInput[],
  importe: Dinero,
): Reparto[] {
  const porId = new Map(deudas.map((d) => [d.receiptId, d]))
  const reparto: Reparto[] = []
  let total = CERO_D

  for (const linea of pedido) {
    const deuda = porId.get(linea.receiptId)
    if (!deuda) {
      throw conflict(
        `La entrega #${String(linea.receiptId)} no es una obligación abierta de este proveedor.`,
        { code: 'ALLOCATION_TARGET_INVALID' },
      )
    }

    const cuanto = dinero(linea.amount)
    const pendiente = dinero(deuda.pendiente)

    if (cuanto.greaterThan(pendiente)) {
      throw conflict(
        `A la entrega #${String(linea.receiptId)} (${deuda.orderNumber}) le faltan ` +
          `${aMonto(pendiente)} y se le quieren imputar ${aMonto(cuanto)}.`,
        { code: 'ALLOCATION_EXCEEDS_DEBT' },
      )
    }

    total = sumar(total, cuanto)
    reparto.push({ receiptId: linea.receiptId, orderNumber: deuda.orderNumber, amount: cuanto })
  }

  if (total.greaterThan(importe)) {
    throw conflict(`El reparto suma ${aMonto(total)} y el pago es de ${aMonto(importe)}.`, {
      code: 'ALLOCATION_EXCEEDS_PAYMENT',
    })
  }

  return reparto
}

// ---------------------------------------------------------------------------
// Pago
// ---------------------------------------------------------------------------

export interface ComprobanteDePagoAProveedor {
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
  imputaciones: Array<{ receiptId: number; orderNumber: string; amount: Monto }>
  reference: string | null
  notes: string | null
  paidBy: { id: number; name: string }
  shiftId: number | null
  /** Si esta plata salio del cajon. Falso en transferencia y tarjeta. */
  salioDeCaja: boolean
  paidAt: Date
}

/**
 * Registra un pago a un proveedor. LA operacion del modulo.
 *
 * Cinco cosas ocurren juntas o no ocurre ninguna:
 *
 *   1. el turno, si la plata sale del cajon;
 *   2. el comprobante (`SupplierPayment`);
 *   3. el movimiento del libro, que baja el saldo;
 *   4. las imputaciones, si hay obligaciones que cubrir;
 *   5. el egreso de caja, SOLO si se pago en efectivo.
 *
 * No existe forma de crear un pago sin su movimiento de cuenta: es la misma
 * transaccion y no hay otro camino que escriba `SupplierPayment`.
 *
 * SOBREPAGO. Se permite, pero nunca en silencio Y ademas con permiso propio.
 * Es mas estricto que el sobrepago del cliente y la asimetria es deliberada:
 * que un cliente pague de mas es un hecho consumado --la plata ya esta sobre el
 * mostrador--; que nosotros paguemos de mas es una decision, y una que deja
 * plata en manos de un tercero.
 */
export async function registrarPagoAProveedor(
  session: Session,
  supplierId: number,
  input: PagarProveedorInput,
): Promise<ComprobanteDePagoAProveedor> {
  const proveedor = await proveedorDeCuenta(supplierId)
  const importe = dinero(input.amount)

  // El sobrepago se comprueba ANTES de abrir la transaccion para poder decir
  // cuanto sobra sin haber tocado nada, y para exigir el permiso antes de
  // pedirle un numero a la secuencia. Se vuelve a comprobar adentro, bajo el
  // bloqueo de fila: entre esta lectura y el pago puede entrar una recepcion
  // que cambie el saldo, y en ese caso lo que aca era sobrepago ya no lo es.
  const sobra = restar(importe, proveedor.balance)
  if (esPositivo(sobra) && !input.acceptCredit) {
    const debemos = esPositivo(proveedor.balance) ? proveedor.balance : CERO_D
    throw conflict(
      `A ${proveedor.name} se le deben ${aMonto(debemos)} y el pago es de ${aMonto(importe)}: ` +
        `quedarían ${aMonto(sobra)} a favor nuestro. Confirmá para registrarlo así.`,
      { code: 'SUPPLIER_PAYMENT_LEAVES_CREDIT' },
    )
  }

  // El permiso se exige aca, antes de nada. Devuelve el id que va a quedar
  // escrito en la fila del libro cuando quien paga consintio Y puede.
  const autorizante = autorizanteDelSobrepago(session, input.acceptCredit, esPositivo(sobra))

  const inicioDeHoy = await inicioDeHoyEnSucursal(prisma, session.branchId)
  const number = await siguienteNumeroDePagoAProveedor()

  return prisma.$transaction(async (tx) =>
    aplicarPago(tx, session, {
      supplierId,
      supplierName: proveedor.name,
      input,
      number,
      inicioDeHoy,
      autorizante,
    }),
  )
}

/**
 * El cuerpo del pago, sin la transaccion.
 *
 * Existe separado por el objetivo 17: la recepcion puede registrar un pago
 * inmediato, y ese pago tiene que ocurrir DENTRO de la misma transaccion que la
 * entrega --si algo falla, no queda ni la deuda ni el pago--. Con la
 * transaccion adentro no se podria: `prisma.$transaction` no anida.
 *
 * El numero y la comprobacion de sobrepago quedan afuera a proposito, en manos
 * de quien llama: `nextval` no se deshace con un ROLLBACK y conviene pedirlo una
 * sola vez, y el permiso hay que exigirlo antes de haber escrito nada.
 */
export async function aplicarPago(
  tx: Prisma.TransactionClient,
  session: Session,
  args: {
    supplierId: number
    supplierName: string
    input: PagarProveedorInput
    number: string
    inicioDeHoy: string
    autorizante: number | null
  },
): Promise<ComprobanteDePagoAProveedor> {
  const { supplierId, supplierName, input, number, inicioDeHoy, autorizante } = args
  const importe = dinero(input.amount)

  {
    // 1. El turno. Se pide antes de mover nada, igual que en la venta: rechazar
    //    el pago despues de haber bajado el saldo obligaria a devolverlo.
    //
    //    Solo hace falta si la plata SALE del cajon. Una transferencia no toca
    //    la caja, asi que no tiene por que exigir un turno abierto: pagarle a un
    //    proveedor por transferencia con la caja cerrada es legitimo.
    const turno = esEfectivo(input.method) ? await turnoParaOperar(tx, session.branchId) : null

    // 2. El comprobante.
    const pago = await tx.supplierPayment.create({
      data: {
        number,
        branchId: session.branchId,
        supplierId,
        amount: importe,
        method: input.method,
        cashShiftId: turno?.id ?? null,
        paidById: session.userId,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
      },
      select: { id: true, paidAt: true },
    })

    // 3. El movimiento del libro. NEGATIVO: un pago reduce lo que debemos.
    const movimiento = await applySupplierAccountMovement(tx, {
      branchId: session.branchId,
      supplierId,
      type: 'PAYMENT',
      amount: negar(importe),
      userId: session.userId,
      paymentId: pago.id,
      authorizedById: autorizante,
    })

    // NO hace falta volver a comprobar el sobrepago aca, y la ausencia es
    // deliberada: la comprobacion ya ocurrio, dentro del `UPDATE`. Cuando el
    // movimiento viaja SIN autorizar, la condicion `balance + delta >= 0` no lo
    // deja pasar y `applySupplierAccountMovement` devuelve el 409 con el saldo
    // real; cuando viaja autorizado, es porque alguien con permiso lo
    // confirmo. Un `if` aca seria codigo que no puede ejecutarse nunca, que es
    // peor que no tenerlo: se lee como una defensa y no defiende de nada.
    //
    // Es la diferencia con el cobro al cliente, donde la segunda comprobacion
    // SI hace falta: alla el limite de credito frena los CARGOS y no los pagos,
    // asi que un pago que deja saldo a favor no lo frena ninguna condicion SQL.

    // 4. Las imputaciones. Las deudas se leen DENTRO de la transaccion, ya con
    //    el saldo movido: es lo que hace que dos pagos simultaneos no puedan
    //    cancelar dos veces el mismo importe pendiente.
    const deudas = await deudasDeProveedor(tx, supplierId, { soloAbiertas: true, inicioDeHoy })

    const reparto =
      input.imputacion === 'automatica'
        ? repartirFIFO(deudas, importe)
        : repartirAMano(deudas, input.allocations, importe)

    for (const linea of reparto) {
      await tx.supplierPaymentAllocation.create({
        data: { paymentId: pago.id, receiptId: linea.receiptId, amount: linea.amount },
      })
    }

    const imputado = reparto.reduce((total, l) => sumar(total, l.amount), CERO_D)
    const sinImputar = restar(importe, imputado)

    // 5. La caja recibe SOLO el efectivo, y en NEGATIVO: la plata sale. Una
    //    transferencia baja el saldo del proveedor y no baja el cajon.
    if (esEfectivo(input.method)) {
      await tx.cashRegisterMovement.create({
        data: {
          branchId: session.branchId,
          userId: session.userId,
          // El signo lo decide el servidor a partir del tipo, nunca el cliente.
          amount: negar(importe),
          paymentMethod: input.method,
          description: `Pago ${number} · ${supplierName}`,
          type: 'supplier_payment',
          shiftId: turno?.id ?? null,
          // El vinculo de verdad. La descripcion es para leerla en el listado
          // de caja; esto es lo que usa la reconciliacion para unir las dos
          // tablas sin tener que parsear una frase.
          supplierPaymentId: pago.id,
        },
      })

      await tx.branch.update({
        where: { id: session.branchId },
        data: { currentCash: { decrement: importe } },
      })
    }

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'SupplierPayment',
      recordId: pago.id,
      action: 'create',
      after: {
        numero: number,
        supplierId,
        proveedor: supplierName,
        importe: aMonto(importe),
        medio: input.method,
        turno: turno?.id ?? null,
        saldoAnterior: aMonto(movimiento.previousBalance),
        saldoNuevo: aMonto(movimiento.resultingBalance),
        movimientoId: movimiento.movementId,
        imputacion: input.imputacion,
        imputaciones: reparto.map((l) => ({
          receiptId: l.receiptId,
          orden: l.orderNumber,
          importe: aMonto(l.amount),
        })),
        sinImputar: aMonto(sinImputar),
        ...(autorizante === null ? {} : { sobrepagoAutorizadoPor: autorizante }),
      },
      origin: 'POST /api/suppliers/:id/pagos',
    })

    return {
      id: pago.id,
      number,
      supplierId,
      supplierName: supplierName,
      amount: aMonto(importe),
      method: input.method,
      methodLabel: etiquetaDeMedio(input.method),
      previousBalance: aMonto(movimiento.previousBalance),
      resultingBalance: aMonto(movimiento.resultingBalance),
      saldoAFavor: esNegativo(movimiento.resultingBalance)
        ? aMonto(absoluto(movimiento.resultingBalance))
        : aMonto(CERO_D),
      sinImputar: aMonto(sinImputar),
      imputaciones: reparto.map((l) => ({
        receiptId: l.receiptId,
        orderNumber: l.orderNumber,
        amount: aMonto(l.amount),
      })),
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      paidBy: { id: session.userId, name: session.name },
      shiftId: turno?.id ?? null,
      salioDeCaja: esEfectivo(input.method),
      paidAt: pago.paidAt,
    }
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

/** Los pagos a un proveedor, paginados. Para la ficha y para reimprimir. */
export async function listarPagosDeProveedor(
  supplierId: number,
  query: { page: number; pageSize: number },
) {
  await proveedorDeCuenta(supplierId)

  const where: Prisma.SupplierPaymentWhereInput = { supplierId }

  const [total, pagos] = await Promise.all([
    prisma.supplierPayment.count({ where }),
    prisma.supplierPayment.findMany({
      where,
      select: {
        id: true,
        number: true,
        amount: true,
        method: true,
        reference: true,
        notes: true,
        paidAt: true,
        cashShiftId: true,
        paidBy: { select: { id: true, name: true } },
        movements: { select: { previousBalance: true, resultingBalance: true }, take: 1 },
        _count: { select: { allocations: true } },
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = pagos.map(({ movements, _count, ...p }) => ({
    id: p.id,
    number: p.number,
    amount: aMonto(p.amount),
    method: p.method,
    methodLabel: etiquetaDeMedio(p.method),
    reference: p.reference,
    notes: p.notes,
    paidAt: p.paidAt,
    shiftId: p.cashShiftId,
    paidBy: p.paidBy,
    salioDeCaja: esEfectivo(p.method),
    imputaciones: _count.allocations,
    previousBalance: movements[0] ? aMonto(movements[0].previousBalance) : null,
    resultingBalance: movements[0] ? aMonto(movements[0].resultingBalance) : null,
  }))

  return paginado(data, total, query)
}

/**
 * Un comprobante por id, para reimprimirlo.
 *
 * Se filtra por sucursal --a diferencia del resto del modulo, donde el
 * proveedor es del negocio-- porque el comprobante es un documento de LA
 * SUCURSAL que pago: lleva su nombre, su direccion y su turno.
 */
export async function obtenerComprobanteDePago(session: Session, paymentId: number) {
  const pago = await prisma.supplierPayment.findFirst({
    where: { id: paymentId, branchId: session.branchId },
    select: {
      id: true,
      number: true,
      amount: true,
      method: true,
      reference: true,
      notes: true,
      paidAt: true,
      cashShiftId: true,
      supplierId: true,
      supplier: { select: { id: true, name: true, taxId: true, phone: true } },
      branch: { select: { id: true, name: true, address: true, phone: true } },
      paidBy: { select: { id: true, name: true } },
      movements: { select: { previousBalance: true, resultingBalance: true }, take: 1 },
      allocations: {
        select: {
          receiptId: true,
          amount: true,
          receipt: { select: { order: { select: { number: true } } } },
        },
        orderBy: { id: 'asc' },
      },
    },
  })

  // Mismo trato que "no existe": no se confirma que exista en otra sucursal.
  if (!pago) throw notFound('El comprobante no existe')

  const saldos = pago.movements[0]
  const imputado = pago.allocations.reduce((total, a) => sumar(total, a.amount), CERO_D)

  return {
    id: pago.id,
    number: pago.number,
    supplierId: pago.supplierId,
    supplierName: pago.supplier.name,
    amount: aMonto(pago.amount),
    method: pago.method,
    methodLabel: etiquetaDeMedio(pago.method),
    previousBalance: saldos ? aMonto(saldos.previousBalance) : aMonto(CERO_D),
    resultingBalance: saldos ? aMonto(saldos.resultingBalance) : aMonto(CERO_D),
    saldoAFavor:
      saldos && esNegativo(saldos.resultingBalance)
        ? aMonto(absoluto(saldos.resultingBalance))
        : aMonto(CERO_D),
    sinImputar: aMonto(restar(pago.amount, imputado)),
    imputaciones: pago.allocations.map((a) => ({
      receiptId: a.receiptId,
      orderNumber: a.receipt.order.number,
      amount: aMonto(a.amount),
    })),
    reference: pago.reference,
    notes: pago.notes,
    paidBy: pago.paidBy,
    shiftId: pago.cashShiftId,
    salioDeCaja: esEfectivo(pago.method),
    paidAt: pago.paidAt,
    supplier: pago.supplier,
    branch: pago.branch,
  }
}
