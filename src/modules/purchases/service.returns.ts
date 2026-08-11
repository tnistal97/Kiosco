/**
 * Devoluciones a proveedor.
 *
 * Cinco invariantes que atraviesan el modulo:
 *
 *   1. Se devuelve SIEMPRE contra una entrega concreta. De ahi salen el costo,
 *      la unidad y el tope; ninguno de los tres se inventa ni se acepta del
 *      navegador.
 *   2. El costo es el CONGELADO en la recepcion, nunca `Product.cost`. Una caja
 *      que entro a $1.100 se acredita a $1.100 aunque hoy salga $1.350.
 *   3. Un borrador NO MUEVE NADA. El stock sale y el credito nace al CONFIRMAR,
 *      en una sola transaccion.
 *   4. Dos topes simultaneos, y los dos hacen falta: lo recibido neto no
 *      devuelto, y el stock que hay hoy. Se recibieron 10, se vendieron 8:
 *      devolver 5 se rechaza aunque historicamente hayan entrado 10.
 *   5. Una devolucion confirmada es INMUTABLE. Hay un disparador en la base.
 *
 * El stock NO se toca desde aca: se llama a `applyStockMovement`. El saldo del
 * proveedor tampoco: se llama a `applySupplierAccountMovement`. Las dos son las
 * unicas puertas de sus tablas y hay reglas de ESLint que lo impiden.
 *
 * Ver docs/PURCHASE_RETURN_FLOW.md y docs/PURCHASE_RETURN_ACCOUNTING.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, invalid, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { Monto } from '@/lib/money'
import type { TextoCantidad } from '@/lib/cantidad'
import { CERO_D, aMonto, aMontoCosto, multiplicar, redondearPesos, sumar } from '@/server/money'
import {
  CERO_C,
  aTextoCantidad,
  cantidad as aCantidad,
  esPositivaCantidad,
  restarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import { applyStockMovement, type TxClient } from '@/modules/inventory/service'
import { applySupplierAccountMovement } from '@/modules/suppliers/cuenta'
import {
  NOMBRE_DE_UNIDAD_DE_COMPRA,
  unidadDeCompraODefecto,
  unidadDeVentaODefecto,
  type UnidadDeCompra,
  type UnidadDeVenta,
} from '@/modules/products/units'
import {
  etiquetaDeEstadoDeDevolucion,
  etiquetaDeMotivo,
  sePuedeCancelarDevolucion,
  sePuedeConfirmarDevolucion,
  sePuedeEditarDevolucion,
  type EstadoDeDevolucion,
} from './return-status'
import type {
  CancelarDevolucionInput,
  CrearDevolucionInput,
  EditarDevolucionInput,
  LineaDeDevolucionInput,
  ListarDevolucionesQuery,
} from './schemas.returns'

/**
 * Una cantidad de compra con su unidad, para un mensaje de error. "2 caja(s)".
 *
 * No usa `formatearCantidadConUnidad`, que es para unidades de VENTA: `PACK` y
 * `BOX` no existen en ese catalogo, y forzarlas dentro obligaria a darles una
 * politica de fraccionamiento que no tiene sentido tener --media caja no es
 * media unidad de nada--.
 *
 * Los ceros de la derecha se recortan: "2 caja(s)" se lee y "2.000 caja(s)" hace
 * dudar de si son dos mil.
 */
function conUnidadDeCompra(c: TextoCantidad, unidad: UnidadDeCompra): string {
  const limpio = c.includes('.') ? c.replace(/0+$/, '').replace(/\.$/, '') : c
  return `${limpio} ${NOMBRE_DE_UNIDAD_DE_COMPRA[unidad].toLowerCase()}(s)`
}

// ---------------------------------------------------------------------------
// Numeracion
// ---------------------------------------------------------------------------

/**
 * El siguiente numero de devolucion. `DV-00000124`.
 *
 * Sale de una SECUENCIA de PostgreSQL, no de `count() + 1`, por lo mismo que el
 * numero de orden, el de recepcion y el de pago: dos devoluciones creadas en el
 * mismo segundo leerian el mismo contador y el indice unico rechazaria a una de
 * las dos.
 *
 * Se pide FUERA de la transaccion a proposito: `nextval` no se deshace con un
 * ROLLBACK, asi que pedirlo adentro no evitaria el hueco y solo alargaria la
 * transaccion.
 */
async function siguienteNumeroDeDevolucion(): Promise<string> {
  const filas = await prisma.$queryRaw<Array<{ n: bigint }>>`
    SELECT nextval('"PurchaseReturn_numero_seq"') AS n
  `
  const n = filas[0]?.n
  if (n === undefined) throw new Error('No se pudo obtener el numero de devolucion')
  return `DV-${String(n).padStart(8, '0')}`
}

// ---------------------------------------------------------------------------
// Que se puede devolver
// ---------------------------------------------------------------------------

export interface RenglonRetornable {
  receiptItemId: number
  productId: number
  productName: string
  saleUnit: UnidadDeVenta
  purchaseUnit: UnidadDeCompra
  unitsPerPurchaseUnit: TextoCantidad
  /** EN UNIDAD DE COMPRA. Lo que llego por esta entrega. */
  recibido: TextoCantidad
  /** EN UNIDAD DE COMPRA. Lo ya devuelto por devoluciones CONFIRMADAS. */
  devuelto: TextoCantidad
  /** `recibido - devuelto`. El tope historico. */
  disponible: TextoCantidad
  /** EN UNIDAD DE VENTA. Lo que hay hoy en el deposito: el otro tope. */
  stockActual: TextoCantidad
  /** Costo por unidad de compra, CONGELADO en la recepcion. */
  unitCost: string
}

export interface Retornables {
  receiptId: number
  orderNumber: string
  receivedAt: Date
  supplier: { id: number; name: string }
  lineas: RenglonRetornable[]
}

/** Fila cruda del calculo de retornables. */
interface FilaRetornable {
  receiptItemId: number
  productId: number
  productName: string
  saleUnit: string | null
  purchaseUnit: string
  unitsPerPurchaseUnit: Cantidad
  recibido: Cantidad
  devuelto: Cantidad
  stockActual: Cantidad | null
  unitCost: Prisma.Decimal
}

/**
 * Lo que todavia se puede devolver de una entrega. La pantalla del objetivo 19.
 *
 * Los DOS topes en una consulta: lo recibido menos lo ya devuelto, y el stock
 * que hay hoy. La pantalla los muestra a los dos porque son dos motivos
 * distintos de no poder devolver, y decir solo "no se puede" obliga a adivinar
 * cual de los dos es.
 *
 * Solo cuentan las devoluciones CONFIRMADAS. Un borrador no saco mercaderia: si
 * descontara, dos personas armando borradores se estorbarian sin que ninguna
 * haya devuelto nada, y un borrador abandonado dejaria mercaderia bloqueada para
 * siempre.
 */
export async function retornablesDeRecepcion(
  session: Session,
  receiptId: number,
): Promise<Retornables> {
  const recepcion = await prisma.purchaseReceipt.findFirst({
    where: { id: receiptId, branchId: session.branchId },
    select: {
      id: true,
      receivedAt: true,
      order: { select: { number: true, supplier: { select: { id: true, name: true } } } },
    },
  })
  // Mismo trato que "no existe": no se confirma que exista en otra sucursal.
  if (!recepcion) throw notFound('La recepción no existe')

  const filas = await prisma.$queryRaw<FilaRetornable[]>`
    SELECT ri."id"                    AS "receiptItemId",
           ri."productId",
           p."name"                   AS "productName",
           p."saleUnit",
           ri."purchaseUnit",
           ri."unitsPerPurchaseUnit",
           ri."receivedQuantity"      AS "recibido",
           ri."unitCost",
           COALESCE((
             SELECT sum(di."quantity")
               FROM "PurchaseReturnItem" di
               JOIN "PurchaseReturn" d ON d."id" = di."purchaseReturnId"
              WHERE di."purchaseReceiptItemId" = ri."id" AND d."status" = 'CONFIRMED'
           ), 0)                      AS "devuelto",
           bs."quantity"              AS "stockActual"
      FROM "PurchaseReceiptItem" ri
      JOIN "Product" p ON p."id" = ri."productId"
      LEFT JOIN "BranchStock" bs
        ON bs."productId" = ri."productId" AND bs."branchId" = ${session.branchId}
     WHERE ri."purchaseReceiptId" = ${receiptId}
     ORDER BY ri."id"
  `

  return {
    receiptId: recepcion.id,
    orderNumber: recepcion.order.number,
    receivedAt: recepcion.receivedAt,
    supplier: recepcion.order.supplier,
    lineas: filas.map((f) => ({
      receiptItemId: f.receiptItemId,
      productId: f.productId,
      productName: f.productName,
      saleUnit: unidadDeVentaODefecto(f.saleUnit),
      purchaseUnit: unidadDeCompraODefecto(f.purchaseUnit),
      unitsPerPurchaseUnit: aTextoCantidad(f.unitsPerPurchaseUnit),
      recibido: aTextoCantidad(f.recibido),
      devuelto: aTextoCantidad(f.devuelto),
      disponible: aTextoCantidad(restarCantidades(f.recibido, f.devuelto)),
      stockActual: aTextoCantidad(f.stockActual ?? CERO_C),
      unitCost: aMontoCosto(f.unitCost),
    })),
  }
}

// ---------------------------------------------------------------------------
// Escritura: el borrador
// ---------------------------------------------------------------------------

/**
 * Resuelve los renglones pedidos contra las lineas de la recepcion.
 *
 * Es donde se congelan los cuatro numeros que la devolucion NO acepta del
 * navegador: la unidad, el factor de conversion, el costo y el importe. Los
 * cuatro salen de la linea de la recepcion original.
 *
 * El tope historico se comprueba aca tambien --da un mensaje mejor, con nombre de
 * producto y cantidades-- pero NO es aca donde se hace cumplir: al confirmar se
 * vuelve a comprobar bajo bloqueo de fila, que es lo unico que resiste dos
 * devoluciones simultaneas. Ver `confirmarDevolucion`.
 */
async function resolverRenglones(
  tx: TxClient,
  receiptId: number,
  pedidos: readonly LineaDeDevolucionInput[],
) {
  const lineas = await tx.purchaseReceiptItem.findMany({
    where: { id: { in: pedidos.map((p) => p.receiptItemId) }, purchaseReceiptId: receiptId },
    select: {
      id: true,
      productId: true,
      receivedQuantity: true,
      purchaseUnit: true,
      unitsPerPurchaseUnit: true,
      unitCost: true,
      product: { select: { name: true, saleUnit: true } },
    },
  })
  const porId = new Map(lineas.map((l) => [l.id, l]))

  const yaDevuelto = await devueltoPorLinea(
    tx,
    pedidos.map((p) => p.receiptItemId),
  )

  return pedidos.map((pedido) => {
    const linea = porId.get(pedido.receiptItemId)
    if (!linea) {
      throw conflict(`El renglón #${String(pedido.receiptItemId)} no es de esta entrega.`, {
        code: 'RETURN_ITEM_MISMATCH',
      })
    }

    const purchaseUnit = unidadDeCompraODefecto(linea.purchaseUnit)
    const cuanto = aCantidad(pedido.quantity)
    const disponible = restarCantidades(
      linea.receivedQuantity,
      yaDevuelto.get(pedido.receiptItemId) ?? CERO_C,
    )

    if (cuanto.greaterThan(disponible)) {
      throw conflict(
        `De "${linea.product.name}" llegaron ` +
          `${conUnidadDeCompra(aTextoCantidad(linea.receivedQuantity), purchaseUnit)} y ` +
          `quedan ${conUnidadDeCompra(aTextoCantidad(disponible), purchaseUnit)} sin ` +
          `devolver: no se pueden devolver ` +
          `${conUnidadDeCompra(pedido.quantity, purchaseUnit)}.`,
        { code: 'RETURN_EXCEEDS_RECEIVED' },
      )
    }

    // La conversion a unidad de venta, con el factor de LA RECEPCION. Es lo que
    // sale del deposito, y el CHECK de la base comprueba que los tres numeros
    // concuerden.
    const stockQuantity = cuanto.times(linea.unitsPerPurchaseUnit)

    return {
      receiptItemId: linea.id,
      productId: linea.productId,
      productName: linea.product.name,
      saleUnit: unidadDeVentaODefecto(linea.product.saleUnit),
      quantity: cuanto,
      purchaseUnit,
      unitsPerPurchaseUnit: linea.unitsPerPurchaseUnit,
      stockQuantity,
      unitCost: linea.unitCost,
      // Redondeado A PESOS renglon por renglon y despues sumado, en ese orden:
      // es como se arma cualquier documento con importes, y sumar exacto para
      // redondear al final daria un total distinto del que muestra la pantalla.
      amount: redondearPesos(multiplicar(linea.unitCost, cuanto)),
    }
  })
}

/**
 * Lo ya devuelto de cada linea de recepcion, por devoluciones CONFIRMADAS.
 *
 * Se lee aparte y no con un `include` porque hay que poder pedirlo DESPUES de
 * haber tomado el bloqueo de las lineas, en una sentencia propia. Ver la nota de
 * `confirmarDevolucion` sobre por que el orden de las dos sentencias es el
 * mecanismo entero.
 */
async function devueltoPorLinea(
  tx: TxClient,
  receiptItemIds: readonly number[],
): Promise<Map<number, Cantidad>> {
  if (receiptItemIds.length === 0) return new Map()

  const filas = await tx.$queryRaw<Array<{ id: number; devuelto: Cantidad }>>`
    SELECT di."purchaseReceiptItemId" AS "id",
           sum(di."quantity")         AS "devuelto"
      FROM "PurchaseReturnItem" di
      JOIN "PurchaseReturn" d ON d."id" = di."purchaseReturnId"
     WHERE di."purchaseReceiptItemId" = ANY(${[...receiptItemIds]}::int[])
       AND d."status" = 'CONFIRMED'
     GROUP BY di."purchaseReceiptItemId"
  `
  return new Map(filas.map((f) => [f.id, f.devuelto]))
}

export interface ResultadoDeDevolucion {
  id: number
  number: string
  status: EstadoDeDevolucion
  statusLabel: string
  supplierId: number
  supplierName: string
  receiptId: number
  orderNumber: string
  reason: string
  reasonLabel: string
  notes: string | null
  total: Monto
  lineas: Array<{
    productId: number
    productName: string
    quantity: TextoCantidad
    purchaseUnit: UnidadDeCompra
    stockQuantity: TextoCantidad
    unitCost: string
    amount: Monto
  }>
}

/**
 * Crea una devolucion en BORRADOR.
 *
 * No mueve stock ni saldo: eso es `confirmarDevolucion`. Lo que hace es congelar
 * los costos y dejar el papel armado para que alguien lo revise antes de que la
 * mercaderia salga.
 */
export async function crearDevolucion(
  session: Session,
  input: CrearDevolucionInput,
): Promise<ResultadoDeDevolucion> {
  const recepcion = await prisma.purchaseReceipt.findFirst({
    where: { id: input.purchaseReceiptId, branchId: session.branchId },
    select: {
      id: true,
      debtRecorded: true,
      order: { select: { number: true, supplierId: true, supplier: { select: { name: true } } } },
    },
  })
  if (!recepcion) throw notFound('La recepción no existe')

  const number = await siguienteNumeroDeDevolucion()

  return prisma.$transaction(async (tx) => {
    const renglones = await resolverRenglones(tx, recepcion.id, input.items)
    const total = renglones.reduce((suma, r) => sumar(suma, r.amount), CERO_D)

    const devolucion = await tx.purchaseReturn.create({
      data: {
        number,
        branchId: session.branchId,
        supplierId: recepcion.order.supplierId,
        purchaseReceiptId: recepcion.id,
        status: 'DRAFT',
        reason: input.reason,
        notes: input.notes ?? null,
        total,
        createdById: session.userId,
        items: {
          create: renglones.map((r) => ({
            productId: r.productId,
            purchaseReceiptItemId: r.receiptItemId,
            quantity: r.quantity,
            purchaseUnit: r.purchaseUnit,
            unitsPerPurchaseUnit: r.unitsPerPurchaseUnit,
            stockQuantity: r.stockQuantity,
            unitCost: r.unitCost,
            amount: r.amount,
          })),
        },
      },
      select: { id: true },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseReturn',
      recordId: devolucion.id,
      action: 'create',
      reason: input.notes ?? null,
      after: {
        numero: number,
        estado: 'DRAFT',
        receiptId: recepcion.id,
        orden: recepcion.order.number,
        supplierId: recepcion.order.supplierId,
        motivo: input.reason,
        renglones: renglones.length,
        importe: aMonto(total),
      },
      origin: 'POST /api/devoluciones',
    })

    return armarResultado({
      id: devolucion.id,
      number,
      status: 'DRAFT',
      supplierId: recepcion.order.supplierId,
      supplierName: recepcion.order.supplier.name,
      receiptId: recepcion.id,
      orderNumber: recepcion.order.number,
      reason: input.reason,
      notes: input.notes ?? null,
      total,
      renglones,
    })
  })
}

/**
 * Reemplaza los renglones y el motivo de un BORRADOR.
 *
 * Los renglones se borran y se vuelven a crear en vez de compararse uno por uno.
 * Es lo mismo que hace la edicion de una orden de compra, y por lo mismo: un
 * borrador no tiene historia que conservar, y el disparador de inmutabilidad
 * permite borrar sus renglones justamente porque todavia no ocurrio nada.
 */
export async function editarDevolucion(
  session: Session,
  id: number,
  input: EditarDevolucionInput,
): Promise<ResultadoDeDevolucion> {
  return prisma.$transaction(async (tx) => {
    const devolucion = await devolucionParaEscribir(
      tx,
      session,
      id,
      sePuedeEditarDevolucion,
      'editar',
    )

    const renglones = await resolverRenglones(tx, devolucion.purchaseReceiptId, input.items)
    const total = renglones.reduce((suma, r) => sumar(suma, r.amount), CERO_D)

    await tx.purchaseReturnItem.deleteMany({ where: { purchaseReturnId: id } })

    await tx.purchaseReturn.update({
      where: { id },
      data: {
        reason: input.reason,
        notes: input.notes ?? null,
        total,
        items: {
          create: renglones.map((r) => ({
            productId: r.productId,
            purchaseReceiptItemId: r.receiptItemId,
            quantity: r.quantity,
            purchaseUnit: r.purchaseUnit,
            unitsPerPurchaseUnit: r.unitsPerPurchaseUnit,
            stockQuantity: r.stockQuantity,
            unitCost: r.unitCost,
            amount: r.amount,
          })),
        },
      },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseReturn',
      recordId: id,
      action: 'update',
      before: { importe: aMonto(devolucion.total), motivo: devolucion.reason },
      after: {
        numero: devolucion.number,
        motivo: input.reason,
        renglones: renglones.length,
        importe: aMonto(total),
      },
      origin: 'PATCH /api/devoluciones/:id',
    })

    return armarResultado({
      id,
      number: devolucion.number,
      status: 'DRAFT',
      supplierId: devolucion.supplierId,
      supplierName: devolucion.supplier.name,
      receiptId: devolucion.purchaseReceiptId,
      orderNumber: devolucion.receipt.order.number,
      reason: input.reason,
      notes: input.notes ?? null,
      total,
      renglones,
    })
  })
}

/** Descarta un borrador. Solo antes de confirmar: despues no hay nada que descartar. */
export async function cancelarDevolucion(
  session: Session,
  id: number,
  input: CancelarDevolucionInput,
) {
  return prisma.$transaction(async (tx) => {
    const devolucion = await devolucionParaEscribir(
      tx,
      session,
      id,
      sePuedeCancelarDevolucion,
      'cancelar',
    )

    await tx.purchaseReturn.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledById: session.userId,
        cancelReason: input.reason,
      },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseReturn',
      recordId: id,
      action: 'update',
      reason: input.reason,
      before: { estado: devolucion.status },
      after: { estado: 'CANCELLED', numero: devolucion.number, motivo: input.reason },
      origin: 'POST /api/devoluciones/:id/cancelar',
    })

    return { id, number: devolucion.number, status: 'CANCELLED' as const }
  })
}

// ---------------------------------------------------------------------------
// Escritura: la confirmacion
// ---------------------------------------------------------------------------

export interface ResultadoDeConfirmacion extends ResultadoDeDevolucion {
  /** El saldo del proveedor DESPUES del credito. Negativo = a favor nuestro. */
  saldoProveedor: Monto
  /** Cuanto quedo a favor NUESTRO. `"0.00"` si el saldo no quedo negativo. */
  saldoAFavor: Monto
  movimientos: Array<{
    productId: number
    productName: string
    salio: TextoCantidad
    stockAnterior: TextoCantidad
    stockResultante: TextoCantidad
  }>
}

/**
 * Confirma una devolucion. LA operacion del modulo.
 *
 * UNA transaccion y todo o nada: si el tercer producto de cinco no tiene stock,
 * no sale ninguno y no se emite ningun credito.
 *
 * EL TOPE HISTORICO SE COMPRUEBA BAJO BLOQUEO DE FILA, y el orden de las dos
 * sentencias es el mecanismo entero:
 *
 *   1. `SELECT ... FOR UPDATE` sobre las lineas de la recepcion, por id
 *      ascendente. Ordenadas, porque dos confirmaciones que tomen los mismos
 *      bloqueos en distinto orden se traban entre si para siempre.
 *   2. RECIEN DESPUES, la suma de lo ya devuelto.
 *
 * Tienen que ser dos sentencias. En una sola, la suma se evaluaria con la
 * instantanea tomada ANTES de esperar el bloqueo, y las dos transacciones verian
 * "quedan 10" y las dos devolverian 8. Con dos, la segunda espera, y cuando
 * entra vuelve a sumar --ya con la devolucion de la primera confirmada-- y ve
 * que quedan 2.
 *
 * Es la misma idea que `balance + delta >= 0` del libro, resuelta distinto
 * porque el tope no vive en la fila que se escribe: la linea de la recepcion es
 * INMUTABLE y no se le puede sumar un contador. Se la usa como punto de
 * encuentro y nada mas.
 *
 * EL SEGUNDO TOPE --que haya stock-- lo hace cumplir `applyStockMovement`, con
 * su propia condicion en la misma sentencia que descuenta. Es el objetivo 13:
 * entraron 10, se vendieron 8, quedan 2, y devolver 5 se rechaza aunque
 * historicamente hayan entrado 10.
 */
export async function confirmarDevolucion(
  session: Session,
  id: number,
): Promise<ResultadoDeConfirmacion> {
  return prisma.$transaction(async (tx) => {
    const devolucion = await devolucionParaEscribir(
      tx,
      session,
      id,
      sePuedeConfirmarDevolucion,
      'confirmar',
    )

    const renglones = await tx.purchaseReturnItem.findMany({
      where: { purchaseReturnId: id },
      select: {
        id: true,
        productId: true,
        purchaseReceiptItemId: true,
        quantity: true,
        purchaseUnit: true,
        unitsPerPurchaseUnit: true,
        stockQuantity: true,
        unitCost: true,
        amount: true,
        product: { select: { name: true, saleUnit: true } },
      },
      orderBy: { purchaseReceiptItemId: 'asc' },
    })

    if (renglones.length === 0) {
      throw conflict(
        `La devolución ${devolucion.number} no tiene renglones: no hay nada que devolver.`,
        { code: 'RETURN_EMPTY' },
      )
    }

    // 1. Los bloqueos, por id ascendente. Ver la nota de arriba.
    const ids = renglones.map((r) => r.purchaseReceiptItemId).sort((a, b) => a - b)
    await tx.$queryRaw`
      SELECT ri."id" FROM "PurchaseReceiptItem" ri
       WHERE ri."id" = ANY(${ids}::int[])
       ORDER BY ri."id"
         FOR UPDATE
    `

    // 2. RECIEN AHORA la suma, en su propia sentencia y con los bloqueos ya
    //    tomados. Esta es la lectura que ve lo que confirmo el que llego antes.
    const [recibido, yaDevuelto] = await Promise.all([
      tx.purchaseReceiptItem.findMany({
        where: { id: { in: ids } },
        select: { id: true, receivedQuantity: true },
      }),
      devueltoPorLinea(tx, ids),
    ])
    const recibidoPorId = new Map(recibido.map((r) => [r.id, r.receivedQuantity]))

    const movimientos: ResultadoDeConfirmacion['movimientos'] = []

    for (const renglon of renglones) {
      const entro = recibidoPorId.get(renglon.purchaseReceiptItemId) ?? CERO_C
      const devuelto = yaDevuelto.get(renglon.purchaseReceiptItemId) ?? CERO_C
      const disponible = restarCantidades(entro, devuelto)
      const purchaseUnit = unidadDeCompraODefecto(renglon.purchaseUnit)

      if (renglon.quantity.greaterThan(disponible)) {
        throw conflict(
          `De "${renglon.product.name}" quedan ` +
            `${conUnidadDeCompra(aTextoCantidad(disponible), purchaseUnit)} sin devolver ` +
            `de ${conUnidadDeCompra(aTextoCantidad(entro), purchaseUnit)} recibidas, y ` +
            `esta devolución pide ` +
            `${conUnidadDeCompra(aTextoCantidad(renglon.quantity), purchaseUnit)}.`,
          { code: 'RETURN_EXCEEDS_RECEIVED' },
        )
      }

      // 3. El stock, por la unica puerta. NEGATIVO: la mercaderia sale.
      //    Aca se hace cumplir el segundo tope, sin ninguna comprobacion nuestra:
      //    la condicion `quantity + delta >= 0` de `applyStockMovement` rechaza
      //    la salida si no hay unidades, y devuelve el mensaje con el saldo real.
      const movimiento = await applyStockMovement(tx, {
        branchId: session.branchId,
        productId: renglon.productId,
        type: 'PURCHASE_RETURN',
        quantity: renglon.stockQuantity.negated(),
        saleUnit: unidadDeVentaODefecto(renglon.product.saleUnit),
        userId: session.userId,
        reason: `Devolución ${devolucion.number} — ${devolucion.supplier.name}`,
        referenceType: 'PurchaseReturn',
        referenceId: id,
      })

      movimientos.push({
        productId: renglon.productId,
        productName: renglon.product.name,
        salio: aTextoCantidad(renglon.stockQuantity),
        stockAnterior: aTextoCantidad(movimiento.previousQuantity),
        stockResultante: aTextoCantidad(movimiento.resultingQuantity),
      })
    }

    // 4. El estado. ANTES del credito, para que el credito ya vea una devolucion
    //    confirmada: la obligacion neta de la entrega la calculan varias
    //    consultas mirando `status = 'CONFIRMED'`.
    const confirmadaEn = new Date()
    await tx.purchaseReturn.update({
      where: { id },
      data: { status: 'CONFIRMED', confirmedAt: confirmadaEn, confirmedById: session.userId },
    })

    // 5. EL CREDITO. Objetivo 14.
    //
    //    Va por la unica puerta que escribe `Supplier.balance`, con `returnId`
    //    --no con un texto-- y no puede duplicarse: hay un indice unico parcial
    //    sobre `returnId`, asi que un reintento que llegara a repetir la
    //    confirmacion choca contra la base y no contra una comprobacion nuestra.
    //
    //    PUEDE DEJAR EL SALDO NEGATIVO SIN PEDIR AUTORIZACION, igual que la nota
    //    de credito y por el mismo motivo: la mercaderia YA SALIO del deposito.
    //    Es un hecho consumado, no una decision que se este tomando ahora.
    //    Rechazarlo obligaria a no registrar la devolucion o a partirla en dos.
    //    Lo que restringe el camino es `purchaseReturns.confirm`. Es el caso del
    //    objetivo 15: se debia $0, se devuelve por $20.000, el saldo queda en
    //    -$20.000 y tenemos credito a favor.
    const credito = await applySupplierAccountMovement(tx, {
      branchId: session.branchId,
      supplierId: devolucion.supplierId,
      type: 'PURCHASE_CREDIT',
      amount: devolucion.total.negated(),
      userId: session.userId,
      returnId: id,
      reason: `Devolución ${devolucion.number} · ${etiquetaDeMotivo(devolucion.reason)}`,
      reference: devolucion.number,
      authorizedById: session.userId,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'PurchaseReturn',
      recordId: id,
      action: 'update',
      before: { estado: 'DRAFT' },
      after: {
        estado: 'CONFIRMED',
        numero: devolucion.number,
        receiptId: devolucion.purchaseReceiptId,
        supplierId: devolucion.supplierId,
        motivo: devolucion.reason,
        importe: aMonto(devolucion.total),
        renglones: renglones.length,
        saldoProveedorAnterior: aMonto(credito.previousBalance),
        saldoProveedorNuevo: aMonto(credito.resultingBalance),
        movimientoId: credito.movementId,
        stock: movimientos.map((m) => ({ productId: m.productId, salio: m.salio })),
      },
      origin: 'POST /api/devoluciones/:id/confirmar',
    })

    return {
      ...armarResultado({
        id,
        number: devolucion.number,
        status: 'CONFIRMED',
        supplierId: devolucion.supplierId,
        supplierName: devolucion.supplier.name,
        receiptId: devolucion.purchaseReceiptId,
        orderNumber: devolucion.receipt.order.number,
        reason: devolucion.reason,
        notes: devolucion.notes,
        total: devolucion.total,
        renglones: renglones.map((r) => ({
          productId: r.productId,
          productName: r.product.name,
          quantity: r.quantity,
          purchaseUnit: unidadDeCompraODefecto(r.purchaseUnit),
          stockQuantity: r.stockQuantity,
          unitCost: r.unitCost,
          amount: r.amount,
        })),
      }),
      saldoProveedor: aMonto(credito.resultingBalance),
      saldoAFavor: credito.resultingBalance.isNegative()
        ? aMonto(credito.resultingBalance.negated())
        : aMonto(CERO_D),
      movimientos,
    }
  })
}

// ---------------------------------------------------------------------------
// Comunes
// ---------------------------------------------------------------------------

/**
 * Carga una devolucion para escribirla, comprobando sucursal y estado.
 *
 * La comprobacion de estado es la misma funcion que usa la pantalla para decidir
 * si dibuja el boton. Con dos copias, un boton habilitado terminaria pegando
 * contra un 409 que el usuario no puede entender.
 */
async function devolucionParaEscribir(
  tx: TxClient,
  session: Session,
  id: number,
  permite: (estado: string) => boolean,
  accion: string,
) {
  const devolucion = await tx.purchaseReturn.findFirst({
    where: { id, branchId: session.branchId },
    select: {
      id: true,
      number: true,
      status: true,
      reason: true,
      notes: true,
      total: true,
      supplierId: true,
      purchaseReceiptId: true,
      supplier: { select: { name: true } },
      receipt: { select: { order: { select: { number: true } } } },
    },
  })
  // Mismo trato que "no existe": no se confirma que exista en otra sucursal.
  if (!devolucion) throw notFound('La devolución no existe')

  if (!permite(devolucion.status)) {
    throw conflict(
      `La devolución ${devolucion.number} está ` +
        `${etiquetaDeEstadoDeDevolucion(devolucion.status).toLowerCase()}: no se puede ${accion}.`,
      { code: 'RETURN_NOT_EDITABLE' },
    )
  }

  return devolucion
}

/** Arma la respuesta. Existe para que los cuatro caminos devuelvan lo mismo. */
function armarResultado(args: {
  id: number
  number: string
  status: EstadoDeDevolucion
  supplierId: number
  supplierName: string
  receiptId: number
  orderNumber: string
  reason: string
  notes: string | null
  total: Prisma.Decimal
  renglones: ReadonlyArray<{
    productId: number
    productName: string
    quantity: Cantidad
    purchaseUnit: UnidadDeCompra
    stockQuantity: Cantidad
    unitCost: Prisma.Decimal
    amount: Prisma.Decimal
  }>
}): ResultadoDeDevolucion {
  return {
    id: args.id,
    number: args.number,
    status: args.status,
    statusLabel: etiquetaDeEstadoDeDevolucion(args.status),
    supplierId: args.supplierId,
    supplierName: args.supplierName,
    receiptId: args.receiptId,
    orderNumber: args.orderNumber,
    reason: args.reason,
    reasonLabel: etiquetaDeMotivo(args.reason),
    notes: args.notes,
    total: aMonto(args.total),
    lineas: args.renglones.map((r) => ({
      productId: r.productId,
      productName: r.productName,
      quantity: aTextoCantidad(r.quantity),
      purchaseUnit: r.purchaseUnit,
      stockQuantity: aTextoCantidad(r.stockQuantity),
      unitCost: aMontoCosto(r.unitCost),
      amount: aMonto(r.amount),
    })),
  }
}

// ---------------------------------------------------------------------------
// Lectura
// ---------------------------------------------------------------------------

export interface DevolucionListada {
  id: number
  number: string
  createdAt: Date
  confirmedAt: Date | null
  status: EstadoDeDevolucion
  statusLabel: string
  supplier: { id: number; name: string }
  receiptId: number
  orderNumber: string
  reason: string
  reasonLabel: string
  total: Monto
  renglones: number
}

const CAMPOS_LISTADO = {
  id: true,
  number: true,
  createdAt: true,
  confirmedAt: true,
  status: true,
  reason: true,
  total: true,
  purchaseReceiptId: true,
  supplier: { select: { id: true, name: true } },
  receipt: { select: { order: { select: { number: true } } } },
  _count: { select: { items: true } },
} as const

/** Las devoluciones de la sucursal, paginadas. */
export async function listarDevoluciones(
  session: Session,
  query: ListarDevolucionesQuery,
): Promise<Paginated<DevolucionListada>> {
  const where: Prisma.PurchaseReturnWhereInput = {
    branchId: session.branchId,
    ...(query.supplierId === undefined ? {} : { supplierId: query.supplierId }),
    ...(query.status === undefined ? {} : { status: query.status }),
    ...(query.q ? { number: { contains: query.q, mode: 'insensitive' as const } } : {}),
  }

  const [total, filas] = await Promise.all([
    prisma.purchaseReturn.count({ where }),
    prisma.purchaseReturn.findMany({
      where,
      select: CAMPOS_LISTADO,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  return paginado(filas.map(aDevolucionListada), total, query)
}

function aDevolucionListada(f: {
  id: number
  number: string
  createdAt: Date
  confirmedAt: Date | null
  status: string
  reason: string
  total: Prisma.Decimal
  purchaseReceiptId: number
  supplier: { id: number; name: string }
  receipt: { order: { number: string } }
  _count: { items: number }
}): DevolucionListada {
  return {
    id: f.id,
    number: f.number,
    createdAt: f.createdAt,
    confirmedAt: f.confirmedAt,
    status: f.status as EstadoDeDevolucion,
    statusLabel: etiquetaDeEstadoDeDevolucion(f.status),
    supplier: f.supplier,
    receiptId: f.purchaseReceiptId,
    orderNumber: f.receipt.order.number,
    reason: f.reason,
    reasonLabel: etiquetaDeMotivo(f.reason),
    total: aMonto(f.total),
    renglones: f._count.items,
  }
}

/** Las devoluciones de UNA entrega. Para el detalle de la recepcion. */
export async function devolucionesDeRecepcion(receiptId: number): Promise<DevolucionListada[]> {
  const filas = await prisma.purchaseReturn.findMany({
    where: { purchaseReceiptId: receiptId },
    select: CAMPOS_LISTADO,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return filas.map(aDevolucionListada)
}

/** Las devoluciones de UN proveedor. Para su ficha (objetivo 21). */
export async function devolucionesDeProveedor(
  supplierId: number,
  query: { page: number; pageSize: number },
): Promise<Paginated<DevolucionListada>> {
  const where: Prisma.PurchaseReturnWhereInput = { supplierId }

  const [total, filas] = await Promise.all([
    prisma.purchaseReturn.count({ where }),
    prisma.purchaseReturn.findMany({
      where,
      select: CAMPOS_LISTADO,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  return paginado(filas.map(aDevolucionListada), total, query)
}

export interface DevolucionDetallada extends DevolucionListada {
  notes: string | null
  cancelReason: string | null
  cancelledAt: Date | null
  createdBy: { id: number; name: string }
  confirmedBy: { id: number; name: string } | null
  lineas: Array<{
    productId: number
    productName: string
    saleUnit: UnidadDeVenta
    quantity: TextoCantidad
    purchaseUnit: UnidadDeCompra
    stockQuantity: TextoCantidad
    unitCost: string
    amount: Monto
  }>
  /** Que se puede hacer, segun el estado. Para que la pantalla no lo deduzca. */
  puede: { editar: boolean; confirmar: boolean; cancelar: boolean }
}

/** Una devolucion con todo. Es la pantalla de detalle. */
export async function obtenerDevolucion(
  session: Session,
  id: number,
): Promise<DevolucionDetallada> {
  const d = await prisma.purchaseReturn.findFirst({
    where: { id, branchId: session.branchId },
    select: {
      ...CAMPOS_LISTADO,
      notes: true,
      cancelReason: true,
      cancelledAt: true,
      createdBy: { select: { id: true, name: true } },
      confirmedBy: { select: { id: true, name: true } },
      items: {
        select: {
          productId: true,
          quantity: true,
          purchaseUnit: true,
          stockQuantity: true,
          unitCost: true,
          amount: true,
          product: { select: { name: true, saleUnit: true } },
        },
        orderBy: { id: 'asc' },
      },
    },
  })
  // Mismo trato que "no existe": no se confirma que exista en otra sucursal.
  if (!d) throw notFound('La devolución no existe')

  return {
    ...aDevolucionListada(d),
    notes: d.notes,
    cancelReason: d.cancelReason,
    cancelledAt: d.cancelledAt,
    createdBy: d.createdBy,
    confirmedBy: d.confirmedBy,
    lineas: d.items.map((i) => ({
      productId: i.productId,
      productName: i.product.name,
      saleUnit: unidadDeVentaODefecto(i.product.saleUnit),
      quantity: aTextoCantidad(i.quantity),
      purchaseUnit: unidadDeCompraODefecto(i.purchaseUnit),
      stockQuantity: aTextoCantidad(i.stockQuantity),
      unitCost: aMontoCosto(i.unitCost),
      amount: aMonto(i.amount),
    })),
    puede: {
      editar: sePuedeEditarDevolucion(d.status),
      confirmar: sePuedeConfirmarDevolucion(d.status),
      cancelar: sePuedeCancelarDevolucion(d.status),
    },
  }
}

/**
 * Lo devuelto de cada linea de una entrega. Para el detalle de la recepcion.
 *
 * Es la columna "Devuelto" del objetivo 22, y sale de una sola consulta agrupada
 * en vez de una por linea.
 */
export async function devueltoDeRecepcion(
  receiptId: number,
): Promise<Map<number, { cantidad: Cantidad; importe: Prisma.Decimal }>> {
  const filas = await prisma.$queryRaw<
    Array<{ id: number; cantidad: Cantidad; importe: Prisma.Decimal }>
  >`
    SELECT di."purchaseReceiptItemId" AS "id",
           sum(di."quantity")         AS "cantidad",
           sum(di."amount")           AS "importe"
      FROM "PurchaseReturnItem" di
      JOIN "PurchaseReturn" d ON d."id" = di."purchaseReturnId"
     WHERE d."purchaseReceiptId" = ${receiptId} AND d."status" = 'CONFIRMED'
     GROUP BY di."purchaseReceiptItemId"
  `
  return new Map(filas.map((f) => [f.id, { cantidad: f.cantidad, importe: f.importe }]))
}

/** Comprueba que una cantidad pedida sea util. Se exporta para probarla sola. */
export function esCantidadDevolvible(pedido: Cantidad, disponible: Cantidad): boolean {
  return esPositivaCantidad(pedido) && !pedido.greaterThan(disponible)
}

/** Cuanto se puede devolver todavia, en unidad de compra. Sin base de datos. */
export function retornable(recibido: Cantidad, devuelto: Cantidad): Cantidad {
  const resto = restarCantidades(recibido, devuelto)
  return resto.isNegative() ? CERO_C : resto
}

/** El importe de una devolucion a partir de sus renglones. Sin base de datos. */
export function totalDeDevolucion(
  renglones: ReadonlyArray<{ unitCost: Prisma.Decimal; quantity: Cantidad }>,
): Prisma.Decimal {
  return renglones.reduce(
    (suma, r) => sumar(suma, redondearPesos(multiplicar(r.unitCost, r.quantity))),
    CERO_D,
  )
}

/** Un `invalid` con el vocabulario del modulo. Existe para no repetir el texto. */
export function exigirBorrador(estado: string): void {
  if (!sePuedeEditarDevolucion(estado)) {
    throw invalid('Solo un borrador se puede modificar')
  }
}
