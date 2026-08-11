/**
 * Cuentas por pagar: leer la cuenta, las deudas abiertas y corregirlas.
 *
 * Este archivo NO escribe saldos: se los pide a `applySupplierAccountMovement`,
 * que es la unica puerta. Lo que hace es lo que la puerta no tiene por que
 * saber: que obligaciones quedan abiertas, cuales vencieron, y que queda en la
 * bitacora cuando alguien corrige algo a mano.
 *
 * El pago vive en `service.pagos.ts`, que es la otra mitad y la mas larga.
 *
 * Ver docs/SUPPLIER_ACCOUNT_LEDGER.md y docs/ACCOUNTS_PAYABLE_POLICY.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, invalid, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { Monto } from '@/lib/money'
import { CERO_D, aMonto, dinero, negar, restar, type Dinero } from '@/server/money'
import { etiquetaDeMedio } from '@/modules/sales/payment-methods'
import {
  comoTimestampUTC,
  esFechaLocal,
  hoyEnSucursal,
  inicioDelDia,
  rangoDeSucursal,
  zonaDeSucursal,
} from '@/server/tiempo'
import { applySupplierAccountMovement } from './cuenta'
import { etiquetaDeProveedor, type EstadoDeDeuda } from './movement-types'
import type {
  AjustarProveedorInput,
  CambiarVencimientoInput,
  ListarDeudasQuery,
  ListarMovimientosProveedorQuery,
  NotaDeCreditoInput,
} from './schemas.cuenta'

type Cliente = Prisma.TransactionClient | typeof prisma

// ---------------------------------------------------------------------------
// El proveedor, y su hoy
// ---------------------------------------------------------------------------

/**
 * Un proveedor por id, o 404.
 *
 * Sin filtro de sucursal, igual que en el resto del modulo: los proveedores son
 * del negocio y el saldo tambien. Se le compra desde donde haga falta y se le
 * debe una sola vez.
 */
export async function proveedorDeCuenta(supplierId: number) {
  const proveedor = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      id: true,
      name: true,
      taxId: true,
      phone: true,
      isActive: true,
      balance: true,
      defaultPaymentTermDays: true,
    },
  })
  if (!proveedor) throw notFound('Proveedor no encontrado')
  return proveedor
}

/**
 * El instante en el que empieza HOY, en la zona de la sucursal.
 *
 * Es contra esto que se compara un vencimiento para decidir si algo esta
 * vencido: `dueDate < inicioDeHoy`. Una obligacion que vence hoy NO esta
 * vencida --se puede pagar hoy-- y una que vencia ayer si.
 *
 * Sale de `Branch.timeZone` y nunca del reloj del servidor. Ver
 * docs/TIMEZONE_POLICY.md.
 */
export async function inicioDeHoyEnSucursal(cliente: Cliente, branchId: number): Promise<string> {
  const hoy = await hoyEnSucursal(cliente, branchId)
  const { desde } = await rangoDeSucursal(cliente, branchId, hoy, hoy)
  return comoTimestampUTC(desde)
}

// ---------------------------------------------------------------------------
// Deudas abiertas
// ---------------------------------------------------------------------------

export interface Deuda {
  receiptId: number
  orderId: number
  orderNumber: string
  receivedAt: Date
  dueDate: Date | null
  /** Lo que la entrega costo. NUNCA cambia: es el importe original. */
  total: Monto
  /** Lo devuelto al proveedor, al costo historico. `"0.00"` si no hubo. Fase 4C. */
  devuelto: Monto
  /** `total - devuelto`. Lo que realmente se debe por esta entrega. Fase 4C. */
  neto: Monto
  pagado: Monto
  pendiente: Monto
  /**
   * Lo pagado POR ENCIMA de la obligacion neta. `"0.00"` en el caso normal.
   *
   * Solo puede aparecer devolviendo mercaderia que ya se habia pagado: las
   * imputaciones no se mueven hacia atras, asi que la entrega queda con mas
   * imputado que lo que debe. Ver docs/PURCHASE_RETURN_ACCOUNTING.md.
   */
  exceso: Monto
  estado: EstadoDeDeuda
}

/** Fila cruda de la consulta de deudas. Todo texto: un `numeric` por `number` ya perdio. */
interface FilaDeuda {
  receiptId: number
  orderId: number
  orderNumber: string
  receivedAt: Date
  dueDate: Date | null
  total: string
  devuelto: string
  neto: string
  pagado: string
  pendiente: string
  exceso: string
  vencida: boolean
}

/**
 * El estado de una obligacion. DERIVADO, nunca guardado.
 *
 * El objetivo 20 lo pide asi y tiene razon: un booleano `vencida` guardado en
 * la fila es verdadero hasta que pasa la medianoche, y a partir de ahi miente
 * hasta que algo lo recalcule.
 *
 * 'VENCIDA' gana sobre 'PARCIAL' a proposito: lo primero que hay que ver de una
 * deuda vencida a medio pagar es que esta vencida.
 */
export function estadoDeDeuda(total: Dinero, pagado: Dinero, vencida: boolean): EstadoDeDeuda {
  const pendiente = restar(total, pagado)
  if (pendiente.lessThanOrEqualTo(CERO_D)) return 'PAGADA'
  if (vencida) return 'VENCIDA'
  if (pagado.greaterThan(CERO_D)) return 'PARCIAL'
  return 'PENDIENTE'
}

/**
 * Las obligaciones de un proveedor, con su pendiente ya calculado.
 *
 * UNA consulta con la suma de imputaciones adentro. La alternativa --traer las
 * recepciones y sumar sus imputaciones en JavaScript-- seria una consulta por
 * fila, y esta lista la usa tambien la imputacion automatica, que corre dentro
 * de la transaccion de cada pago.
 *
 * EL ORDEN ES LA REGLA FIFO DEL OBJETIVO 23, y vive aca y en ningun otro lado:
 *
 *   1. la deuda vencida mas antigua
 *   2. la de vencimiento mas cercano
 *   3. la recepcion mas antigua
 *
 * Los dos primeros criterios COLAPSAN en `dueDate ASC`: ordenar por vencimiento
 * ascendente ya pone primero lo vencido mas viejo y despues lo que vence antes.
 * `NULLS LAST` manda al final lo que no tiene fecha, y el desempate por `id`
 * hace la salida DETERMINISTICA: sin el, dos entregas del mismo dia podrian
 * repartirse en cualquier orden y la misma operacion daria resultados distintos
 * en dos corridas.
 *
 * Solo mira recepciones con `debtRecorded`: las anteriores a esta fase no
 * entraron al libro y no son obligaciones. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
 *
 * LO DEVUELTO SE DESCUENTA, desde la Fase 4C. Una entrega de $100.000 con una
 * devolucion confirmada de $20.000 debe $80.000, y es contra esos $80.000 que se
 * mide lo pagado, lo pendiente y el vencimiento. Solo cuentan las devoluciones
 * CONFIRMADAS: un borrador no saco mercaderia ni emitio credito.
 *
 * `pendiente` nunca es negativo y `exceso` es su contracara. Los dos numeros van
 * por separado a proposito: un pendiente negativo se suma mal --restaria de lo
 * que se debe por otras entregas-- y ademas se lee como si faltara plata cuando
 * lo que sobra es credito.
 */
export async function deudasDeProveedor(
  cliente: Cliente,
  supplierId: number,
  opciones: { soloAbiertas: boolean; soloVencidas?: boolean; inicioDeHoy: string; take?: number },
): Promise<Deuda[]> {
  const { soloAbiertas, inicioDeHoy } = opciones
  const soloVencidas = opciones.soloVencidas ?? false
  const take = opciones.take ?? 500

  const filas = await cliente.$queryRaw<FilaDeuda[]>`
    WITH obligaciones AS (
      SELECT r."id"          AS "receiptId",
             o."id"          AS "orderId",
             o."number"      AS "orderNumber",
             r."receivedAt",
             r."dueDate",
             r."total",
             COALESCE(d.devuelto, 0) AS devuelto,
             COALESCE(a.pagado, 0)   AS pagado,
             r."total" - COALESCE(d.devuelto, 0) AS neto
        FROM "PurchaseReceipt" r
        JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
        LEFT JOIN (
          SELECT "receiptId", sum("amount") AS pagado
            FROM "SupplierPaymentAllocation"
           GROUP BY "receiptId"
        ) a ON a."receiptId" = r."id"
        LEFT JOIN (
          SELECT "purchaseReceiptId", sum("total") AS devuelto
            FROM "PurchaseReturn"
           WHERE "status" = 'CONFIRMED'
           GROUP BY "purchaseReceiptId"
        ) d ON d."purchaseReceiptId" = r."id"
       WHERE o."supplierId" = ${supplierId}
         AND r."debtRecorded" = true
    )
    SELECT "receiptId",
           "orderId",
           "orderNumber",
           "receivedAt",
           "dueDate",
           "total"::numeric(14,2)::text                       AS "total",
           devuelto::numeric(14,2)::text                      AS "devuelto",
           neto::numeric(14,2)::text                          AS "neto",
           pagado::numeric(14,2)::text                        AS "pagado",
           GREATEST(neto - pagado, 0)::numeric(14,2)::text    AS "pendiente",
           GREATEST(pagado - neto, 0)::numeric(14,2)::text    AS "exceso",
           ("dueDate" IS NOT NULL
            AND "dueDate" < ${inicioDeHoy}::timestamp
            AND neto - pagado > 0)                            AS "vencida"
      FROM obligaciones
     WHERE (${!soloAbiertas} OR neto - pagado > 0)
       AND (${!soloVencidas} OR ("dueDate" IS NOT NULL
                                 AND "dueDate" < ${inicioDeHoy}::timestamp
                                 AND neto - pagado > 0))
     ORDER BY "dueDate" ASC NULLS LAST, "receivedAt" ASC, "receiptId" ASC
     LIMIT ${take}
  `

  return filas.map((f) => ({
    receiptId: f.receiptId,
    orderId: f.orderId,
    orderNumber: f.orderNumber,
    receivedAt: f.receivedAt,
    dueDate: f.dueDate,
    total: f.total,
    devuelto: f.devuelto,
    neto: f.neto,
    pagado: f.pagado,
    pendiente: f.pendiente,
    exceso: f.exceso,
    // Contra el NETO, no contra el original: una entrega devuelta entera y
    // pagada entera esta saldada, no pendiente por lo que costo.
    estado: estadoDeDeuda(dinero(f.neto), dinero(f.pagado), f.vencida),
  }))
}

/** Las deudas de un proveedor, paginadas. Es la tabla del objetivo 27. */
export async function listarDeudas(
  session: Session,
  supplierId: number,
  query: ListarDeudasQuery,
): Promise<Paginated<Deuda>> {
  await proveedorDeCuenta(supplierId)
  const inicioDeHoy = await inicioDeHoyEnSucursal(prisma, session.branchId)

  // Se pagina en memoria a proposito, y solo aca: la consulta ya viene acotada
  // a 500 filas y ordenada por la regla FIFO, que es un orden que PostgreSQL no
  // puede combinar con un OFFSET sin repetir el calculo del pendiente. Un
  // proveedor con mas de 500 entregas SIN SALDAR seria un problema de otra
  // naturaleza --y el filtro `abiertas` es el que se usa siempre--.
  const todas = await deudasDeProveedor(prisma, supplierId, {
    soloAbiertas: query.abiertas,
    soloVencidas: query.vencidas,
    inicioDeHoy,
  })

  const { skip, take } = toSkipTake(query)
  return paginado(todas.slice(skip, skip + take), todas.length, query)
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

export interface ResumenDeCuenta {
  supplierId: number
  name: string
  balance: Monto
  vencido: Monto
  proximoVencimiento: Date | null
  ultimaCompra: Date | null
  ultimoPago: Date | null
  deudasAbiertas: number
  /** Plata ya entregada que todavia no se aplico a ninguna entrega. Fase 4C. */
  sinImputar: Monto
  /** Cuantos pagos tienen saldo disponible. Fase 4C. */
  pagosConSaldo: number
  /** Cuanto se le devolvio, al costo historico. Fase 4C. */
  devuelto: Monto
  devoluciones: number
}

/**
 * Los numeros de la cabecera de la ficha, en una sola pasada.
 *
 * `balance` y `sinImputar` NO son lo mismo y conviven a proposito. El saldo dice
 * cuanto se le debe al proveedor en total; lo sin imputar dice cuanta plata ya
 * entregada no esta aplicada a ninguna entrega concreta. Con un saldo de $0 y
 * $15.000 sin imputar --un anticipo que todavia no encontro su compra-- las dos
 * cifras son ciertas y dicen cosas distintas.
 */
export async function resumenDeCuenta(
  session: Session,
  supplierId: number,
): Promise<ResumenDeCuenta> {
  const proveedor = await proveedorDeCuenta(supplierId)
  const inicioDeHoy = await inicioDeHoyEnSucursal(prisma, session.branchId)

  const [abiertas, ultimaCompra, ultimoPago, anticipos, devoluciones] = await Promise.all([
    deudasDeProveedor(prisma, supplierId, { soloAbiertas: true, inicioDeHoy }),
    prisma.purchaseReceipt.findFirst({
      where: { order: { supplierId } },
      select: { receivedAt: true },
      orderBy: { receivedAt: 'desc' },
    }),
    prisma.supplierPayment.findFirst({
      where: { supplierId },
      select: { paidAt: true },
      orderBy: { paidAt: 'desc' },
    }),
    creditoDisponible(prisma, supplierId),
    prisma.purchaseReturn.aggregate({
      where: { supplierId, status: 'CONFIRMED' },
      _sum: { total: true },
      _count: { _all: true },
    }),
  ])

  const vencido = abiertas
    .filter((d) => d.estado === 'VENCIDA')
    .reduce((total, d) => total.plus(d.pendiente), CERO_D)

  // La lista ya viene ordenada por vencimiento con los nulos al final, asi que
  // el primero con fecha es el proximo. Recorrerla es mas barato que otra
  // consulta y no puede discrepar con lo que muestra la tabla.
  const proximo = abiertas.find((d) => d.dueDate !== null)?.dueDate ?? null

  return {
    supplierId: proveedor.id,
    name: proveedor.name,
    balance: aMonto(proveedor.balance),
    vencido: aMonto(vencido),
    proximoVencimiento: proximo,
    ultimaCompra: ultimaCompra?.receivedAt ?? null,
    ultimoPago: ultimoPago?.paidAt ?? null,
    deudasAbiertas: abiertas.length,
    sinImputar: aMonto(anticipos.total),
    pagosConSaldo: anticipos.cuantos,
    devuelto: aMonto(devoluciones._sum.total ?? CERO_D),
    devoluciones: devoluciones._count._all,
  }
}

// ---------------------------------------------------------------------------
// Anticipos: plata entregada que todavia no se aplico
// ---------------------------------------------------------------------------

/**
 * Cuanto credito hay disponible con un proveedor, y en cuantos pagos.
 *
 * "Disponible" es `importe - imputado`, pago por pago. La suma se hace EN LA
 * BASE: un proveedor de dos anios tiene cientos de pagos, y traerlos para sumar
 * en JavaScript es exactamente lo que este proyecto no hace.
 *
 * NO es lo mismo que un saldo negativo. El saldo puede estar en cero --se le
 * debe justo lo que se le pago-- y haber igual un anticipo sin imputar, porque
 * la deuda que lo compensa esta en otra entrega. Son dos preguntas distintas y
 * se contestan por separado.
 */
export async function creditoDisponible(
  cliente: Cliente,
  supplierId: number,
): Promise<{ total: Dinero; cuantos: number }> {
  const filas = await cliente.$queryRaw<Array<{ total: string; cuantos: bigint }>>`
    SELECT COALESCE(sum(disponible), 0)::numeric(14,2)::text AS total,
           count(*)                                          AS cuantos
      FROM (
        SELECT p."amount" - COALESCE((
                 SELECT sum(a."amount") FROM "SupplierPaymentAllocation" a
                  WHERE a."paymentId" = p."id"
               ), 0) AS disponible
          FROM "SupplierPayment" p
         WHERE p."supplierId" = ${supplierId}
      ) x
     WHERE disponible > 0
  `
  const f = filas[0]
  return { total: dinero(f?.total ?? '0.00'), cuantos: Number(f?.cuantos ?? 0) }
}

export interface PagoSinImputar {
  paymentId: number
  number: string
  paidAt: Date
  method: string
  methodLabel: string
  amount: Monto
  allocatedAmount: Monto
  unallocatedAmount: Monto
  reference: string | null
}

/**
 * Los pagos de un proveedor con saldo sin imputar. La lista del objetivo 5.
 *
 * Ordenada por FIFO de pagos: el mas antiguo primero, y el id como desempate.
 * Es el mismo orden que usa la aplicacion automatica de anticipos, y vive aca
 * una sola vez para que la pantalla y el servidor no puedan discrepar sobre cual
 * se consume primero.
 */
export async function pagosSinImputar(
  supplierId: number,
  query: { page: number; pageSize: number },
): Promise<Paginated<PagoSinImputar>> {
  await proveedorDeCuenta(supplierId)

  const { skip, take } = toSkipTake(query)

  const [totales, filas] = await Promise.all([
    creditoDisponible(prisma, supplierId),
    prisma.$queryRaw<
      Array<{
        id: number
        number: string
        paidAt: Date
        method: string
        reference: string | null
        amount: string
        imputado: string
        disponible: string
      }>
    >`
      SELECT p."id",
             p."number",
             p."paidAt",
             p."method",
             p."reference",
             p."amount"::numeric(14,2)::text AS "amount",
             imputado::numeric(14,2)::text   AS "imputado",
             (p."amount" - imputado)::numeric(14,2)::text AS "disponible"
        FROM "SupplierPayment" p
        CROSS JOIN LATERAL (
          SELECT COALESCE(sum(a."amount"), 0) AS imputado
            FROM "SupplierPaymentAllocation" a
           WHERE a."paymentId" = p."id"
        ) s
       WHERE p."supplierId" = ${supplierId}
         AND p."amount" - imputado > 0
       ORDER BY p."paidAt" ASC, p."id" ASC
       LIMIT ${take} OFFSET ${skip}
    `,
  ])

  const data = filas.map((f) => ({
    paymentId: f.id,
    number: f.number,
    paidAt: f.paidAt,
    method: f.method,
    methodLabel: etiquetaDeMedio(f.method),
    amount: f.amount,
    allocatedAmount: f.imputado,
    unallocatedAmount: f.disponible,
    reference: f.reference,
  }))

  return paginado(data, totales.cuantos, query)
}

// ---------------------------------------------------------------------------
// Cartera (tablero)
// ---------------------------------------------------------------------------

export interface CarteraDeProveedores {
  total: Monto
  vencido: Monto
  proximos7Dias: Monto
  proveedoresConDeuda: number
  deudasVencidas: number
  comprasPendientes: number
  recepcionesParciales: number
}

/**
 * Lo que se le debe al conjunto de proveedores. El tablero del objetivo 31.
 *
 * TODO AGREGADO EN LA BASE. Ni una consulta trae filas para sumarlas en
 * JavaScript: con cinco mil proveedores, traerlos para sumar sus saldos seria
 * exactamente lo que este proyecto no hace.
 *
 * `total` sale de `Supplier.balance` --el saldo, que es del negocio-- y
 * `vencido` y `proximos7Dias` salen de las OBLIGACIONES, que son por entrega y
 * tienen fecha. Los dos numeros pueden no cerrar entre si, y no es un error: la
 * diferencia es lo pagado sin imputar y lo ajustado a mano, que no cuelga de
 * ninguna entrega. Ver docs/SUPPLIER_PAYMENT_ALLOCATION.md.
 */
export async function carteraDeProveedores(session: Session): Promise<CarteraDeProveedores> {
  const inicioDeHoy = await inicioDeHoyEnSucursal(prisma, session.branchId)

  const [saldos, obligaciones, compras] = await Promise.all([
    prisma.$queryRaw<Array<{ total: string; cuantos: bigint }>>`
      SELECT COALESCE(sum("balance") FILTER (WHERE "balance" > 0), 0)::numeric(14,2)::text AS total,
             count(*) FILTER (WHERE "balance" > 0)                                         AS cuantos
        FROM "Supplier"
    `,
    prisma.$queryRaw<Array<{ vencido: string; proximos: string; cuantas: bigint }>>`
      WITH abiertas AS (
        SELECT r."id",
               r."dueDate",
               -- Lo devuelto se descuenta, igual que en la tabla de deudas: una
               -- entrega devuelta no se reclama, aunque nunca se haya pagado.
               r."total"
                 - COALESCE((
                     SELECT sum(d."total") FROM "PurchaseReturn" d
                      WHERE d."purchaseReceiptId" = r."id" AND d."status" = 'CONFIRMED'
                   ), 0)
                 - COALESCE((
                     SELECT sum(a."amount") FROM "SupplierPaymentAllocation" a
                      WHERE a."receiptId" = r."id"
                   ), 0) AS pendiente
          FROM "PurchaseReceipt" r
         WHERE r."debtRecorded" = true
      )
      SELECT COALESCE(sum(pendiente) FILTER (
               WHERE "dueDate" IS NOT NULL AND "dueDate" < ${inicioDeHoy}::timestamp
             ), 0)::numeric(14,2)::text AS vencido,
             COALESCE(sum(pendiente) FILTER (
               WHERE "dueDate" IS NOT NULL
                 AND "dueDate" >= ${inicioDeHoy}::timestamp
                 AND "dueDate" < ${inicioDeHoy}::timestamp + interval '7 days'
             ), 0)::numeric(14,2)::text AS proximos,
             count(*) FILTER (
               WHERE "dueDate" IS NOT NULL AND "dueDate" < ${inicioDeHoy}::timestamp
             )                          AS cuantas
        FROM abiertas
       WHERE pendiente > 0
    `,
    prisma.purchaseOrder.groupBy({
      by: ['status'],
      where: { branchId: session.branchId, status: { in: ['ORDERED', 'PARTIALLY_RECEIVED'] } },
      _count: { _all: true },
    }),
  ])

  const s = saldos[0]
  const o = obligaciones[0]
  const porEstado = new Map(compras.map((c) => [c.status, c._count._all]))

  return {
    total: s?.total ?? '0.00',
    vencido: o?.vencido ?? '0.00',
    proximos7Dias: o?.proximos ?? '0.00',
    proveedoresConDeuda: Number(s?.cuantos ?? 0),
    deudasVencidas: Number(o?.cuantas ?? 0),
    comprasPendientes: porEstado.get('ORDERED') ?? 0,
    recepcionesParciales: porEstado.get('PARTIALLY_RECEIVED') ?? 0,
  }
}

// ---------------------------------------------------------------------------
// Extracto
// ---------------------------------------------------------------------------

export interface MovimientoDeProveedor {
  id: number
  createdAt: Date
  type: string
  typeLabel: string
  amount: Monto
  previousBalance: Monto
  resultingBalance: Monto
  receiptId: number | null
  paymentId: number | null
  paymentNumber: string | null
  orderNumber: string | null
  reason: string | null
  reference: string | null
  user: { id: number; name: string }
  authorizedBy: { id: number; name: string } | null
}

/**
 * El extracto del proveedor, paginado y en orden cronologico inverso.
 *
 * Siempre paginado: un proveedor de dos anios tiene cientos de movimientos, y
 * no existe endpoint que devuelva el libro entero.
 */
export async function listarMovimientosDeProveedor(
  session: Session,
  supplierId: number,
  query: ListarMovimientosProveedorQuery,
): Promise<Paginated<MovimientoDeProveedor>> {
  await proveedorDeCuenta(supplierId)

  const where: Prisma.SupplierAccountMovementWhereInput = {
    supplierId,
    ...(query.tipo === 'todos' ? {} : { type: query.tipo }),
  }

  const [total, movimientos] = await Promise.all([
    prisma.supplierAccountMovement.count({ where }),
    prisma.supplierAccountMovement.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        type: true,
        amount: true,
        previousBalance: true,
        resultingBalance: true,
        receiptId: true,
        paymentId: true,
        reason: true,
        reference: true,
        user: { select: { id: true, name: true } },
        authorizedBy: { select: { id: true, name: true } },
        payment: { select: { number: true } },
        receipt: { select: { order: { select: { number: true } } } },
      },
      // Por fecha descendente y, a igualdad de fecha, por id: una recepcion y
      // su cargo comparten el milisegundo, y sin el segundo criterio el orden
      // entre dos movimientos cambiaria de una consulta a otra.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = movimientos.map(({ payment, receipt, ...m }) => ({
    ...m,
    typeLabel: etiquetaDeProveedor(m.type),
    amount: aMonto(m.amount),
    previousBalance: aMonto(m.previousBalance),
    resultingBalance: aMonto(m.resultingBalance),
    paymentNumber: payment?.number ?? null,
    orderNumber: receipt?.order.number ?? null,
  }))

  return paginado(data, total, query)
}

// ---------------------------------------------------------------------------
// Nota de credito
// ---------------------------------------------------------------------------

/**
 * Registra una nota de credito del proveedor.
 *
 * NO modifica ninguna recepcion historica, que es lo que pide el objetivo 12:
 * escribe un movimiento nuevo, negativo, con su motivo y con el numero del
 * documento del proveedor. Corregir el pasado seria reescribir la historia
 * financiera; esto la continua.
 *
 * PUEDE dejar el saldo negativo sin autorizacion, y es deliberado: una nota de
 * credito por mas de lo que se debe es un hecho que ya ocurrio --el proveedor
 * la emitio-- y rechazarla obligaria a no registrarla o a partirla en dos. El
 * sobrepago es lo contrario: ahi somos nosotros los que decidimos entregar de
 * mas. Por eso este camino pasa autorizante y el pago no.
 */
export async function registrarNotaDeCredito(
  session: Session,
  supplierId: number,
  input: NotaDeCreditoInput,
) {
  const proveedor = await proveedorDeCuenta(supplierId)
  const importe = dinero(input.amount)

  return prisma.$transaction(async (tx) => {
    const movimiento = await applySupplierAccountMovement(tx, {
      branchId: session.branchId,
      supplierId,
      type: 'PURCHASE_CREDIT',
      // NEGATIVO: una nota de credito reduce lo que le debemos.
      amount: negar(importe),
      userId: session.userId,
      reason: input.reason,
      reference: input.reference ?? null,
      // Ver arriba: la nota de credito no pasa por la comprobacion de
      // sobrepago. Queda registrado quien la cargo, que es lo que importa.
      authorizedById: session.userId,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'SupplierAccountMovement',
      recordId: movimiento.movementId,
      action: 'create',
      reason: input.reason,
      before: { saldo: aMonto(movimiento.previousBalance) },
      after: {
        tipo: 'PURCHASE_CREDIT',
        supplierId,
        proveedor: proveedor.name,
        importe: aMonto(importe),
        saldo: aMonto(movimiento.resultingBalance),
        documento: input.reference ?? null,
      },
      origin: 'POST /api/suppliers/:id/nota-credito',
    })

    return {
      movementId: movimiento.movementId,
      supplierId,
      supplierName: proveedor.name,
      amount: aMonto(importe),
      previousBalance: aMonto(movimiento.previousBalance),
      resultingBalance: aMonto(movimiento.resultingBalance),
      reason: input.reason,
      reference: input.reference ?? null,
    }
  })
}

// ---------------------------------------------------------------------------
// Ajuste manual
// ---------------------------------------------------------------------------

/**
 * Corrige un saldo con un movimiento nuevo.
 *
 * Se declara el DELTA, no el saldo final, por lo mismo que en la cuenta del
 * cliente: "sumale 80.000 por deuda anterior a la migracion" deja un movimiento
 * que se entiende dentro de dos anios; "poneme el saldo en 80.000" no dice de
 * donde salieron ni contra que saldo se estaba operando.
 *
 * Es el camino previsto para cargar la deuda ANTERIOR a esta fase, que la
 * migracion no inventa. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
 */
export async function ajustarCuentaDeProveedor(
  session: Session,
  supplierId: number,
  input: AjustarProveedorInput,
) {
  const proveedor = await proveedorDeCuenta(supplierId)
  const delta = dinero(input.delta)

  return prisma.$transaction(async (tx) => {
    const movimiento = await applySupplierAccountMovement(tx, {
      branchId: session.branchId,
      supplierId,
      type: 'MANUAL_ADJUSTMENT',
      amount: delta,
      userId: session.userId,
      reason: input.reason,
      // Un ajuste no pasa por la comprobacion de sobrepago: corregir hacia
      // abajo el saldo de alguien a quien se le pago de mas tiene que poder
      // hacerse. El permiso (`supplierAccounts.adjust`) es lo que lo restringe.
      authorizedById: session.userId,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'SupplierAccountMovement',
      recordId: movimiento.movementId,
      action: 'create',
      reason: input.reason,
      before: { saldo: aMonto(movimiento.previousBalance) },
      after: {
        tipo: 'MANUAL_ADJUSTMENT',
        supplierId,
        proveedor: proveedor.name,
        delta: aMonto(delta),
        saldo: aMonto(movimiento.resultingBalance),
        motivo: input.reason,
      },
      origin: 'POST /api/suppliers/:id/ajuste',
    })

    return {
      movementId: movimiento.movementId,
      supplierId,
      supplierName: proveedor.name,
      delta: aMonto(delta),
      previousBalance: aMonto(movimiento.previousBalance),
      resultingBalance: aMonto(movimiento.resultingBalance),
      reason: input.reason,
    }
  })
}

// ---------------------------------------------------------------------------
// Vencimiento
// ---------------------------------------------------------------------------

/**
 * Cambia el vencimiento de una obligacion.
 *
 * Es la UNICA columna de una recepcion que se puede corregir, y no es una
 * excepcion arbitraria: el vencimiento no es un hecho sobre la mercaderia --no
 * movio stock ni cambio un costo-- sino una condicion comercial que se acuerda
 * entre personas. El disparador de PostgreSQL lo hace cumplir comparando la
 * fila ENTERA menos esa columna, asi que cualquier otro cambio se rechaza
 * aunque pase por este camino.
 *
 * Exige motivo y queda auditado con el antes y el despues, que es lo que pide
 * el objetivo 33.
 */
export async function cambiarVencimiento(
  session: Session,
  receiptId: number,
  input: CambiarVencimientoInput,
) {
  const recepcion = await prisma.purchaseReceipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      dueDate: true,
      debtRecorded: true,
      branchId: true,
      order: { select: { number: true, supplierId: true, supplier: { select: { name: true } } } },
    },
  })
  if (!recepcion) throw notFound('La recepción no existe')

  if (!recepcion.debtRecorded) {
    throw conflict(
      'Esta recepción es anterior a las cuentas por pagar: no tiene una obligación con ' +
        'vencimiento. Si hay deuda pendiente por ella, registrala con un ajuste.',
      { code: 'RECEIPT_NOT_TRACKED' },
    )
  }

  // La fecha llega como `YYYY-MM-DD` y se convierte con la zona de LA SUCURSAL
  // DE LA RECEPCION, no con la del servidor ni con la de quien opera. Es la
  // regla unica del sistema desde la Fase 3D: el navegador manda el dia, el
  // servidor lo convierte con la zona que corresponde.
  if (input.dueDate !== null && !esFechaLocal(input.dueDate)) {
    throw invalid('La fecha de vencimiento no es válida')
  }
  const nueva =
    input.dueDate === null
      ? null
      : inicioDelDia(input.dueDate, await zonaDeSucursal(prisma, recepcion.branchId))

  const antes = recepcion.dueDate

  return prisma.$transaction(async (tx) => {
    await tx.purchaseReceipt.update({ where: { id: receiptId }, data: { dueDate: nueva } })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseReceipt',
      recordId: receiptId,
      action: 'update',
      reason: input.reason,
      before: { dueDate: antes?.toISOString() ?? null },
      after: {
        dueDate: nueva?.toISOString() ?? null,
        orden: recepcion.order.number,
        proveedor: recepcion.order.supplier.name,
      },
      origin: 'PATCH /api/purchases/recepciones/:id/vencimiento',
    })

    return {
      receiptId,
      orderNumber: recepcion.order.number,
      supplierId: recepcion.order.supplierId,
      dueDate: nueva,
      reason: input.reason,
    }
  })
}
