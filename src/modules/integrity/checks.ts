/**
 * Las invariantes del sistema, comprobadas POR OTRO CAMINO.
 *
 * Este archivo es lo que separa "el panel se ve bien" de "el sistema cierra".
 *
 * DOS REGLAS DE DISENIO, y las dos son el punto:
 *
 *   1. NO SE REUSA EL CODIGO QUE ESCRIBE. Cada comprobacion es SQL sobre las
 *      tablas. El servicio suma con `Decimal.js` en JavaScript; esto suma con
 *      `SUM()` en PostgreSQL. Si los dos se equivocan igual, es porque los dos
 *      hacen lo mismo, y una prueba que llama a la misma funcion que escribio
 *      el dato no comprueba nada: comprueba que la funcion es igual a si
 *      misma.
 *
 *   2. SOLO SE LEE. No hay un solo UPDATE en este archivo. Encontrar una
 *      diferencia y arreglarla sola es la peor respuesta posible: tapa el
 *      sintoma, borra la evidencia y deja el error de origen intacto para que
 *      vuelva a pasar. Se informa, y decide una persona.
 *
 * Todas las consultas devuelven SOLO las filas que fallan y agregan del lado de
 * la base: una base con dos anios de ventas no entra en memoria, y traerla para
 * sumarla en JavaScript seria exactamente lo que este proyecto no hace.
 *
 * Los numeros salen como TEXTO (`::text`). Un `numeric` que pasa por un
 * `number` de JavaScript ya perdio precision antes de que nadie lo compare.
 *
 * Ver docs/PHASE3_RECONCILIATION.md.
 */

import { prisma } from '@/lib/prisma'
import type { Comprobacion, Inconsistencia } from './tipos'

/** Filas de las consultas: todo texto, todo exacto. */
type Fila = Record<string, string | number | null>

async function contar(sql: string): Promise<number> {
  const filas = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(sql)
  return Number(filas[0]?.n ?? 0)
}

async function buscar(sql: string): Promise<Fila[]> {
  return prisma.$queryRawUnsafe<Fila[]>(sql)
}

/** La resta de dos importes, o null si alguno no es un numero. */
function restar(a: string | null, b: string | null): string | null {
  if (a === null || b === null) return null
  const x = Number(a)
  const y = Number(b)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  // Solo para MOSTRAR la magnitud del descuadre. La comparacion que decide si
  // hay descuadre la hizo PostgreSQL con `numeric`, no esta resta.
  return (x - y).toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}

// ===========================================================================
// Ventas
// ===========================================================================

/**
 * El total de una venta es la suma de sus lineas.
 *
 * `round(price * quantity, 2)` linea por linea y despues la suma, en ese orden
 * y no al reves: es como se arma el ticket. Sumar exacto y redondear al final
 * daria un total que no coincide con lo que el cliente vio impreso.
 */
export async function ventasContraSusLineas(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "Sale"')

  const filas = await buscar(`
    SELECT s."id"::text                                            AS id,
           s."total"::text                                         AS total,
           COALESCE(sum(round(i."price" * i."quantity", 2)), 0)::text AS lineas,
           count(i."id")::text                                     AS cuantas,
           s."status"                                              AS estado
      FROM "Sale" s
      LEFT JOIN "SaleItem" i ON i."saleId" = s."id"
     GROUP BY s."id", s."total", s."status"
    HAVING s."total" <> COALESCE(sum(round(i."price" * i."quantity", 2)), 0)
     ORDER BY s."id"
  `)

  return {
    nombre: 'Ventas',
    revisadas,
    inconsistencias: filas.map((f): Inconsistencia => ({
      entidad: `Venta #${String(f.id)}`,
      regla: 'total = suma de las lineas',
      esperado: String(f.lineas),
      encontrado: String(f.total),
      diferencia: restar(String(f.total), String(f.lineas)),
      detalle: `${String(f.cuantas)} linea(s), estado ${String(f.estado)}`,
    })),
  }
}

/**
 * El total de una venta es la suma de sus pagos.
 *
 * Se comprueban dos cosas distintas y se informan por separado:
 *
 *   · una venta con pagos cuyos importes no suman el total -> descuadre;
 *   · una venta SIN NINGUN pago -> falta el registro.
 *
 * La segunda existe porque en una base anterior a la Fase 3.4 es un caso
 * legitimo: las ventas que nunca generaron movimiento de caja se migraron sin
 * pagos, y la migracion lo dejo escrito. Desde entonces no puede volver a
 * pasar. Mezclarla con la primera haria que un dato viejo conocido se lea como
 * un descuadre nuevo.
 */
export async function ventasContraSusPagos(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "Sale"')

  const descuadradas = await buscar(`
    SELECT s."id"::text          AS id,
           s."total"::text       AS total,
           sum(p."amount")::text AS pagos,
           count(p."id")::text   AS cuantos
      FROM "Sale" s
      JOIN "SalePayment" p ON p."saleId" = s."id"
     GROUP BY s."id", s."total"
    HAVING s."total" <> sum(p."amount")
     ORDER BY s."id"
  `)

  const sinPagos = await buscar(`
    SELECT s."id"::text    AS id,
           s."total"::text AS total,
           s."date"::text  AS fecha
      FROM "Sale" s
     WHERE NOT EXISTS (SELECT 1 FROM "SalePayment" p WHERE p."saleId" = s."id")
     ORDER BY s."id"
  `)

  return {
    nombre: 'Pagos',
    revisadas,
    inconsistencias: [
      ...descuadradas.map((f): Inconsistencia => ({
        entidad: `Venta #${String(f.id)}`,
        regla: 'total = suma de los pagos',
        esperado: String(f.total),
        encontrado: String(f.pagos),
        diferencia: restar(String(f.pagos), String(f.total)),
        detalle: `${String(f.cuantos)} pago(s)`,
      })),
      ...sinPagos.map((f): Inconsistencia => ({
        entidad: `Venta #${String(f.id)}`,
        regla: 'toda venta tiene sus pagos registrados',
        esperado: 'al menos un pago',
        encontrado: 'ninguno',
        diferencia: null,
        detalle:
          `total ${String(f.total)}, del ${String(f.fecha).slice(0, 10)}. ` +
          'En una base anterior a la Fase 3.4 esto es historia migrada.',
      })),
    ],
  }
}

// ===========================================================================
// Caja
// ===========================================================================

/**
 * El cajon recibe SOLO el efectivo.
 *
 * Es la invariante que impide que una transferencia aumente el efectivo
 * fisico. Se compara MEDIO POR MEDIO: por cada venta, lo que dice el pago y lo
 * que dice el movimiento de caja tienen que coincidir en cada forma de cobro.
 *
 * Una venta de $30.000 cobrada $10.000 en efectivo y $20.000 por transferencia
 * deja dos movimientos: uno de $10.000 CASH y otro de $20.000 TRANSFER. El
 * esperado del turno suma solo el primero.
 *
 * El `FULL OUTER JOIN` no es adorno: encuentra tanto el pago sin movimiento
 * como el movimiento sin pago, que son dos errores distintos y los dos
 * importan.
 */
export async function pagosContraLaCaja(): Promise<Comprobacion> {
  const revisadas = await contar(`
    SELECT count(*)::bigint AS n FROM "CashRegisterMovement" WHERE "type" = 'sale'
  `)

  const filas = await buscar(`
    WITH pagos AS (
      SELECT p."saleId" AS venta, p."method" AS medio, sum(p."amount") AS importe
        FROM "SalePayment" p
       GROUP BY p."saleId", p."method"
    ),
    movimientos AS (
      SELECT m."saleId" AS venta, m."paymentMethod" AS medio, sum(m."amount") AS importe
        FROM "CashRegisterMovement" m
       WHERE m."type" = 'sale' AND m."saleId" IS NOT NULL
       GROUP BY m."saleId", m."paymentMethod"
    )
    SELECT COALESCE(pa.venta, mo.venta)::text       AS id,
           COALESCE(pa.medio, mo.medio)             AS medio,
           COALESCE(pa.importe, 0)::text            AS pagado,
           COALESCE(mo.importe, 0)::text            AS movido
      FROM pagos pa
      FULL OUTER JOIN movimientos mo ON mo.venta = pa.venta AND mo.medio = pa.medio
     WHERE COALESCE(pa.importe, 0) <> COALESCE(mo.importe, 0)
       -- Solo las ventas que generaron caja: las historicas sin movimiento ya
       -- las informa la comprobacion de pagos, y repetirlas aca las contaria
       -- dos veces.
       AND EXISTS (
         SELECT 1 FROM "CashRegisterMovement" m2
          WHERE m2."saleId" = COALESCE(pa.venta, mo.venta) AND m2."type" = 'sale'
       )
     ORDER BY 1, 2
  `)

  return {
    nombre: 'Venta y caja',
    revisadas,
    inconsistencias: filas.map((f): Inconsistencia => ({
      entidad: `Venta #${String(f.id)} (${String(f.medio)})`,
      regla: 'el movimiento de caja de cada medio = lo cobrado por ese medio',
      esperado: String(f.pagado),
      encontrado: String(f.movido),
      diferencia: restar(String(f.movido), String(f.pagado)),
    })),
  }
}

/**
 * Una venta anulada deja la caja como estaba.
 *
 * Por cada medio de pago, la suma de TODOS los movimientos de una venta
 * anulada tiene que dar exactamente cero: el de la venta y el de su reversion
 * se cancelan.
 */
export async function anulacionesContraLaCaja(): Promise<Comprobacion> {
  const revisadas = await contar(`
    SELECT count(*)::bigint AS n FROM "Sale" WHERE "status" = 'canceled'
  `)

  const filas = await buscar(`
    SELECT m."saleId"::text          AS id,
           m."paymentMethod"         AS medio,
           sum(m."amount")::text     AS saldo
      FROM "CashRegisterMovement" m
      JOIN "Sale" s ON s."id" = m."saleId"
     WHERE s."status" = 'canceled'
     GROUP BY m."saleId", m."paymentMethod"
    HAVING sum(m."amount") <> 0
     ORDER BY 1, 2
  `)

  return {
    nombre: 'Anulaciones',
    revisadas,
    inconsistencias: filas.map((f): Inconsistencia => ({
      entidad: `Venta anulada #${String(f.id)} (${String(f.medio)})`,
      regla: 'venta + reversion = 0',
      esperado: '0.00',
      encontrado: String(f.saldo),
      diferencia: String(f.saldo),
    })),
  }
}

/**
 * El esperado de un turno cerrado se deriva de sus movimientos.
 *
 *   openingAmount + Σ movimientos en efectivo del turno = expectedAmount
 *   countedAmount - expectedAmount                      = difference
 *
 * `expectedAmount` es la unica cifra derivada que el sistema CONGELA, y lo
 * hace al cerrar. Que siga coincidiendo con la derivacion es lo que prueba que
 * no se colo ningun movimiento despues del cierre.
 *
 * Los turnos `legacy` quedan afuera: agrupan lo anterior a que existieran los
 * turnos y nunca se cerraron.
 */
export async function turnosContraSusMovimientos(): Promise<Comprobacion> {
  const revisadas = await contar(`
    SELECT count(*)::bigint AS n FROM "CashShift" WHERE "status" = 'closed'
  `)

  const derivado = await buscar(`
    SELECT sh."id"::text                    AS id,
           sh."expectedAmount"::text        AS congelado,
           (sh."openingAmount" + COALESCE(sum(m."amount") FILTER (
              WHERE m."paymentMethod" = 'CASH'), 0))::text AS derivado,
           sh."openingAmount"::text         AS inicial
      FROM "CashShift" sh
      LEFT JOIN "CashRegisterMovement" m ON m."shiftId" = sh."id"
     WHERE sh."status" = 'closed'
     GROUP BY sh."id", sh."expectedAmount", sh."openingAmount"
    HAVING sh."expectedAmount" IS DISTINCT FROM
           (sh."openingAmount" + COALESCE(sum(m."amount") FILTER (
              WHERE m."paymentMethod" = 'CASH'), 0))
     ORDER BY sh."id"
  `)

  const diferencias = await buscar(`
    SELECT "id"::text              AS id,
           "countedAmount"::text   AS contado,
           "expectedAmount"::text  AS esperado,
           "difference"::text      AS guardada,
           ("countedAmount" - "expectedAmount")::text AS calculada
      FROM "CashShift"
     WHERE "status" = 'closed'
       AND "difference" IS DISTINCT FROM ("countedAmount" - "expectedAmount")
     ORDER BY "id"
  `)

  return {
    nombre: 'Turnos de caja',
    revisadas,
    inconsistencias: [
      ...derivado.map((f): Inconsistencia => ({
        entidad: `Turno #${String(f.id)}`,
        regla: 'esperado = inicial + efectivo del turno',
        esperado: String(f.derivado),
        encontrado: String(f.congelado ?? 'sin congelar'),
        diferencia: restar(String(f.congelado), String(f.derivado)),
        detalle: `abrio con ${String(f.inicial)}`,
      })),
      ...diferencias.map((f): Inconsistencia => ({
        entidad: `Turno #${String(f.id)}`,
        regla: 'diferencia = contado - esperado',
        esperado: String(f.calculada ?? 'sin datos'),
        encontrado: String(f.guardada ?? 'sin dato'),
        diferencia: restar(String(f.guardada), String(f.calculada)),
        detalle: `conto ${String(f.contado)}, esperaba ${String(f.esperado)}`,
      })),
    ],
  }
}

// ===========================================================================
// Inventario
// ===========================================================================

/**
 * El stock es el saldo del libro, y el libro es continuo.
 *
 * Tres reglas, de menor a mayor exigencia:
 *
 *   1. Σ movimientos = BranchStock.quantity      el saldo cierra
 *   2. previo + delta = resultante               cada fila cierra sola
 *   3. previo = resultante del anterior          no falta ninguna fila
 *
 * La tercera es la que detecta una fila BORRADA, y por eso no basta con las
 * dos primeras: borrar un movimiento del medio deja el saldo mal (la 1 lo
 * ve), pero borrar el ULTIMO y ajustar `BranchStock` a mano no lo veria
 * ninguna de las dos. La cadena si.
 *
 * La 2 la garantiza ademas un `CHECK` en la base y la 3 la protege un
 * disparador que impide UPDATE y DELETE. Comprobarlas igual no es
 * desconfianza: una restauracion desde un respaldo puede traer datos escritos
 * por una version anterior de esas defensas.
 */
export async function inventarioContraElLibro(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "BranchStock"')

  const saldos = await buscar(`
    SELECT p."name"                                AS producto,
           bs."branchId"::text                     AS sucursal,
           bs."quantity"::text                     AS stock,
           COALESCE(sum(m."quantity"), 0)::text    AS libro
      FROM "BranchStock" bs
      JOIN "Product" p ON p."id" = bs."productId"
      LEFT JOIN "StockMovement" m
             ON m."productId" = bs."productId" AND m."branchId" = bs."branchId"
     GROUP BY p."name", bs."branchId", bs."quantity"
    HAVING bs."quantity" <> COALESCE(sum(m."quantity"), 0)
     ORDER BY p."name"
  `)

  const filasSueltas = await buscar(`
    SELECT m."id"::text                 AS id,
           p."name"                     AS producto,
           m."previousQuantity"::text   AS previo,
           m."quantity"::text           AS delta,
           m."resultingQuantity"::text  AS resultante
      FROM "StockMovement" m
      JOIN "Product" p ON p."id" = m."productId"
     WHERE m."previousQuantity" + m."quantity" <> m."resultingQuantity"
     ORDER BY m."id"
  `)

  const cadena = await buscar(`
    WITH ordenado AS (
      SELECT m."id", m."productId", m."branchId", m."previousQuantity",
             lag(m."resultingQuantity") OVER (
               PARTITION BY m."branchId", m."productId" ORDER BY m."id"
             ) AS anterior
        FROM "StockMovement" m
    )
    SELECT o."id"::text                          AS id,
           p."name"                              AS producto,
           o."previousQuantity"::text            AS previo,
           COALESCE(o.anterior, 0)::text         AS deberia
      FROM ordenado o
      JOIN "Product" p ON p."id" = o."productId"
     WHERE o."previousQuantity" <> COALESCE(o.anterior, 0)
     ORDER BY o."id"
  `)

  return {
    nombre: 'Inventario',
    revisadas,
    inconsistencias: [
      ...saldos.map((f): Inconsistencia => ({
        entidad: String(f.producto),
        regla: 'stock = suma del libro',
        esperado: String(f.libro),
        encontrado: String(f.stock),
        diferencia: restar(String(f.stock), String(f.libro)),
        detalle: `sucursal ${String(f.sucursal)}`,
      })),
      ...filasSueltas.map((f): Inconsistencia => ({
        entidad: `Movimiento #${String(f.id)} — ${String(f.producto)}`,
        regla: 'previo + delta = resultante',
        esperado: String(f.resultante),
        encontrado: `${String(f.previo)} + ${String(f.delta)}`,
        diferencia: null,
      })),
      ...cadena.map((f): Inconsistencia => ({
        entidad: `Movimiento #${String(f.id)} — ${String(f.producto)}`,
        regla: 'empieza donde termino el anterior',
        esperado: String(f.deberia),
        encontrado: String(f.previo),
        diferencia: restar(String(f.previo), String(f.deberia)),
        detalle: 'falta un movimiento entre este y el anterior',
      })),
    ],
  }
}

// ===========================================================================
// Compras
// ===========================================================================

/**
 * Lo recibido de una orden es lo que dicen sus recepciones.
 *
 * Cuatro reglas:
 *
 *   1. receivedQuantity de la linea = Σ de sus lineas de recepcion
 *   2. recibido <= pedido                     (ademas hay un CHECK)
 *   3. el estado se deriva de lo recibido
 *   4. expectedTotal = Σ (pedido × costo unitario)
 *
 * La 3 no se aplica a una orden CANCELLED: cancelar no revierte lo ya
 * recibido, y una orden cancelada a mitad de camino conserva su mercaderia,
 * su stock y su costo. Su estado dice como termino la ORDEN, no cuanto llego.
 */
export async function comprasContraSusRecepciones(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "PurchaseOrder"')

  const lineas = await buscar(`
    SELECT o."number"                            AS orden,
           p."name"                              AS producto,
           i."receivedQuantity"::text            AS anotado,
           COALESCE(sum(r."receivedQuantity"), 0)::text AS recepciones,
           i."orderedQuantity"::text             AS pedido
      FROM "PurchaseOrderItem" i
      JOIN "PurchaseOrder" o ON o."id" = i."purchaseOrderId"
      JOIN "Product" p ON p."id" = i."productId"
      LEFT JOIN "PurchaseReceiptItem" r ON r."purchaseOrderItemId" = i."id"
     GROUP BY o."number", p."name", i."receivedQuantity", i."orderedQuantity"
    HAVING i."receivedQuantity" <> COALESCE(sum(r."receivedQuantity"), 0)
        OR i."receivedQuantity" > i."orderedQuantity"
     ORDER BY o."number", p."name"
  `)

  const estados = await buscar(`
    SELECT o."number"  AS orden,
           o."status"  AS guardado,
           CASE
             WHEN sum(i."receivedQuantity") = 0                      THEN 'ORDERED'
             WHEN sum(i."receivedQuantity") >= sum(i."orderedQuantity") THEN 'RECEIVED'
             ELSE 'PARTIALLY_RECEIVED'
           END AS derivado
      FROM "PurchaseOrder" o
      JOIN "PurchaseOrderItem" i ON i."purchaseOrderId" = o."id"
     WHERE o."status" IN ('ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED')
     GROUP BY o."number", o."status"
    HAVING o."status" <> CASE
             WHEN sum(i."receivedQuantity") = 0                      THEN 'ORDERED'
             WHEN sum(i."receivedQuantity") >= sum(i."orderedQuantity") THEN 'RECEIVED'
             ELSE 'PARTIALLY_RECEIVED'
           END
     ORDER BY o."number"
  `)

  const totales = await buscar(`
    SELECT o."number"                 AS orden,
           o."expectedTotal"::text    AS guardado,
           COALESCE(sum(round(i."orderedQuantity" * i."unitCost", 2)), 0)::text AS calculado
      FROM "PurchaseOrder" o
      LEFT JOIN "PurchaseOrderItem" i ON i."purchaseOrderId" = o."id"
     GROUP BY o."number", o."expectedTotal"
    HAVING o."expectedTotal" <> COALESCE(sum(round(i."orderedQuantity" * i."unitCost", 2)), 0)
     ORDER BY o."number"
  `)

  return {
    nombre: 'Compras',
    revisadas,
    inconsistencias: [
      ...lineas.map((f): Inconsistencia => ({
        entidad: `${String(f.orden)} — ${String(f.producto)}`,
        regla: 'recibido = suma de las recepciones, y nunca mayor que lo pedido',
        esperado: String(f.recepciones),
        encontrado: String(f.anotado),
        diferencia: restar(String(f.anotado), String(f.recepciones)),
        detalle: `pedido ${String(f.pedido)}`,
      })),
      ...estados.map((f): Inconsistencia => ({
        entidad: String(f.orden),
        regla: 'el estado se deriva de lo recibido',
        esperado: String(f.derivado),
        encontrado: String(f.guardado),
        diferencia: null,
      })),
      ...totales.map((f): Inconsistencia => ({
        entidad: String(f.orden),
        regla: 'total = suma de pedido x costo unitario',
        esperado: String(f.calculado),
        encontrado: String(f.guardado),
        diferencia: restar(String(f.guardado), String(f.calculado)),
      })),
    ],
  }
}

/**
 * Cada recepcion convirtio bien y movio el stock.
 *
 *   stockQuantity = receivedQuantity x unitsPerPurchaseUnit
 *
 * y por cada recepcion tiene que existir su movimiento PURCHASE_RECEIPT con la
 * misma cantidad. Sin lo segundo, una entrada de mercaderia podria quedar
 * anotada sin haber sumado stock.
 */
export async function recepcionesContraElStock(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "PurchaseReceiptItem"')

  const conversiones = await buscar(`
    SELECT r."id"::text                     AS id,
           p."name"                         AS producto,
           r."receivedQuantity"::text       AS recibido,
           r."unitsPerPurchaseUnit"::text   AS factor,
           r."stockQuantity"::text          AS anotado,
           round(r."receivedQuantity" * r."unitsPerPurchaseUnit", 3)::text AS calculado
      FROM "PurchaseReceiptItem" r
      JOIN "Product" p ON p."id" = r."productId"
     WHERE r."stockQuantity" <> round(r."receivedQuantity" * r."unitsPerPurchaseUnit", 3)
     ORDER BY r."id"
  `)

  const movimientos = await buscar(`
    SELECT rec."id"::text                          AS id,
           p."name"                                AS producto,
           sum(ri."stockQuantity")::text           AS recibido,
           COALESCE((
             SELECT sum(m."quantity") FROM "StockMovement" m
              WHERE m."referenceType" = 'PurchaseReceipt'
                AND m."referenceId" = rec."id"
                AND m."productId" = ri."productId"
                AND m."type" = 'PURCHASE_RECEIPT'
           ), 0)::text                             AS movido
      FROM "PurchaseReceipt" rec
      JOIN "PurchaseReceiptItem" ri ON ri."purchaseReceiptId" = rec."id"
      JOIN "Product" p ON p."id" = ri."productId"
     GROUP BY rec."id", p."name", ri."productId"
    HAVING sum(ri."stockQuantity") <> COALESCE((
             SELECT sum(m."quantity") FROM "StockMovement" m
              WHERE m."referenceType" = 'PurchaseReceipt'
                AND m."referenceId" = rec."id"
                AND m."productId" = ri."productId"
                AND m."type" = 'PURCHASE_RECEIPT'
           ), 0)
     ORDER BY rec."id"
  `)

  return {
    nombre: 'Recepciones',
    revisadas,
    inconsistencias: [
      ...conversiones.map((f): Inconsistencia => ({
        entidad: `Recepcion linea #${String(f.id)} — ${String(f.producto)}`,
        regla: 'stock = recibido x unidades por bulto',
        esperado: String(f.calculado),
        encontrado: String(f.anotado),
        diferencia: restar(String(f.anotado), String(f.calculado)),
        detalle: `${String(f.recibido)} x ${String(f.factor)}`,
      })),
      ...movimientos.map((f): Inconsistencia => ({
        entidad: `Recepcion #${String(f.id)} — ${String(f.producto)}`,
        regla: 'toda recepcion tiene su movimiento de stock',
        esperado: String(f.recibido),
        encontrado: String(f.movido),
        diferencia: restar(String(f.movido), String(f.recibido)),
      })),
    ],
  }
}

// ===========================================================================
// Costos
// ===========================================================================

/**
 * El costo actual es el del ultimo evento, y el historial encadena.
 *
 * LA REGLA, que resuelve la unica ambiguedad posible: `Product.cost` es el
 * `newCost` de la fila con el `id` MAS ALTO. Da igual si esa fila vino de una
 * recepcion o de un cambio manual autorizado; lo que decide es cual paso
 * ultimo. Una correccion a mano posterior a una recepcion GANA, y una
 * recepcion posterior a una correccion tambien.
 *
 * Se ordena por `id` y no por `createdAt` porque `createdAt` sale de `now()`,
 * que en PostgreSQL es la hora de inicio de la TRANSACCION: dos transacciones
 * que se pisan pueden quedar con las fechas al reves del orden real de
 * escritura. El `id` se asigna en el INSERT, y el INSERT ocurre despues del
 * bloqueo que toma `registrarCambioDeCosto`.
 *
 * La segunda regla --el `previousCost` de cada fila es el `newCost` de la
 * anterior-- es la que detecta dos cambios simultaneos que leyeron el mismo
 * punto de partida.
 */
export async function costosContraSuHistorial(): Promise<Comprobacion> {
  const revisadas = await contar(`
    SELECT count(DISTINCT "productId")::bigint AS n FROM "ProductCostHistory"
  `)

  const actuales = await buscar(`
    WITH ultimo AS (
      SELECT DISTINCT ON ("productId") "productId", "newCost", "id", "receiptId"
        FROM "ProductCostHistory"
       ORDER BY "productId", "id" DESC
    )
    SELECT p."name"                AS producto,
           p."cost"::text          AS actual,
           u."newCost"::text       AS ultimo,
           u."id"::text            AS fila,
           CASE WHEN u."receiptId" IS NULL THEN 'cambio manual' ELSE 'recepcion' END AS origen
      FROM ultimo u
      JOIN "Product" p ON p."id" = u."productId"
     WHERE p."cost" IS DISTINCT FROM u."newCost"
     ORDER BY p."name"
  `)

  const cadena = await buscar(`
    WITH ordenado AS (
      SELECT h."id", h."productId", h."previousCost",
             lag(h."newCost") OVER (PARTITION BY h."productId" ORDER BY h."id") AS anterior,
             row_number() OVER (PARTITION BY h."productId" ORDER BY h."id") AS puesto
        FROM "ProductCostHistory" h
    )
    SELECT o."id"::text            AS id,
           p."name"                AS producto,
           o."previousCost"::text  AS previo,
           o.anterior::text        AS deberia
      FROM ordenado o
      JOIN "Product" p ON p."id" = o."productId"
     WHERE o.puesto > 1
       AND o."previousCost" IS DISTINCT FROM o.anterior
     ORDER BY o."id"
  `)

  return {
    nombre: 'Costos',
    revisadas,
    inconsistencias: [
      ...actuales.map((f): Inconsistencia => ({
        entidad: String(f.producto),
        regla: 'costo actual = ultimo evento del historial',
        esperado: String(f.ultimo ?? 'sin costo'),
        encontrado: String(f.actual ?? 'sin costo'),
        diferencia: restar(String(f.actual), String(f.ultimo)),
        detalle: `ultimo evento: fila #${String(f.fila)}, ${String(f.origen)}`,
      })),
      ...cadena.map((f): Inconsistencia => ({
        entidad: `Historial #${String(f.id)} — ${String(f.producto)}`,
        regla: 'parte del costo que dejo el evento anterior',
        esperado: String(f.deberia ?? 'sin costo'),
        encontrado: String(f.previo ?? 'sin costo'),
        diferencia: restar(String(f.previo), String(f.deberia)),
      })),
    ],
  }
}

/** Todas las comprobaciones, en el orden en que se informan. */
export const COMPROBACIONES: Array<() => Promise<Comprobacion>> = [
  ventasContraSusLineas,
  ventasContraSusPagos,
  pagosContraLaCaja,
  anulacionesContraLaCaja,
  turnosContraSusMovimientos,
  inventarioContraElLibro,
  comprasContraSusRecepciones,
  recepcionesContraElStock,
  costosContraSuHistorial,
]
