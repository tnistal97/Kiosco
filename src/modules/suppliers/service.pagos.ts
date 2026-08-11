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
import { disponibleDePagos, imputar, totalImputado } from './imputacion'
import { deudasDeProveedor, inicioDeHoyEnSucursal, proveedorDeCuenta } from './service.cuenta'
import type { ImputacionInput, ImputarPagoInput, PagarProveedorInput } from './schemas.cuenta'

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
 * Convierte el reparto MANUAL pedido por el navegador en lineas de imputacion.
 *
 * Ya no comprueba nada contra las deudas, y esa es la diferencia con la version
 * de la Fase 4B: las dos reglas --no pasarse de lo que falta, no pasarse del
 * pago-- viven ahora en `imputar`, que las evalua BAJO BLOQUEO DE FILA. Aca se
 * comprobaban contra una lectura previa, y una lectura previa no impide que dos
 * pagos simultaneos cancelen dos veces el mismo importe pendiente: los dos leen
 * lo mismo y los dos deciden que entra.
 *
 * Lo unico que queda es la suma del reparto contra el importe del pago, que se
 * puede contestar sin mirar la base --son datos de la misma peticion-- y que da
 * un mensaje mejor que el generico: "el reparto suma $60.000 y el pago es de
 * $50.000" dice donde esta el error de quien lo mando.
 */
function repartirAMano(pedido: readonly ImputacionInput[], importe: Dinero): Reparto[] {
  const reparto = pedido.map((linea) => ({
    receiptId: linea.receiptId,
    orderNumber: '',
    amount: dinero(linea.amount),
  }))

  const total = reparto.reduce((suma, l) => sumar(suma, l.amount), CERO_D)
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

    // 4. Las imputaciones, por la unica puerta que las escribe.
    //
    //    'ninguna' es el ANTICIPO del objetivo 1: plata entregada sin aplicar a
    //    nada. No se llama a `imputar` con una lista vacia --hace lo mismo-- por
    //    claridad: aca se ve que no imputar es una decision y no un olvido.
    //
    //    El modo del reparto automatico es 'hasta-donde-alcance': sus destinos
    //    salieron de una lectura de deudas abiertas, y entre esa lectura y el
    //    bloqueo puede haber entrado otro pago. En ese caso corresponde
    //    acomodarse a lo que quedo, no rechazar el pago entero. El manual va en
    //    'estricto': quien nombro las entregas una por una tiene que enterarse
    //    de que una ya no admite lo que pidio.
    const reparto: Reparto[] =
      input.imputacion === 'ninguna'
        ? []
        : input.imputacion === 'automatica'
          ? repartirFIFO(
              await deudasDeProveedor(tx, supplierId, { soloAbiertas: true, inicioDeHoy }),
              importe,
            )
          : repartirAMano(input.allocations, importe)

    const escritas = await imputar(tx, {
      paymentId: pago.id,
      lineas: reparto,
      userId: session.userId,
      modo: input.imputacion === 'manual' ? 'estricto' : 'hasta-donde-alcance',
    })

    const imputado = totalImputado(escritas)
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
        imputaciones: escritas.map((l) => ({
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
      imputaciones: escritas.map((l) => ({
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
// Imputacion diferida
// ---------------------------------------------------------------------------

export interface ResultadoDeImputacion {
  paymentId: number
  number: string
  supplierId: number
  supplierName: string
  amount: Monto
  allocatedAmount: Monto
  unallocatedAmount: Monto
  imputaciones: Array<{ receiptId: number; orderNumber: string; amount: Monto }>
}

/**
 * Aplica un pago YA REGISTRADO a obligaciones concretas. Objetivo 5.
 *
 * ES LA OPERACION QUE CIERRA EL CIRCUITO DEL ANTICIPO: la plata se entrego en
 * marzo, la mercaderia llego en agosto, y esto es lo que las une.
 *
 * NO TOCA EL SALDO DEL PROVEEDOR, y esa ausencia es el objetivo 3 entero. El
 * saldo bajo cuando se registro el pago; volver a bajarlo aca restaria dos veces
 * la misma plata. Por eso este camino no llama a `applySupplierAccountMovement`
 * y no puede: escribe una tabla de detalle, no el libro.
 *
 * Todo el trabajo pesado --los dos topes, bajo bloqueo-- vive en `imputar`. Aca
 * queda lo que esa funcion no tiene por que saber: que el pago sea de ESTE
 * proveedor y que quede constancia en la bitacora de quien lo decidio.
 */
export async function imputarPagoAObligaciones(
  session: Session,
  supplierId: number,
  paymentId: number,
  input: ImputarPagoInput,
): Promise<ResultadoDeImputacion> {
  const proveedor = await proveedorDeCuenta(supplierId)

  // Que el pago sea de este proveedor se comprueba ANTES de abrir la
  // transaccion: es un error de la peticion, no una condicion de carrera, y no
  // tiene sentido tomar bloqueos para descubrirlo.
  const pago = await prisma.supplierPayment.findFirst({
    where: { id: paymentId, supplierId },
    select: { id: true, number: true },
  })
  // Mismo trato que "no existe": no se confirma que exista para otro proveedor.
  if (!pago) throw notFound('El pago no existe')

  return prisma.$transaction(async (tx) => {
    const escritas = await imputar(tx, {
      paymentId,
      lineas: input.allocations.map((a) => ({ receiptId: a.receiptId, amount: dinero(a.amount) })),
      userId: session.userId,
      // Estricto: quien nombro las entregas una por una tiene que enterarse si
      // alguna ya no admite lo que pidio.
      modo: 'estricto',
    })

    // Despues de escribir, y bajo el mismo bloqueo: es el estado final del pago,
    // no una lectura que otra transaccion pueda haber movido.
    const despues = await disponibleDePagos(tx, [paymentId])
    const estado = despues.get(paymentId)

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'SupplierPaymentAllocation',
      recordId: paymentId,
      action: 'create',
      after: {
        pago: pago.number,
        supplierId,
        proveedor: proveedor.name,
        imputaciones: escritas.map((l) => ({
          receiptId: l.receiptId,
          orden: l.orderNumber,
          importe: aMonto(l.amount),
        })),
        imputado: aMonto(totalImputado(escritas)),
        sinImputar: aMonto(estado?.unallocatedAmount ?? CERO_D),
      },
      origin: 'POST /api/suppliers/:id/pagos/:pagoId/imputar',
    })

    return {
      paymentId,
      number: pago.number,
      supplierId,
      supplierName: proveedor.name,
      amount: aMonto(estado?.amount ?? CERO_D),
      allocatedAmount: aMonto(estado?.allocatedAmount ?? CERO_D),
      unallocatedAmount: aMonto(estado?.unallocatedAmount ?? CERO_D),
      imputaciones: escritas.map((l) => ({
        receiptId: l.receiptId,
        orderNumber: l.orderNumber,
        amount: aMonto(l.amount),
      })),
    }
  })
}

/**
 * Aplica el credito disponible de un proveedor a una obligacion. Objetivo 4.
 *
 * Es la version automatica del anterior, y la usa la recepcion: cuando llega
 * mercaderia y hay anticipos sin aplicar, esto los consume.
 *
 * EL ORDEN ES FIFO DE PAGOS: el mas antiguo primero, y el id como desempate. El
 * criterio es distinto del FIFO de deudas --que ordena por vencimiento-- porque
 * la pregunta es otra: alla es "cual hay que pagar antes"; aca es "cual de mis
 * anticipos uso primero", y la respuesta natural es el que lleva mas tiempo
 * esperando.
 *
 * Devuelve lo aplicado por pago, para poder decirlo en la pantalla y en la
 * bitacora. Nunca aplica mas que lo que la obligacion admite: los dos topes los
 * sigue haciendo cumplir `imputar`, bajo bloqueo.
 */
export async function aplicarCreditoDisponible(
  tx: Prisma.TransactionClient,
  args: {
    supplierId: number
    receiptId: number
    userId: number
    /**
     * Cuanto admite la obligacion, como MUCHO.
     *
     * Es un presupuesto para dejar de pedir bloqueos cuando ya esta cubierta, no
     * una garantia: la garantia sigue siendo `imputar`, que mira el pendiente
     * real con la fila tomada. Si este numero quedara alto se pediria un bloqueo
     * de mas y no se escribiria nada; si quedara bajo, sobraria credito sin
     * aplicar y se puede imputar a mano.
     */
    tope: Dinero
  },
): Promise<Array<{ paymentId: number; number: string; amount: Dinero }>> {
  const { supplierId, receiptId, userId } = args
  if (!esPositivo(args.tope)) return []

  // Los candidatos se eligen FUERA del bloqueo --es una lectura para saber a
  // quien pedirle-- y `imputar` vuelve a mirar cuanto le queda a cada uno ya con
  // la fila tomada. Un anticipo que otro proceso consumio entre medio aporta
  // cero y no rompe nada.
  const candidatos = await tx.$queryRaw<Array<{ id: number; number: string; disponible: string }>>`
    SELECT p."id", p."number", (p."amount" - imputado)::numeric(14,2)::text AS "disponible"
      FROM "SupplierPayment" p
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(a."amount"), 0) AS imputado
          FROM "SupplierPaymentAllocation" a
         WHERE a."paymentId" = p."id"
      ) s
     WHERE p."supplierId" = ${supplierId}
       AND p."amount" - imputado > 0
     ORDER BY p."paidAt" ASC, p."id" ASC
     LIMIT 100
  `

  const aplicado: Array<{ paymentId: number; number: string; amount: Dinero }> = []
  let falta = args.tope

  for (const candidato of candidatos) {
    if (!esPositivo(falta)) break

    const escritas = await imputar(tx, {
      paymentId: candidato.id,
      lineas: [{ receiptId, amount: minimo(dinero(candidato.disponible), falta) }],
      userId,
      // Hasta donde alcance: el tope de la obligacion es justamente lo que se
      // quiere respetar, y quedarse corto es el resultado correcto.
      modo: 'hasta-donde-alcance',
    })

    const cuanto = totalImputado(escritas)
    if (!esPositivo(cuanto)) continue

    falta = restar(falta, cuanto)
    aplicado.push({ paymentId: candidato.id, number: candidato.number, amount: cuanto })
  }

  return aplicado
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
        // Los importes y no solo el conteo: desde la Fase 4C un pago puede
        // quedar parcialmente sin imputar, y "3 imputaciones" no dice si se
        // aplico entero o si todavia le sobra plata.
        allocations: { select: { amount: true } },
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = pagos.map(({ movements, allocations, ...p }) => {
    const imputado = allocations.reduce((total, a) => sumar(total, a.amount), CERO_D)
    return {
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
      imputaciones: allocations.length,
      allocatedAmount: aMonto(imputado),
      unallocatedAmount: aMonto(restar(p.amount, imputado)),
      previousBalance: movements[0] ? aMonto(movements[0].previousBalance) : null,
      resultingBalance: movements[0] ? aMonto(movements[0].resultingBalance) : null,
    }
  })

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
