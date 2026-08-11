/**
 * Imputacion de pagos a obligaciones.
 *
 * ES LA UNICA PUERTA. Ninguna otra parte de `src/` escribe sobre
 * `SupplierPaymentAllocation`: hay una regla de ESLint que lo impide, y este
 * archivo es su unica excepcion declarada.
 *
 * QUE HACE Y QUE NO. Una imputacion dice a QUE OBLIGACION se aplico plata que YA
 * SE ENTREGO. No mueve el saldo del proveedor --el saldo ya bajo cuando se
 * registro el pago-- y esa es la regla central del objetivo 3: la imputacion
 * explica, no decide. Si moviera el saldo, aplicar un anticipo de marzo a una
 * entrega de agosto restaria dos veces la misma plata.
 *
 * LOS DOS TOPES, y ninguno es una igualdad:
 *
 *   suma(imputaciones de un pago)     <=  el importe del pago
 *   suma(imputaciones de una entrega) <=  su obligacion NETA
 *
 * "Neta" quiere decir descontadas las devoluciones confirmadas: una entrega de
 * $100.000 con una devolucion de $20.000 debe $80.000, y no se le pueden imputar
 * $100.000 desde hoy. Lo que YA estaba imputado antes de la devolucion no se
 * toca --las imputaciones son inmutables-- y por eso la entrega puede quedar
 * pagada EN EXCESO. Ver docs/PURCHASE_RETURN_ACCOUNTING.md.
 *
 * POR QUE HAY BLOQUEOS EXPLICITOS Y NO UN `UPDATE` CONDICIONAL. En el resto del
 * sistema la condicion viaja dentro de la sentencia que escribe --`balance +
 * delta >= 0`, `quantity + delta >= 0`-- porque el tope vive en la MISMA FILA
 * que se modifica. Aca no: el tope de un pago es la suma de OTRA tabla. Un
 * `INSERT ... SELECT ... WHERE suma < tope` no sirve, porque bajo READ COMMITTED
 * ninguna de las dos transacciones ve la fila que la otra todavia no confirmo, y
 * las dos pasan.
 *
 * Lo que si sirve es tomar el bloqueo de la fila del pago ANTES de sumar: la
 * segunda transaccion espera, y cuando entra vuelve a leer --ya con la
 * imputacion de la primera-- y encuentra el tope consumido. Es el unico camino
 * correcto cuando el limite no esta en la fila que se escribe.
 *
 * EL ORDEN DE LOS BLOQUEOS ES PARTE DEL CONTRATO: primero los pagos, despues las
 * entregas, los dos por id ascendente. Dos peticiones que tomen los mismos
 * bloqueos en distinto orden se traban entre si para siempre; con un orden
 * unico, la segunda simplemente espera.
 *
 * Ver docs/SUPPLIER_PAYMENT_ALLOCATION.md y docs/SUPPLIER_ADVANCES.md.
 */

import type { Prisma } from '@prisma/client'
import { conflict, notFound } from '@/server/http/errors'
import {
  CERO_D,
  aMonto,
  dinero,
  esPositivo,
  maximo,
  minimo,
  restar,
  sumar,
  type Dinero,
} from '@/server/money'

/** Cliente de una transaccion. El servicio NO acepta el cliente global. */
export type TxClient = Prisma.TransactionClient

export interface LineaDeImputacion {
  receiptId: number
  amount: Dinero
}

export interface ImputacionEscrita {
  receiptId: number
  orderNumber: string
  amount: Dinero
}

/** Lo que le queda disponible a un pago, y lo que ya tiene aplicado. */
export interface DisponibleDePago {
  paymentId: number
  number: string
  amount: Dinero
  /** Suma de sus imputaciones. DERIVADO, nunca guardado. */
  allocatedAmount: Dinero
  /** `amount - allocatedAmount`. Lo que todavia se puede aplicar. */
  unallocatedAmount: Dinero
}

interface FilaDisponible {
  id: number
  number: string
  amount: string
  imputado: string
}

interface FilaObligacion {
  id: number
  orderNumber: string
  total: string
  devuelto: string
  imputado: string
  debtRecorded: boolean
}

/**
 * Toma el bloqueo de un pago y devuelve cuanto le queda.
 *
 * `FOR UPDATE` sobre `SupplierPayment` --una tabla que nadie actualiza nunca,
 * porque es inmutable-- puede parecer raro. No lo es: el bloqueo no protege la
 * fila del pago, protege LA SUMA DE SUS IMPUTACIONES. Es la fila del pago la que
 * se usa como punto de encuentro, que es la tecnica estandar cuando el limite
 * vive en una tabla distinta de la que se escribe.
 *
 * SON DOS SENTENCIAS, Y ESE ES EL MECANISMO ENTERO. Bloquear y sumar en una
 * sola no sirve, y no sirve de una forma que pasa todas las pruebas de a una:
 * bajo READ COMMITTED la instantanea se toma al EMPEZAR la sentencia, asi que la
 * transaccion que espera el bloqueo suma con una foto anterior a la escritura de
 * la que estaba esperando. Las dos leen "queda todo" y las dos imputan.
 *
 * PostgreSQL reevalua la FILA bloqueada despues de esperarla, pero no las
 * subconsultas. Con dos sentencias, la segunda arranca cuando el bloqueo ya se
 * concedio y toma una instantanea nueva, que si incluye lo que la otra confirmo.
 *
 * Es la misma idea que en `confirmarDevolucion` con las lineas de la recepcion,
 * y por el mismo motivo: el tope no vive en la fila que se escribe.
 *
 * Se exporta para que el pago pueda pedirlo desde su propia transaccion.
 */
export async function disponibleDePagos(
  tx: TxClient,
  paymentIds: readonly number[],
): Promise<Map<number, DisponibleDePago>> {
  if (paymentIds.length === 0) return new Map()

  // Ordenados por id: es la mitad del contrato de bloqueos de este archivo.
  const ids = [...new Set(paymentIds)].sort((a, b) => a - b)

  // 1. El bloqueo, y NADA MAS. Sin agregados: lo unico que hace esta sentencia
  //    es esperar su turno.
  await tx.$queryRaw`
    SELECT p."id" FROM "SupplierPayment" p
     WHERE p."id" = ANY(${ids}::int[])
     ORDER BY p."id"
       FOR UPDATE
  `

  // 2. RECIEN AHORA la suma, en su propia sentencia y con el bloqueo ya tomado.
  const filas = await tx.$queryRaw<FilaDisponible[]>`
    SELECT p."id",
           p."number",
           p."amount"::numeric(14,2)::text AS "amount",
           COALESCE((
             SELECT sum(a."amount") FROM "SupplierPaymentAllocation" a
              WHERE a."paymentId" = p."id"
           ), 0)::numeric(14,2)::text      AS "imputado"
      FROM "SupplierPayment" p
     WHERE p."id" = ANY(${ids}::int[])
     ORDER BY p."id"
  `

  return new Map(
    filas.map((f) => {
      const amount = dinero(f.amount)
      const allocatedAmount = dinero(f.imputado)
      return [
        f.id,
        {
          paymentId: f.id,
          number: f.number,
          amount,
          allocatedAmount,
          unallocatedAmount: restar(amount, allocatedAmount),
        },
      ]
    }),
  )
}

/**
 * Toma el bloqueo de las entregas y devuelve lo que le falta a cada una.
 *
 * La obligacion NETA descuenta las devoluciones CONFIRMADAS. Un borrador no
 * descuenta nada: todavia no salio mercaderia ni se emitio credito.
 *
 * `pendiente` nunca es negativo. Una entrega pagada de mas --porque se devolvio
 * mercaderia despues de haberla pagado-- tiene pendiente cero y exceso, que son
 * dos numeros distintos y se informan por separado.
 *
 * Tambien son DOS sentencias, por lo mismo que arriba: bloquear primero, sumar
 * despues.
 */
async function obligacionesBloqueadas(
  tx: TxClient,
  receiptIds: readonly number[],
): Promise<Map<number, { orderNumber: string; pendiente: Dinero; debtRecorded: boolean }>> {
  if (receiptIds.length === 0) return new Map()

  const ids = [...new Set(receiptIds)].sort((a, b) => a - b)

  await tx.$queryRaw`
    SELECT r."id" FROM "PurchaseReceipt" r
     WHERE r."id" = ANY(${ids}::int[])
     ORDER BY r."id"
       FOR UPDATE
  `

  const filas = await tx.$queryRaw<FilaObligacion[]>`
    SELECT r."id",
           o."number"                       AS "orderNumber",
           r."total"::numeric(14,2)::text   AS "total",
           r."debtRecorded",
           COALESCE((
             SELECT sum(d."total") FROM "PurchaseReturn" d
              WHERE d."purchaseReceiptId" = r."id" AND d."status" = 'CONFIRMED'
           ), 0)::numeric(14,2)::text       AS "devuelto",
           COALESCE((
             SELECT sum(a."amount") FROM "SupplierPaymentAllocation" a
              WHERE a."receiptId" = r."id"
           ), 0)::numeric(14,2)::text       AS "imputado"
      FROM "PurchaseReceipt" r
      JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
     WHERE r."id" = ANY(${ids}::int[])
     ORDER BY r."id"
  `

  return new Map(
    filas.map((f) => {
      const neto = restar(dinero(f.total), dinero(f.devuelto))
      return [
        f.id,
        {
          orderNumber: f.orderNumber,
          // Sin negativos: lo pagado de mas es exceso, no pendiente negativo.
          pendiente: maximo(restar(neto, dinero(f.imputado)), CERO_D),
          debtRecorded: f.debtRecorded,
        },
      ]
    }),
  )
}

/**
 * Escribe imputaciones. LA funcion del modulo.
 *
 * Exige `tx` --el cliente de una transaccion, no el global-- porque los
 * bloqueos solo valen hasta el fin de la transaccion que los tomo. Fuera de una
 * transaccion, cada consulta soltaria el bloqueo antes de la siguiente y no
 * quedaria ninguna garantia.
 *
 * Todas las lineas de una llamada se comprueban CONTRA EL MISMO ESTADO y se
 * escriben juntas: repartir $50.000 entre tres entregas es una decision, no
 * tres, y comprobarlas de a una dejaria pasar un reparto que en total se pasa.
 */
export async function imputar(
  tx: TxClient,
  args: {
    paymentId: number
    lineas: readonly LineaDeImputacion[]
    userId: number
    /**
     * Si una entrega que no admite imputacion es un error o se saltea.
     *
     * El reparto AUTOMATICO ya eligio sus destinos de una lista de obligaciones
     * abiertas, asi que un tope consumido entre medio significa "otro pago llego
     * primero" y corresponde acomodarse. El reparto MANUAL nombro entregas una
     * por una: si una no admite lo pedido, hay que decirlo.
     */
    modo: 'estricto' | 'hasta-donde-alcance'
  },
): Promise<ImputacionEscrita[]> {
  const { paymentId, lineas, userId, modo } = args
  if (lineas.length === 0) return []

  // 1. El pago primero, SIEMPRE. Ver la nota de cabecera sobre el orden.
  const pagos = await disponibleDePagos(tx, [paymentId])
  const pago = pagos.get(paymentId)
  if (!pago) throw notFound('El pago no existe')

  // 2. Las entregas despues, por id ascendente.
  const obligaciones = await obligacionesBloqueadas(
    tx,
    lineas.map((l) => l.receiptId),
  )

  const escritas: ImputacionEscrita[] = []
  let disponible = pago.unallocatedAmount

  for (const linea of lineas) {
    // Lo que queda del pago se lleva a mano: las filas que este mismo bucle va
    // escribiendo todavia no estan en la suma que se leyo arriba.
    if (!esPositivo(disponible)) break

    const obligacion = obligaciones.get(linea.receiptId)
    const pedido = linea.amount

    if (!obligacion || !obligacion.debtRecorded) {
      if (modo === 'hasta-donde-alcance') continue
      throw conflict(
        `La entrega #${String(linea.receiptId)} no es una obligación de este proveedor.`,
        { code: 'ALLOCATION_TARGET_INVALID' },
      )
    }

    if (modo === 'estricto') {
      if (pedido.greaterThan(disponible)) {
        throw conflict(
          `Al pago ${pago.number} le quedan ${aMonto(disponible)} sin imputar y se le ` +
            `quieren imputar ${aMonto(pedido)}.`,
          { code: 'ALLOCATION_EXCEEDS_AVAILABLE' },
        )
      }
      // El tope de la ENTREGA se lleva a mano por lo mismo, y ademas porque dos
      // lineas de la misma llamada podrian apuntar a la misma entrega.
      if (pedido.greaterThan(obligacion.pendiente)) {
        throw conflict(
          `A la entrega #${String(linea.receiptId)} (${obligacion.orderNumber}) le faltan ` +
            `${aMonto(obligacion.pendiente)} y se le quieren imputar ${aMonto(pedido)}.`,
          { code: 'ALLOCATION_EXCEEDS_DEBT' },
        )
      }
    }

    // El menor de los tres: lo pedido, lo que queda del pago y lo que le falta a
    // la entrega. En modo estricto los dos topes ya se comprobaron, asi que el
    // menor es siempre lo pedido; el minimo no cambia nada y evita tener dos
    // caminos que calculen el mismo numero.
    const cuanto = minimo(minimo(pedido, disponible), obligacion.pendiente)
    if (!esPositivo(cuanto)) continue

    await tx.supplierPaymentAllocation.create({
      data: { paymentId, receiptId: linea.receiptId, amount: cuanto, createdById: userId },
    })

    disponible = restar(disponible, cuanto)
    obligacion.pendiente = restar(obligacion.pendiente, cuanto)
    escritas.push({
      receiptId: linea.receiptId,
      orderNumber: obligacion.orderNumber,
      amount: cuanto,
    })
  }

  return escritas
}

/** Lo imputado de una lista de escrituras. Para el comprobante y la bitacora. */
export function totalImputado(escritas: readonly ImputacionEscrita[]): Dinero {
  return escritas.reduce((total, e) => sumar(total, e.amount), CERO_D)
}
