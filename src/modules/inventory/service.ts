/**
 * Servicio central de inventario.
 *
 * ES LA UNICA PUERTA. Ninguna otra parte de `src/` escribe sobre
 * `BranchStock`: hay una regla de ESLint que lo impide, y este archivo es su
 * unica excepcion declarada.
 *
 * La regla que gobierna el modulo: el stock no se modifica, se MUEVE. Cada
 * cambio deja una fila en el libro con el saldo anterior, el delta y el saldo
 * resultante, y la suma del libro tiene que dar siempre el saldo:
 *
 *   para todo producto:  suma(StockMovement.quantity) == BranchStock.quantity
 *
 * Ver docs/INVENTORY_LEDGER.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit as escribirAuditoria } from '@/server/audit/audit'
import { conflict, invalid, notFound } from '@/server/http/errors'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { Session } from '@/server/auth/session'
import type { TextoCantidad } from '@/lib/cantidad'
import {
  CANTIDAD_MAX,
  CERO_C,
  aTextoCantidad,
  absolutoCantidad,
  cantidad as aCantidad,
  esCeroCantidad,
  esNegativaCantidad,
  esPositivaCantidad,
  restarCantidades,
  sumaCantidadODefecto,
  sumarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import {
  formatearCantidadConUnidad,
  motivoDeCantidadInvalida,
  unidadDeVentaODefecto,
  type UnidadDeVenta,
} from '@/modules/products/units'
import { SIGNO_DE_TIPO, esTipoValido, etiquetaDeTipo, type TipoMovimiento } from './movement-types'
import type { Referencia } from './referencias'
import type { ConsultarMovimientosQuery } from './schemas'
import { finDelDia, inicioDelDia, zonaDeSucursal } from '@/server/tiempo'
import { comoFechaLocal } from '@/modules/lots/fefo'
import type { FechaLocal } from '@/lib/tiempo'

/** Cliente de una transaccion. El servicio NO acepta el cliente global. */
export type TxClient = Prisma.TransactionClient

export interface EntradaMovimiento {
  branchId: number
  productId: number
  type: TipoMovimiento
  /** Delta CON SIGNO. Una venta de 2 unidades manda -2. */
  quantity: Cantidad
  /**
   * Unidad de venta del producto. OBLIGATORIA.
   *
   * Es lo que permite comprobar aca --en la unica puerta-- que `1.235` no
   * llegue al libro de un producto que se vende por unidad. Se pide en vez de
   * leerla porque todos los que llaman ya tienen el producto cargado: exigirla
   * no cuesta ninguna consulta y el compilador garantiza que nadie la saltee.
   */
  saleUnit: UnidadDeVenta
  /**
   * De que LOTE salen o entran estas unidades. Fase 4D.
   *
   * Nulo para todo producto con `lotTracking = NONE`, que es como arranca el
   * catalogo entero, y para el stock sin asignar de los `OPTIONAL`.
   *
   * La politica NO se comprueba con una consulta aparte: viaja DENTRO de la
   * sentencia que mueve el stock, junto a la comprobacion de sucursal. Un
   * movimiento sin lote sobre un producto `REQUIRED` --o con lote sobre uno
   * `NONE`-- no aplica, y el camino de error explica cual de las dos cosas fue.
   *
   * Que el lote pertenezca al producto lo garantiza la base con una clave
   * foranea COMPUESTA: no hay comprobacion nuestra que se pueda saltear.
   */
  lotId?: number | null
  userId: number
  reason?: string | null
  referenceType?: Referencia | null
  referenceId?: number | null
  /**
   * Si ademas hay que dejar entrada en la bitacora de seguridad.
   *
   * Solo lo piden los ajustes, porque un ajuste ES el evento. Una venta ya se
   * audita entera: emitir una entrada por linea convertiria una venta de
   * quince productos en dieciseis filas que dicen lo mismo.
   */
  audit?: { origin: string } | null
}

export interface ResultadoMovimiento {
  movementId: number
  previousQuantity: Cantidad
  resultingQuantity: Cantidad
  /** Los saldos DEL LOTE, cuando el movimiento llevaba uno. */
  lote: { previousQuantity: Cantidad; resultingQuantity: Cantidad } | null
}

/** Nombre para el mensaje de error. Se lee solo cuando algo falla. */
async function nombreDe(tx: TxClient, productId: number): Promise<string> {
  const p = await tx.product.findUnique({ where: { id: productId }, select: { name: true } })
  return p?.name ?? `#${productId}`
}

/**
 * Cuanto se pidio, con su unidad, para el mensaje de stock insuficiente.
 *
 * En valor absoluto: quien lee "se pidieron -0,425 kg" tiene que traducir el
 * signo antes de entender la frase.
 */
function pedido(quantity: Cantidad, unidad: UnidadDeVenta): string {
  return formatearCantidadConUnidad(aTextoCantidad(absolutoCantidad(quantity)), unidad)
}

/**
 * Comprueba el tipo, el signo y el fraccionamiento antes de tocar la base.
 *
 * La base es la garantia --tiene la misma tabla de signos en una restriccion
 * CHECK--; esto es el mensaje legible. Sin esto el usuario recibiria el texto
 * crudo de PostgreSQL, que menciona el nombre de la restriccion y de la tabla.
 *
 * El fraccionamiento, en cambio, SOLO se puede comprobar aca: la unidad vive
 * en `Product` y la cantidad en `StockMovement`, y un CHECK no puede mirar mas
 * alla de su fila.
 */
function validarMovimiento(type: TipoMovimiento, quantity: Cantidad, unidad: UnidadDeVenta): void {
  if (!esTipoValido(type)) {
    throw invalid(`Tipo de movimiento desconocido: ${String(type)}`)
  }

  if (esCeroCantidad(quantity)) {
    throw invalid('Un movimiento de cero unidades no registra nada')
  }

  if (absolutoCantidad(quantity).greaterThan(CANTIDAD_MAX)) {
    throw invalid(`La cantidad excede el maximo permitido (${CANTIDAD_MAX})`)
  }

  const signo = SIGNO_DE_TIPO[type]
  if (signo === 'entra' && esNegativaCantidad(quantity)) {
    throw invalid(`Un movimiento de tipo "${etiquetaDeTipo(type)}" no puede restar unidades`)
  }
  if (signo === 'sale' && esPositivaCantidad(quantity)) {
    throw invalid(`Un movimiento de tipo "${etiquetaDeTipo(type)}" no puede sumar unidades`)
  }

  // Sobre el valor absoluto: el signo ya se comprobo arriba, y la politica de
  // la unidad habla de cuanto se mueve, no de en que direccion.
  const motivo = motivoDeCantidadInvalida(unidad, aTextoCantidad(absolutoCantidad(quantity)))
  if (motivo !== null) throw invalid(motivo)
}

/**
 * Aplica un movimiento de stock. LA funcion del modulo.
 *
 * Exige `tx` --el cliente de una transaccion, no el global-- porque el cambio
 * de saldo y la fila del libro tienen que confirmarse juntos o no confirmarse.
 * No hay forma de llamarla fuera de una transaccion.
 *
 * El corazon son DOS sentencias, y las dos importan:
 *
 *   1. asegurar que exista la fila de stock, en cero;
 *   2. aplicar el delta comprobando que no quede negativo, devolviendo el
 *      saldo anterior y el resultante EN LA MISMA SENTENCIA.
 *
 * La segunda es la que cierra la ventana. La version ingenua --leer, decidir
 * en JavaScript, escribir-- deja un hueco entre la lectura y la escritura: con
 * dos cajas vendiendo la ultima unidad, las dos leen "hay 1", las dos deciden
 * "alcanza" y el stock queda en -1. Ese hueco no se cierra con mas
 * comprobaciones: se cierra no teniendolo.
 */
export async function applyStockMovement(
  tx: TxClient,
  entrada: EntradaMovimiento,
): Promise<ResultadoMovimiento> {
  const { branchId, productId, type, quantity, saleUnit, userId } = entrada
  const lotId = entrada.lotId ?? null

  validarMovimiento(type, quantity, saleUnit)

  // El delta viaja a PostgreSQL como CADENA canonica con un cast explicito, no
  // como objeto ni como numero. Una cadena `"0.425"` con `::numeric` no puede
  // perder nada por el camino; un `number` de JavaScript ya la habria perdido
  // antes de salir.
  const delta: TextoCantidad = aTextoCantidad(quantity)

  // 1) La fila de stock tiene que existir para poder actualizarla.
  //
  //    Un producto sin fila en `BranchStock` no es un error: es un producto al
  //    que nunca le entro mercaderia. Se crea en cero, y el paso 2 decide si
  //    el movimiento cabe.
  //
  //    El SELECT sobre `Product` no es decorativo: si el producto no es de
  //    esta sucursal, no se crea nada, y el paso 2 tampoco encuentra fila. Un
  //    id de otra sucursal no puede fabricar stock aca.
  //
  //    `DO NOTHING` en vez de comprobar antes: dos transacciones simultaneas
  //    que dan de alta el mismo par no pueden chocar.
  await tx.$executeRaw`
    INSERT INTO "BranchStock" ("branchId", "productId", "quantity")
    SELECT ${branchId}, ${productId}, 0
      FROM "Product" p
     WHERE p."id" = ${productId}
       AND p."branchId" = ${branchId}
    ON CONFLICT ("branchId", "productId") DO NOTHING
  `

  // 2) El delta, la comprobacion de no-negativo y los dos saldos, juntos.
  //
  //    PostgreSQL toma el bloqueo de la fila y REEVALUA la condicion despues
  //    de esperarlo, asi que dos ventas simultaneas de la ultima unidad no
  //    pueden pasar las dos: la segunda ve el saldo ya descontado.
  //
  //    `RETURNING` sobre un UPDATE devuelve la fila NUEVA, de modo que
  //    `"quantity" - delta` es exactamente el saldo anterior.
  //
  //    Los casts SI son necesarios, y son los que NO pierden nada:
  //
  //      `${delta}::numeric`   la cadena llega sin tipo declarado y PostgreSQL
  //                            no sabe con que sumarla. El cast se lo dice.
  //      `::numeric(14,3)`     es el tipo propio de la columna. Los dos
  //                            operandos ya tienen tres decimales, asi que su
  //                            resta tambien; el cast solo fija la escala para
  //                            que vuelva con la forma canonica.
  //
  //    Hasta la Fase 3B esto decia `::integer`, que hoy truncaria el decimal.
  //    Ver docs/PHASE3_QUANTITY_MIGRATION.md.
  //
  //    La union con `Product` repite la comprobacion de sucursal: la fila de
  //    stock podria existir de antes, y sin esto un id de otra sucursal la
  //    moveria.
  //
  //    La condicion de POLITICA DE LOTE viaja adentro, igual que la de
  //    sucursal, y por el mismo motivo: una comprobacion que vive en otra
  //    sentencia es una comprobacion que alguien puede saltear o que puede
  //    quedar obsoleta entre las dos. Un movimiento sin lote sobre un producto
  //    `REQUIRED` --o con lote sobre uno `NONE`-- no afecta ninguna fila, y el
  //    camino de error de abajo dice cual de las dos cosas fue.
  const filas = await tx.$queryRaw<Array<{ previo: Cantidad; resultante: Cantidad }>>`
    UPDATE "BranchStock" bs
       SET "quantity" = bs."quantity" + ${delta}::numeric
      FROM "Product" p
     WHERE p."id" = bs."productId"
       AND p."branchId" = ${branchId}
       AND bs."branchId" = ${branchId}
       AND bs."productId" = ${productId}
       AND bs."quantity" + ${delta}::numeric >= 0
       AND CASE WHEN ${lotId}::int IS NULL THEN p."lotTracking" <> 'REQUIRED'
                ELSE p."lotTracking" <> 'NONE' END
    RETURNING (bs."quantity" - ${delta}::numeric)::numeric(14,3) AS previo,
              bs."quantity"::numeric(14,3)                       AS resultante
  `

  const saldos = filas[0]
  if (!saldos) {
    // Camino de error, no camino caliente: recien aca se paga por averiguar
    // por que no se aplico.
    const producto = await tx.product.findFirst({
      where: { id: productId, branchId },
      select: { lotTracking: true },
    })
    // Mismo trato que "no existe": no se confirma que el producto exista en
    // otra sucursal.
    if (!producto) throw notFound('Producto no encontrado')

    if (lotId === null && producto.lotTracking === 'REQUIRED') {
      throw conflict(
        `"${await nombreDe(tx, productId)}" se sigue por lote: todo movimiento ` +
          'tiene que decir de que partida es.',
        { code: 'LOT_REQUIRED' },
      )
    }
    if (lotId !== null && producto.lotTracking === 'NONE') {
      throw conflict(
        `"${await nombreDe(tx, productId)}" no se sigue por lote. Activá el ` +
          'seguimiento por lote antes de moverle partidas.',
        { code: 'LOT_NOT_TRACKED' },
      )
    }

    const actual = await tx.branchStock.findUnique({
      where: { branchId_productId: { branchId, productId } },
      select: { quantity: true },
    })

    throw conflict(
      `Stock insuficiente de "${await nombreDe(tx, productId)}": se pidieron ` +
        `${pedido(quantity, saleUnit)} y hay ` +
        `${formatearCantidadConUnidad(aTextoCantidad(actual?.quantity ?? CERO_C), saleUnit)}`,
      { code: 'INSUFFICIENT_STOCK' },
    )
  }

  // 3) El mismo delta, sobre el saldo DEL LOTE.
  //
  //    Va DESPUES del agregado y nunca antes: el orden de los bloqueos es parte
  //    del contrato --primero `BranchStock`, despues `BranchLotStock`-- y como
  //    todos los caminos pasan por aca, todas las transacciones lo toman igual.
  //    Ver docs/LOT_TRACKING_DESIGN.md.
  //
  //    La condicion `quantity + delta >= 0` se repite acá porque el tope del
  //    lote es SUYO: el producto puede tener 50 unidades y el lote 2.
  const lote =
    lotId === null ? null : await aplicarSaldoDeLote(tx, branchId, productId, lotId, delta)

  // Los saldos salen del RETURNING, no de una lectura posterior. Entre la
  // escritura y una segunda lectura otra transaccion puede mover el stock, y
  // la fila del libro diria un numero que nunca existio.
  const movimiento = await tx.stockMovement.create({
    data: {
      branchId,
      productId,
      lotId,
      type,
      quantity,
      previousQuantity: saldos.previo,
      resultingQuantity: saldos.resultante,
      referenceType: entrada.referenceType ?? null,
      referenceId: entrada.referenceId ?? null,
      userId,
      reason: entrada.reason ?? null,
    },
    select: { id: true },
  })

  if (entrada.audit) {
    // Las cantidades entran en la bitacora como CADENA, igual que los
    // importes. Un `Decimal` serializado a JSON pierde la escala --`0.25` en
    // vez de `"0.250"`-- y un `number` reintroduciria el error de punto
    // flotante en una fila que existe justamente para ser prueba documental.
    await escribirAuditoria(tx, {
      userId,
      branchId,
      table: 'StockMovement',
      recordId: movimiento.id,
      action: 'create',
      reason: entrada.reason ?? null,
      before: { quantity: aTextoCantidad(saldos.previo) },
      after: {
        tipo: type,
        productId,
        lotId,
        delta,
        unidad: saleUnit,
        quantity: aTextoCantidad(saldos.resultante),
        ...(lote === null ? {} : { loteQuantity: aTextoCantidad(lote.resultingQuantity) }),
        motivo: entrada.reason ?? null,
        branchId,
      },
      origin: entrada.audit.origin,
    })
  }

  return {
    movementId: movimiento.id,
    previousQuantity: saldos.previo,
    resultingQuantity: saldos.resultante,
    lote,
  }
}

/**
 * El delta sobre el saldo de UN lote. Solo la llama `applyStockMovement`.
 *
 * Dos sentencias, las mismas dos que para el producto y por los mismos motivos:
 * asegurar la fila y despues aplicar el delta comprobando el no-negativo EN LA
 * MISMA SENTENCIA que escribe.
 *
 * El `SELECT ... FROM "ProductLot"` de la primera no es decorativo: si el lote
 * no es de este producto, no se crea la fila y la segunda no encuentra nada. La
 * clave foranea compuesta ya lo impide del lado de la base; esto hace que el
 * mensaje sea legible en vez de un error de restriccion.
 */
async function aplicarSaldoDeLote(
  tx: TxClient,
  branchId: number,
  productId: number,
  lotId: number,
  delta: TextoCantidad,
): Promise<{ previousQuantity: Cantidad; resultingQuantity: Cantidad }> {
  await tx.$executeRaw`
    INSERT INTO "BranchLotStock" ("branchId", "lotId", "quantity")
    SELECT ${branchId}, ${lotId}, 0
      FROM "ProductLot" l
     WHERE l."id" = ${lotId}
       AND l."productId" = ${productId}
    ON CONFLICT ("branchId", "lotId") DO NOTHING
  `

  const filas = await tx.$queryRaw<Array<{ previo: Cantidad; resultante: Cantidad }>>`
    UPDATE "BranchLotStock" bls
       SET "quantity" = bls."quantity" + ${delta}::numeric
     WHERE bls."branchId" = ${branchId}
       AND bls."lotId" = ${lotId}
       AND bls."quantity" + ${delta}::numeric >= 0
    RETURNING (bls."quantity" - ${delta}::numeric)::numeric(14,3) AS previo,
              bls."quantity"::numeric(14,3)                       AS resultante
  `

  const saldos = filas[0]
  if (saldos) return { previousQuantity: saldos.previo, resultingQuantity: saldos.resultante }

  const lote = await tx.productLot.findFirst({
    where: { id: lotId, productId },
    select: { code: true },
  })
  if (!lote) throw notFound('El lote no existe o no es de este producto')

  const actual = await tx.branchLotStock.findUnique({
    where: { branchId_lotId: { branchId, lotId } },
    select: { quantity: true },
  })

  throw conflict(
    `El lote ${lote.code} no tiene suficiente: quedan ` +
      `${aTextoCantidad(actual?.quantity ?? CERO_C)} y se pidieron ` +
      `${aTextoCantidad(absolutoCantidad(aCantidad(delta)))}.`,
    { code: 'INSUFFICIENT_LOT_STOCK' },
  )
}

export interface EntradaAtribucion {
  branchId: number
  productId: number
  lotId: number
  /** Delta CON SIGNO. Una atribucion equivocada se compensa con su opuesta. */
  quantity: Cantidad
  saleUnit: UnidadDeVenta
  userId: number
  /** Obligatorio: es la unica explicacion que va a quedar. */
  reason: string
  audit?: { origin: string } | null
}

export interface ResultadoAtribucion {
  assignmentId: number
  previousQuantity: Cantidad
  resultingQuantity: Cantidad
  /** Lo que sigue sin pertenecer a ningun lote, DESPUES de esta atribucion. */
  sinAsignar: Cantidad
}

/**
 * Atribuye stock EXISTENTE a un lote. La otra funcion de la unica puerta.
 *
 * NO ES UN MOVIMIENTO DE STOCK, y esa es toda la razon de que exista: activar el
 * rastreo sobre un producto que ya tiene 20 unidades obliga a decir de que lotes
 * son, y el stock no cambia --habia 20 y siguen habiendo 20--. Lo que cambia es
 * la ATRIBUCION.
 *
 * Fabricar un movimiento de +20 seguido de otro de -20 para representarlo seria
 * escribir en el libro de inventario dos operaciones que nunca ocurrieron.
 *
 * EL TOPE, y por que necesita bloqueo. La suma de lo atribuido no puede superar
 * el stock del producto, y esa condicion NO cabe dentro de la sentencia que
 * escribe: el tope es la suma de OTRA tabla. Son DOS sentencias:
 *
 *   1. `SELECT ... FOR UPDATE` sobre la fila de `BranchStock`. Nada mas.
 *   2. RECIEN DESPUES, la suma de lo ya atribuido, en su propia sentencia.
 *
 * Que sean dos importa: bajo READ COMMITTED la instantanea se toma al EMPEZAR la
 * sentencia, asi que la transaccion que espera el bloqueo sumaria con una foto
 * anterior a la escritura de la que estaba esperando. PostgreSQL reevalua la
 * FILA bloqueada, no las subconsultas. Es la misma leccion que la Fase 4C
 * aprendio en las imputaciones. Ver docs/SUPPLIER_ADVANCES.md.
 */
export async function applyLotAssignment(
  tx: TxClient,
  entrada: EntradaAtribucion,
): Promise<ResultadoAtribucion> {
  const { branchId, productId, lotId, quantity, saleUnit, userId } = entrada

  if (esCeroCantidad(quantity)) {
    throw invalid('Una atribución de cero unidades no atribuye nada')
  }
  const motivoUnidad = motivoDeCantidadInvalida(
    saleUnit,
    aTextoCantidad(absolutoCantidad(quantity)),
  )
  if (motivoUnidad !== null) throw invalid(motivoUnidad)
  if (entrada.reason.trim() === '') {
    throw invalid('El motivo de la atribución es obligatorio')
  }

  const delta: TextoCantidad = aTextoCantidad(quantity)

  const producto = await tx.product.findFirst({
    where: { id: productId, branchId },
    select: { name: true, lotTracking: true },
  })
  if (!producto) throw notFound('Producto no encontrado')
  if (producto.lotTracking === 'NONE') {
    throw conflict(
      `"${producto.name}" no se sigue por lote: no se le puede atribuir stock a partidas.`,
      { code: 'LOT_NOT_TRACKED' },
    )
  }

  // 1. EL BLOQUEO, Y NADA MAS.
  await tx.$queryRaw`
    SELECT bs."id"
      FROM "BranchStock" bs
     WHERE bs."branchId" = ${branchId}
       AND bs."productId" = ${productId}
     FOR UPDATE
  `

  // 2. RECIEN AHORA la suma, en su propia sentencia.
  const topes = await tx.$queryRaw<Array<{ total: Cantidad; asignado: Cantidad }>>`
    SELECT COALESCE(bs."quantity", 0)::numeric(14,3)     AS total,
           COALESCE(sum(bls."quantity"), 0)::numeric(14,3) AS asignado
      FROM "Product" p
      LEFT JOIN "BranchStock" bs
        ON bs."productId" = p."id" AND bs."branchId" = ${branchId}
      LEFT JOIN "ProductLot" l
        ON l."productId" = p."id"
      LEFT JOIN "BranchLotStock" bls
        ON bls."lotId" = l."id" AND bls."branchId" = ${branchId}
     WHERE p."id" = ${productId}
     GROUP BY bs."quantity"
  `

  const tope = topes[0] ?? { total: CERO_C, asignado: CERO_C }
  const asignadoDespues = sumarCantidades(tope.asignado, quantity)

  if (asignadoDespues.greaterThan(tope.total)) {
    throw conflict(
      `No se puede atribuir ${formatearCantidadConUnidad(aTextoCantidad(absolutoCantidad(quantity)), saleUnit)} ` +
        `de "${producto.name}": hay ${formatearCantidadConUnidad(aTextoCantidad(tope.total), saleUnit)} ` +
        `en total y ya se atribuyeron ${formatearCantidadConUnidad(aTextoCantidad(tope.asignado), saleUnit)}.`,
      { code: 'LOT_ASSIGNMENT_EXCEEDS_STOCK' },
    )
  }

  const saldos = await aplicarSaldoDeLote(tx, branchId, productId, lotId, delta)

  const atribucion = await tx.lotAssignment.create({
    data: { branchId, productId, lotId, quantity, reason: entrada.reason.trim(), userId },
    select: { id: true },
  })

  if (entrada.audit) {
    await escribirAuditoria(tx, {
      userId,
      branchId,
      table: 'LotAssignment',
      recordId: atribucion.id,
      action: 'create',
      reason: entrada.reason.trim(),
      before: { loteQuantity: aTextoCantidad(saldos.previousQuantity) },
      after: {
        productId,
        lotId,
        delta,
        unidad: saleUnit,
        loteQuantity: aTextoCantidad(saldos.resultingQuantity),
        branchId,
      },
      origin: entrada.audit.origin,
    })
  }

  return {
    assignmentId: atribucion.id,
    previousQuantity: saldos.previousQuantity,
    resultingQuantity: saldos.resultingQuantity,
    sinAsignar: restarCantidades(tope.total, asignadoDespues),
  }
}

/**
 * Reconstruye el saldo de un lote sumando su libro MAS sus atribuciones.
 *
 * Es la invariante hecha consulta, y son dos sumas y no una porque el saldo de
 * un lote tiene dos origenes: la mercaderia que se movio y el stock que se le
 * atribuyo al activar el rastreo. Ver docs/LOT_TRACKING_DESIGN.md.
 */
export async function reconstruirStockDeLote(branchId: number, lotId: number): Promise<Cantidad> {
  const [movimientos, atribuciones] = await Promise.all([
    prisma.stockMovement.aggregate({ where: { branchId, lotId }, _sum: { quantity: true } }),
    prisma.lotAssignment.aggregate({ where: { branchId, lotId }, _sum: { quantity: true } }),
  ])
  return sumarCantidades(
    sumaCantidadODefecto(movimientos._sum.quantity),
    sumaCantidadODefecto(atribuciones._sum.quantity),
  )
}

/**
 * Borra la fila de stock de un producto que no tiene historial.
 *
 * Existe solo para que el borrado fisico de un producto no tenga que escribir
 * sobre `BranchStock` desde fuera de este modulo. Comprueba lo que promete: si
 * el producto tiene algun movimiento, no borra nada.
 *
 * En la practica solo se cumple para un producto cargado por error con cero
 * unidades y sin ninguna operacion, que es justo el caso para el que sirve el
 * boton de borrar. Un producto con historial se da de baja.
 */
export async function olvidarStockDeProductoSinHistorial(
  tx: TxClient,
  productId: number,
): Promise<void> {
  const movimientos = await tx.stockMovement.count({ where: { productId } })
  if (movimientos > 0) {
    throw conflict(
      `No se puede eliminar: el producto tiene ${movimientos} movimiento(s) de stock. ` +
        'Borrarlo destruiria su historial de inventario. Dalo de baja en su lugar.',
      { code: 'PRODUCT_HAS_MOVEMENTS' },
    )
  }
  await tx.branchStock.deleteMany({ where: { productId } })
}

// ---------------------------------------------------------------------------
// Reposicion
// ---------------------------------------------------------------------------

/**
 * Productos que llegaron a su minimo y todavia tienen unidades.
 *
 * Hace falta SQL porque la condicion compara dos columnas de tablas distintas
 * --`BranchStock.quantity` contra `Product.minimumStock`-- y Prisma solo sabe
 * comparar una columna contra un valor. La alternativa seria traer el catalogo
 * entero y filtrar en memoria, que rompe la paginacion.
 *
 * Devuelve identificadores, no productos: el listado sigue armandose con la
 * consulta de siempre, con sus filtros, su orden y su paginacion. Sin tope: en
 * un almacen los productos bajo minimo son decenas, no miles, y un tope
 * silencioso haria que la pantalla dijera "no hay mas" cuando si hay.
 *
 * Solo cuenta el catalogo ACTIVO: un producto dado de baja no se repone.
 */
export async function idsBajoMinimo(branchId: number): Promise<number[]> {
  const filas = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT p."id"
      FROM "Product" p
      JOIN "BranchStock" bs
        ON bs."productId" = p."id" AND bs."branchId" = ${branchId}
     WHERE p."branchId" = ${branchId}
       AND p."isActive" = true
       AND bs."quantity" > 0
       AND bs."quantity" <= p."minimumStock"
  `
  return filas.map((f) => f.id)
}

export interface ResumenReposicion {
  /** Sin unidades. No se pueden vender. */
  agotados: number
  /** Con unidades, pero llegaron al minimo configurado. */
  bajoMinimo: number
  /** Cuantos productos activos todavia no tienen minimo configurado. */
  sinMinimo: number
}

/**
 * Cuantos productos hay que reponer. Para el panel de inicio.
 *
 * `sinMinimo` no es decorativo: con el catalogo recien migrado, `bajoMinimo`
 * vale cero porque nadie configuro minimos todavia, y una tarjeta en cero sin
 * explicacion se lee como "esta todo bien". Este numero es el que permite
 * decir la verdad: no es que no falte nada, es que nadie dijo cuanto tiene que
 * haber.
 */
export async function resumenDeReposicion(branchId: number): Promise<ResumenReposicion> {
  const [agotados, bajoMinimo, sinMinimo] = await Promise.all([
    prisma.product.count({
      where: {
        branchId,
        isActive: true,
        OR: [
          { stocks: { none: { branchId } } },
          { stocks: { some: { branchId, quantity: { lte: 0 } } } },
        ],
      },
    }),
    idsBajoMinimo(branchId).then((ids) => ids.length),
    prisma.product.count({ where: { branchId, isActive: true, minimumStock: 0 } }),
  ])

  return { agotados, bajoMinimo, sinMinimo }
}

// ---------------------------------------------------------------------------
// Consulta del libro
// ---------------------------------------------------------------------------

export interface MovimientoListado {
  id: number
  createdAt: Date
  type: string
  /** Nombre para mostrar. El codigo crudo no llega a la pantalla. */
  typeLabel: string
  quantity: TextoCantidad
  previousQuantity: TextoCantidad
  resultingQuantity: TextoCantidad
  referenceType: string | null
  referenceId: number | null
  reason: string | null
  /**
   * El producto con SU unidad de venta. Sin ella la fila no se puede leer: un
   * `-0.250` no dice si se vendieron 250 gramos o un cuarto de unidad.
   */
  product: { id: number; name: string; barcode: string | null; saleUnit: UnidadDeVenta }
  user: { id: number; name: string }
  branch: { id: number; name: string }
  /**
   * De que partida movio. Fase 4D.
   *
   * `null` significa "sin partida", y es la respuesta correcta en dos casos
   * distintos: un producto sin rastreo, y uno con rastreo opcional cuyo
   * movimiento salio del stock no atribuido.
   */
  lotId: number | null
  lotCode: string | null
  lotExpirationDate: FechaLocal | null
}

const CAMPOS_MOVIMIENTO = {
  id: true,
  createdAt: true,
  type: true,
  quantity: true,
  previousQuantity: true,
  resultingQuantity: true,
  referenceType: true,
  referenceId: true,
  reason: true,
  product: {
    select: {
      id: true,
      name: true,
      saleUnit: true,
      // El principal, para poder mostrarlo junto al nombre. Los alternativos
      // no hacen falta en un historial.
      barcodes: { where: { isPrimary: true }, select: { code: true }, take: 1 },
    },
  },
  user: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  /**
   * De que partida salio --o entro-- este movimiento. Fase 4D.
   *
   * Nulo cuando el producto no lleva lotes, y tambien cuando lleva OPTIONAL y
   * el movimiento fue sobre el stock sin atribuir. Los dos casos significan lo
   * mismo en pantalla --"sin partida"-- y ninguno es un error.
   *
   * Es la mitad que faltaba del historial: sin esto, el libro dice que salieron
   * dos yogures y no cual de las dos partidas quedo con menos, que es
   * exactamente la pregunta que la fase vino a contestar.
   */
  lot: { select: { id: true, code: true, expirationDate: true } },
} as const

/**
 * Historial de movimientos de la sucursal, paginado.
 *
 * Siempre paginado y siempre acotado a la sucursal de la sesion. No existe
 * endpoint que devuelva el libro entero: con dos anios de operacion son
 * cientos de miles de filas.
 *
 * Producto, usuario y sucursal vienen con un `include` en la misma consulta.
 * Resolverlos despues, de a uno, seria una consulta por fila.
 */
export async function consultarMovimientos(
  session: Session,
  query: ConsultarMovimientosQuery,
): Promise<Paginated<MovimientoListado>> {
  const zona = await zonaDeSucursal(prisma, session.branchId)

  const where: Prisma.StockMovementWhereInput = {
    branchId: session.branchId,
    ...(query.productId === undefined ? {} : { productId: query.productId }),
    ...(query.tipo === undefined ? {} : { type: query.tipo }),
    ...(query.usuarioId === undefined ? {} : { userId: query.usuarioId }),
    ...(query.referenceType === undefined ? {} : { referenceType: query.referenceType }),
    ...(query.referenceId === undefined ? {} : { referenceId: query.referenceId }),
    // El filtro por fecha se resuelve con la zona de la SUCURSAL: `desde` es
    // el primer instante de ese dia en el local y `hasta` el ultimo.
    // Ver docs/TIMEZONE_POLICY.md.
    ...(query.desde || query.hasta
      ? {
          createdAt: {
            ...(query.desde ? { gte: inicioDelDia(query.desde, zona) } : {}),
            ...(query.hasta ? { lte: finDelDia(query.hasta, zona) } : {}),
          },
        }
      : {}),
    ...(query.q
      ? {
          product: {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' as const } },
              // Cualquiera de sus codigos, no solo el principal: quien pega un
              // codigo alternativo en el buscador espera encontrar el producto.
              { barcodes: { some: { code: { contains: query.q, mode: 'insensitive' as const } } } },
            ],
          },
        }
      : {}),
  }

  const [total, movimientos] = await Promise.all([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      select: CAMPOS_MOVIMIENTO,
      // Por fecha descendente y, a igualdad de fecha, por id: dos movimientos
      // de la misma venta comparten el milisegundo, y sin el segundo criterio
      // el orden entre ellos cambiaria de una consulta a otra.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...toSkipTake(query),
    }),
  ])

  const data = movimientos.map(({ product, lot, ...m }) => ({
    ...m,
    typeLabel: etiquetaDeTipo(m.type),
    quantity: aTextoCantidad(m.quantity),
    previousQuantity: aTextoCantidad(m.previousQuantity),
    resultingQuantity: aTextoCantidad(m.resultingQuantity),
    product: {
      id: product.id,
      name: product.name,
      barcode: product.barcodes[0]?.code ?? null,
      saleUnit: unidadDeVentaODefecto(product.saleUnit),
    },
    // Plano y no anidado: la pantalla muestra una columna, no un objeto.
    lotId: lot?.id ?? null,
    lotCode: lot?.code ?? null,
    lotExpirationDate: comoFechaLocal(lot?.expirationDate ?? null),
  }))

  return paginado(data, total, query)
}

/**
 * Reconstruye el stock de un producto sumando su libro.
 *
 * Es la comprobacion de integridad hecha consulta: lo que devuelve tiene que
 * ser identico a `BranchStock.quantity`. La usan las pruebas y esta disponible
 * para cuando haga falta explicarle a alguien de donde salio un numero.
 */
export async function reconstruirStock(branchId: number, productId: number): Promise<Cantidad> {
  const suma = await prisma.stockMovement.aggregate({
    where: { branchId, productId },
    _sum: { quantity: true },
  })
  return sumaCantidadODefecto(suma._sum.quantity)
}
