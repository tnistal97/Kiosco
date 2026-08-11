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
 *
 * `ACCOUNT` queda EXCLUIDO desde la Fase 4A, y no es una excepcion para que la
 * comprobacion siga pasando: es la regla del modelo. Un cargo a cuenta no es
 * plata que cambio de manos, asi que no genera movimiento de caja, y exigirle
 * uno seria exigir que el cajon registre dinero que nadie recibio. Lo fiado
 * tiene su propia comprobacion --`ventasACuentaContraElLibro`-- que le exige lo
 * que si le corresponde: su movimiento en el libro del cliente.
 *
 * Cada linea de pago va a exactamente UNO de dos destinos, y hay una
 * comprobacion por cada destino. Ninguna linea queda sin comprobar.
 */
export async function pagosContraLaCaja(): Promise<Comprobacion> {
  const revisadas = await contar(`
    SELECT count(*)::bigint AS n FROM "CashRegisterMovement" WHERE "type" = 'sale'
  `)

  const filas = await buscar(`
    WITH pagos AS (
      SELECT p."saleId" AS venta, p."method" AS medio, sum(p."amount") AS importe
        FROM "SalePayment" p
       WHERE p."method" <> 'ACCOUNT'
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

// ===========================================================================
// Cuenta corriente
// ===========================================================================

/**
 * El saldo de un cliente es el saldo de su libro, y el libro es continuo.
 *
 * Las mismas tres reglas que el inventario, sobre la otra tabla:
 *
 *   1. Σ movimientos = Client.balance       el saldo cierra
 *   2. previo + delta = resultante          cada fila cierra sola
 *   3. previo = resultante del anterior     no falta ninguna fila
 *
 * La tercera es la que detecta una fila BORRADA del medio, y tiene el mismo
 * punto ciego que en el inventario: borrar el ULTIMO movimiento y ajustar
 * `Client.balance` a mano no lo ve ninguna de las tres. Contra eso protege el
 * disparador de inmutabilidad, no esta comprobacion. Esta escrito porque
 * decirlo vale mas que fingir lo contrario.
 *
 * `Client` se revisa ENTERO, incluidos los que no tienen ningun movimiento: un
 * cliente con saldo distinto de cero y libro vacio es exactamente el caso que
 * la regla 1 existe para encontrar.
 */
export async function clientesContraSuLibro(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "Client"')

  const saldos = await buscar(`
    SELECT c."name"                                       AS cliente,
           c."branchId"::text                             AS sucursal,
           c."balance"::numeric(14,2)::text               AS saldo,
           COALESCE(sum(m."amount"), 0)::numeric(14,2)::text AS libro,
           count(m."id")::text                            AS cuantos
      FROM "Client" c
      LEFT JOIN "CustomerAccountMovement" m ON m."clientId" = c."id"
     GROUP BY c."id", c."name", c."branchId", c."balance"
    HAVING c."balance" <> COALESCE(sum(m."amount"), 0)
     ORDER BY c."name"
  `)

  const filasSueltas = await buscar(`
    SELECT m."id"::text                              AS id,
           c."name"                                  AS cliente,
           m."previousBalance"::numeric(14,2)::text  AS previo,
           m."amount"::numeric(14,2)::text           AS delta,
           m."resultingBalance"::numeric(14,2)::text AS resultante
      FROM "CustomerAccountMovement" m
      JOIN "Client" c ON c."id" = m."clientId"
     WHERE m."previousBalance" + m."amount" <> m."resultingBalance"
     ORDER BY m."id"
  `)

  const cadena = await buscar(`
    WITH ordenado AS (
      SELECT m."id", m."clientId", m."previousBalance",
             lag(m."resultingBalance") OVER (
               PARTITION BY m."clientId" ORDER BY m."id"
             ) AS anterior
        FROM "CustomerAccountMovement" m
    )
    SELECT o."id"::text                                     AS id,
           c."name"                                         AS cliente,
           o."previousBalance"::numeric(14,2)::text         AS previo,
           COALESCE(o.anterior, 0)::numeric(14,2)::text     AS deberia
      FROM ordenado o
      JOIN "Client" c ON c."id" = o."clientId"
     WHERE o."previousBalance" <> COALESCE(o.anterior, 0)
     ORDER BY o."id"
  `)

  return {
    nombre: 'Clientes',
    revisadas,
    inconsistencias: [
      ...saldos.map((f): Inconsistencia => ({
        entidad: String(f.cliente),
        regla: 'saldo = suma del libro',
        esperado: String(f.libro),
        encontrado: String(f.saldo),
        diferencia: restar(String(f.saldo), String(f.libro)),
        detalle: `sucursal ${String(f.sucursal)}, ${String(f.cuantos)} movimiento(s)`,
      })),
      ...filasSueltas.map((f): Inconsistencia => ({
        entidad: `Movimiento #${String(f.id)} — ${String(f.cliente)}`,
        regla: 'previo + delta = resultante',
        esperado: String(f.resultante),
        encontrado: `${String(f.previo)} + ${String(f.delta)}`,
        diferencia: null,
      })),
      ...cadena.map((f): Inconsistencia => ({
        entidad: `Movimiento #${String(f.id)} — ${String(f.cliente)}`,
        regla: 'empieza donde termino el anterior',
        esperado: String(f.deberia),
        encontrado: String(f.previo),
        diferencia: restar(String(f.previo), String(f.deberia)),
        detalle: 'falta un movimiento entre este y el anterior',
      })),
    ],
  }
}

/**
 * Lo fiado en una venta esta cargado en la cuenta del cliente.
 *
 * Es la comprobacion que le corresponde al destino que `pagosContraLaCaja` no
 * mira. Por cada venta con lineas `ACCOUNT`:
 *
 *   Σ SalePayment(ACCOUNT) = Σ CustomerAccountMovement(SALE_CHARGE) de esa venta
 *
 * Y ademas, en la otra direccion: no puede existir un cargo a cuenta cuya venta
 * no tenga linea `ACCOUNT`. El `FULL OUTER JOIN` encuentra los dos.
 *
 * La tercera regla no es de importes sino de coherencia: una venta con parte
 * fiada tiene que tener CLIENTE, y el cargo tiene que ser al MISMO cliente. Una
 * deuda cargada a otra persona cuadra perfecto en los importes y es el peor
 * error posible de todo el modulo.
 */
export async function ventasACuentaContraElLibro(): Promise<Comprobacion> {
  const revisadas = await contar(`
    SELECT count(DISTINCT "saleId")::bigint AS n FROM "SalePayment" WHERE "method" = 'ACCOUNT'
  `)

  const importes = await buscar(`
    WITH fiado AS (
      SELECT p."saleId" AS venta, sum(p."amount") AS importe
        FROM "SalePayment" p
       WHERE p."method" = 'ACCOUNT'
       GROUP BY p."saleId"
    ),
    cargado AS (
      SELECT m."saleId" AS venta, sum(m."amount") AS importe
        FROM "CustomerAccountMovement" m
       WHERE m."type" = 'SALE_CHARGE' AND m."saleId" IS NOT NULL
       GROUP BY m."saleId"
    )
    SELECT COALESCE(f.venta, c.venta)::text                    AS id,
           COALESCE(f.importe, 0)::numeric(14,2)::text         AS fiado,
           COALESCE(c.importe, 0)::numeric(14,2)::text         AS cargado
      FROM fiado f
      FULL OUTER JOIN cargado c ON c.venta = f.venta
     WHERE COALESCE(f.importe, 0) <> COALESCE(c.importe, 0)
     ORDER BY 1
  `)

  const sinCliente = await buscar(`
    SELECT s."id"::text                          AS id,
           sum(p."amount")::numeric(14,2)::text  AS fiado
      FROM "Sale" s
      JOIN "SalePayment" p ON p."saleId" = s."id" AND p."method" = 'ACCOUNT'
     WHERE s."clientId" IS NULL
     GROUP BY s."id"
     ORDER BY s."id"
  `)

  const otroCliente = await buscar(`
    SELECT m."id"::text        AS id,
           m."saleId"::text    AS venta,
           m."clientId"::text  AS "cargadoA",
           s."clientId"::text  AS "deLaVenta"
      FROM "CustomerAccountMovement" m
      JOIN "Sale" s ON s."id" = m."saleId"
     WHERE m."type" IN ('SALE_CHARGE', 'SALE_CANCEL')
       AND m."clientId" IS DISTINCT FROM s."clientId"
     ORDER BY m."id"
  `)

  return {
    nombre: 'Venta a cuenta',
    revisadas,
    inconsistencias: [
      ...importes.map((f): Inconsistencia => ({
        entidad: `Venta #${String(f.id)}`,
        regla: 'lo fiado en la venta = lo cargado a la cuenta',
        esperado: String(f.fiado),
        encontrado: String(f.cargado),
        diferencia: restar(String(f.cargado), String(f.fiado)),
      })),
      ...sinCliente.map((f): Inconsistencia => ({
        entidad: `Venta #${String(f.id)}`,
        regla: 'una venta con saldo a cuenta tiene cliente',
        esperado: 'un cliente',
        encontrado: 'ninguno',
        diferencia: null,
        detalle: `${String(f.fiado)} a cuenta sin deudor: esa plata no se puede cobrar`,
      })),
      ...otroCliente.map((f): Inconsistencia => ({
        entidad: `Movimiento #${String(f.id)}`,
        regla: 'el cargo es al cliente de la venta',
        esperado: `cliente ${String(f.deLaVenta ?? 'ninguno')}`,
        encontrado: `cliente ${String(f.cargadoA)}`,
        diferencia: null,
        detalle: `venta #${String(f.venta)}`,
      })),
    ],
  }
}

/**
 * Todo cobro genero exactamente un movimiento, por el mismo importe y negativo.
 *
 * Tres reglas:
 *
 *   1. cada `CustomerPayment` tiene UN movimiento `PAYMENT`;
 *   2. ese movimiento vale `-amount`;
 *   3. si se cobro en efectivo, hay movimiento de caja por el mismo importe.
 *
 * La 3 es la que pide el objetivo 29: el efectivo que entra por cobranza tiene
 * que llegar al cajon igual que el de una venta, y una transferencia NO.
 */
export async function pagosDeClientesContraElLibro(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "CustomerPayment"')

  const contraLibro = await buscar(`
    SELECT p."number"                                       AS numero,
           p."amount"::numeric(14,2)::text                  AS cobrado,
           COALESCE(sum(m."amount"), 0)::numeric(14,2)::text AS movido,
           count(m."id")::text                              AS cuantos
      FROM "CustomerPayment" p
      LEFT JOIN "CustomerAccountMovement" m
             ON m."paymentId" = p."id" AND m."type" = 'PAYMENT'
     GROUP BY p."id", p."number", p."amount"
    HAVING count(m."id") <> 1
        OR COALESCE(sum(m."amount"), 0) <> -p."amount"
     ORDER BY p."number"
  `)

  // La union es por `customerPaymentId`, la clave foranea, y no por el numero
  // de comprobante dentro de `description`: un texto es para leer, no para unir
  // tablas. Con un LIKE, cambiar como se redacta esa frase haria que la
  // comprobacion dejara de encontrar nada y empezara a informar que todo cierra.
  const contraCaja = await buscar(`
    SELECT p."number"                                        AS numero,
           p."amount"::numeric(14,2)::text                   AS cobrado,
           COALESCE(sum(cm."amount"), 0)::numeric(14,2)::text AS "enCaja"
      FROM "CustomerPayment" p
      LEFT JOIN "CashRegisterMovement" cm ON cm."customerPaymentId" = p."id"
     WHERE p."method" = 'CASH'
     GROUP BY p."id", p."number", p."amount"
    HAVING p."amount" <> COALESCE(sum(cm."amount"), 0)
     ORDER BY p."number"
  `)

  const noEfectivoEnCaja = await buscar(`
    SELECT p."number"  AS numero,
           p."method"  AS medio
      FROM "CustomerPayment" p
     WHERE p."method" <> 'CASH'
       AND EXISTS (
         SELECT 1 FROM "CashRegisterMovement" cm WHERE cm."customerPaymentId" = p."id"
       )
     ORDER BY p."number"
  `)

  return {
    nombre: 'Cobros a clientes',
    revisadas,
    inconsistencias: [
      ...contraLibro.map((f): Inconsistencia => ({
        entidad: `Cobro ${String(f.numero)}`,
        regla: 'todo cobro deja un movimiento de cuenta por el mismo importe, en negativo',
        esperado: `-${String(f.cobrado)} en 1 movimiento`,
        encontrado: `${String(f.movido)} en ${String(f.cuantos)}`,
        diferencia: null,
      })),
      ...contraCaja.map((f): Inconsistencia => ({
        entidad: `Cobro ${String(f.numero)}`,
        regla: 'un cobro en efectivo entra al cajon',
        esperado: String(f.cobrado),
        encontrado: String(f.enCaja),
        diferencia: restar(String(f.enCaja), String(f.cobrado)),
      })),
      ...noEfectivoEnCaja.map((f): Inconsistencia => ({
        entidad: `Cobro ${String(f.numero)}`,
        regla: 'un cobro que no es en efectivo NO entra al cajon',
        esperado: 'ningun movimiento de caja',
        encontrado: `movimiento de caja con medio ${String(f.medio)}`,
        diferencia: null,
      })),
    ],
  }
}

/**
 * Una venta anulada deja la cuenta del cliente como estaba.
 *
 * Por cada venta anulada que tuvo parte fiada, la suma de sus movimientos de
 * cuenta tiene que dar exactamente cero: el cargo y su reversion se cancelan.
 * Es la misma forma que `anulacionesContraLaCaja`, sobre la otra tabla.
 *
 * IMPORTANTE — lo que esta regla NO dice: no dice que el SALDO del cliente
 * vuelva a lo que era. Si entre la venta y su anulacion el cliente pago, ese
 * pago sigue existiendo y le queda a favor. Eso es correcto y es la politica
 * del objetivo 18: lo que se revierte es la venta, no la historia. Por eso se
 * suman los movimientos DE ESA VENTA y no el saldo del cliente.
 */
export async function anulacionesContraLaCuenta(): Promise<Comprobacion> {
  const revisadas = await contar(`
    SELECT count(*)::bigint AS n
      FROM "Sale" s
     WHERE s."status" = 'canceled'
       AND EXISTS (
         SELECT 1 FROM "SalePayment" p
          WHERE p."saleId" = s."id" AND p."method" = 'ACCOUNT'
       )
  `)

  const filas = await buscar(`
    SELECT m."saleId"::text                        AS id,
           c."name"                                AS cliente,
           sum(m."amount")::numeric(14,2)::text    AS saldo,
           count(*)::text                          AS cuantos
      FROM "CustomerAccountMovement" m
      JOIN "Sale" s ON s."id" = m."saleId"
      JOIN "Client" c ON c."id" = m."clientId"
     WHERE s."status" = 'canceled'
       AND m."type" IN ('SALE_CHARGE', 'SALE_CANCEL')
     GROUP BY m."saleId", c."name"
    HAVING sum(m."amount") <> 0
     ORDER BY 1
  `)

  return {
    nombre: 'Anulaciones de cuenta',
    revisadas,
    inconsistencias: filas.map((f): Inconsistencia => ({
      entidad: `Venta anulada #${String(f.id)} — ${String(f.cliente)}`,
      regla: 'cargo + reversion = 0',
      esperado: '0.00',
      encontrado: String(f.saldo),
      diferencia: String(f.saldo),
      detalle: `${String(f.cuantos)} movimiento(s) de esa venta`,
    })),
  }
}

// ===========================================================================
// Cuentas por pagar a proveedores (Fase 4B)
// ===========================================================================

/**
 * El saldo de todo proveedor es la suma de su libro.
 *
 *   para todo proveedor:  suma(SupplierAccountMovement.amount) == Supplier.balance
 *
 * Es la invariante del modulo, y la misma forma que la de clientes y la de
 * inventario. Tres reglas, como alla:
 *
 *   1. el saldo cierra contra la suma del libro;
 *   2. cada fila cumple `previo + delta = resultante`;
 *   3. cada fila arranca donde termino la anterior del mismo proveedor.
 *
 * La 3 es la que detecta un movimiento BORRADO en el medio: las otras dos
 * seguirian dando bien. No detecta uno borrado al final --lo tapa el disparador
 * de inmutabilidad, no esta comprobacion-- y eso esta escrito en
 * docs/SUPPLIER_ACCOUNT_LEDGER.md en vez de darse por cubierto.
 */
export async function proveedoresContraSuLibro(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "Supplier"')

  const saldos = await buscar(`
    SELECT s."name"                                      AS proveedor,
           s."balance"::numeric(14,2)::text              AS saldo,
           COALESCE(m.total, 0)::numeric(14,2)::text     AS libro,
           COALESCE(m.cuantos, 0)::text                  AS cuantos
      FROM "Supplier" s
      LEFT JOIN (
        SELECT "supplierId", sum("amount") AS total, count(*) AS cuantos
          FROM "SupplierAccountMovement"
         GROUP BY "supplierId"
      ) m ON m."supplierId" = s."id"
     WHERE s."balance" <> COALESCE(m.total, 0)
     ORDER BY s."name"
  `)

  const filasSueltas = await buscar(`
    SELECT m."id"::text                              AS id,
           s."name"                                  AS proveedor,
           m."previousBalance"::numeric(14,2)::text  AS previo,
           m."amount"::numeric(14,2)::text           AS delta,
           m."resultingBalance"::numeric(14,2)::text AS resultante
      FROM "SupplierAccountMovement" m
      JOIN "Supplier" s ON s."id" = m."supplierId"
     WHERE m."previousBalance" + m."amount" <> m."resultingBalance"
     ORDER BY m."id"
  `)

  const cadena = await buscar(`
    WITH ordenado AS (
      SELECT m."id", m."supplierId", m."previousBalance",
             lag(m."resultingBalance") OVER (
               PARTITION BY m."supplierId" ORDER BY m."id"
             ) AS anterior
        FROM "SupplierAccountMovement" m
    )
    SELECT o."id"::text                                 AS id,
           s."name"                                     AS proveedor,
           o."previousBalance"::numeric(14,2)::text     AS previo,
           COALESCE(o.anterior, 0)::numeric(14,2)::text AS deberia
      FROM ordenado o
      JOIN "Supplier" s ON s."id" = o."supplierId"
     WHERE o."previousBalance" <> COALESCE(o.anterior, 0)
     ORDER BY o."id"
  `)

  return {
    nombre: 'Proveedores',
    revisadas,
    inconsistencias: [
      ...saldos.map((f): Inconsistencia => ({
        entidad: String(f.proveedor),
        regla: 'saldo = suma del libro',
        esperado: String(f.libro),
        encontrado: String(f.saldo),
        diferencia: restar(String(f.saldo), String(f.libro)),
        detalle: `${String(f.cuantos)} movimiento(s)`,
      })),
      ...filasSueltas.map((f): Inconsistencia => ({
        entidad: `Movimiento #${String(f.id)} — ${String(f.proveedor)}`,
        regla: 'previo + delta = resultante',
        esperado: String(f.resultante),
        encontrado: `${String(f.previo)} + ${String(f.delta)}`,
        diferencia: null,
      })),
      ...cadena.map((f): Inconsistencia => ({
        entidad: `Movimiento #${String(f.id)} — ${String(f.proveedor)}`,
        regla: 'cada movimiento arranca donde termino el anterior',
        esperado: String(f.deberia),
        encontrado: String(f.previo),
        diferencia: restar(String(f.previo), String(f.deberia)),
        detalle: 'falta un movimiento entre este y el anterior',
      })),
    ],
  }
}

/**
 * Toda recepcion financiera esta representada EXACTAMENTE UNA VEZ.
 *
 * Es el objetivo 24, y la invariante se comprueba EN LAS DOS DIRECCIONES:
 *
 *   debtRecorded = true  <=>  existe exactamente un PURCHASE_CHARGE suyo
 *
 * Las dos direcciones importan y detectan cosas distintas:
 *
 *   · una recepcion con `debtRecorded` y sin cargo -> se perdio la deuda;
 *   · una recepcion con cargo y sin `debtRecorded` -> alguien escribio en el
 *     libro por fuera del servicio.
 *
 * Una recepcion SIN ninguna de las dos es correcta: es anterior a esta fase, y
 * la migracion no inventa deuda historica. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
 *
 * Y el importe del cargo tiene que ser el REAL de la entrega, que es el
 * objetivo 6: si la factura vino $104.500, se deben $104.500 y no los $100.000
 * que decia la orden.
 */
export async function recepcionesContraLaDeuda(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "PurchaseReceipt"')

  const desalineadas = await buscar(`
    SELECT r."id"::text                          AS id,
           o."number"                            AS orden,
           r."debtRecorded"::text                AS marcada,
           count(m."id")::text                   AS cargos
      FROM "PurchaseReceipt" r
      JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
      LEFT JOIN "SupplierAccountMovement" m
             ON m."receiptId" = r."id" AND m."type" = 'PURCHASE_CHARGE'
     GROUP BY r."id", o."number", r."debtRecorded"
    HAVING (r."debtRecorded" = true  AND count(m."id") <> 1)
        OR (r."debtRecorded" = false AND count(m."id") <> 0)
     ORDER BY r."id"
  `)

  const importes = await buscar(`
    SELECT r."id"::text                       AS id,
           o."number"                         AS orden,
           r."total"::numeric(14,2)::text     AS total,
           m."amount"::numeric(14,2)::text    AS cargo
      FROM "PurchaseReceipt" r
      JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
      JOIN "SupplierAccountMovement" m
             ON m."receiptId" = r."id" AND m."type" = 'PURCHASE_CHARGE'
     WHERE m."amount" <> r."total"
     ORDER BY r."id"
  `)

  // El total tiene que seguir siendo la suma de las lineas, al costo REAL.
  // Vale la pena repetirlo aca aunque la migracion lo dejo asi: es la unica
  // forma de que un INSERT hecho por fuera del servicio se note.
  const contraLineas = await buscar(`
    SELECT r."id"::text                       AS id,
           o."number"                         AS orden,
           r."total"::numeric(14,2)::text     AS total,
           COALESCE(sum(round(i."receivedQuantity" * i."unitCost", 2)), 0)::numeric(14,2)::text
                                              AS lineas
      FROM "PurchaseReceipt" r
      JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
      LEFT JOIN "PurchaseReceiptItem" i ON i."purchaseReceiptId" = r."id"
     GROUP BY r."id", o."number", r."total"
    HAVING r."total" <> COALESCE(sum(round(i."receivedQuantity" * i."unitCost", 2)), 0)
     ORDER BY r."id"
  `)

  return {
    nombre: 'Deuda por recepción',
    revisadas,
    inconsistencias: [
      ...desalineadas.map((f): Inconsistencia => ({
        entidad: `Recepción #${String(f.id)} — ${String(f.orden)}`,
        regla: 'marcada como registrada <=> tiene exactamente un cargo',
        esperado: f.marcada === 'true' ? '1 cargo' : 'ningun cargo',
        encontrado: `${String(f.cargos)} cargo(s), marcada=${String(f.marcada)}`,
        diferencia: null,
      })),
      ...importes.map((f): Inconsistencia => ({
        entidad: `Recepción #${String(f.id)} — ${String(f.orden)}`,
        regla: 'el cargo vale lo que costo la entrega',
        esperado: String(f.total),
        encontrado: String(f.cargo),
        diferencia: restar(String(f.cargo), String(f.total)),
      })),
      ...contraLineas.map((f): Inconsistencia => ({
        entidad: `Recepción #${String(f.id)} — ${String(f.orden)}`,
        regla: 'importe = suma de las lineas al costo real',
        esperado: String(f.lineas),
        encontrado: String(f.total),
        diferencia: restar(String(f.total), String(f.lineas)),
      })),
    ],
  }
}

/**
 * Todo pago a proveedor genero exactamente un movimiento, y la caja acompana.
 *
 * Tres reglas, el espejo exacto de las de cobranza:
 *
 *   1. cada `SupplierPayment` tiene UN movimiento `PAYMENT`;
 *   2. ese movimiento vale `-amount`;
 *   3. si se pago en efectivo hay egreso de caja por `-amount`, y si NO se pago
 *      en efectivo no hay ninguno.
 *
 * La 3 es la del objetivo 15, y la parte que mas se confunde en la practica:
 * una transferencia baja la deuda y NO baja el cajon. La union es por
 * `supplierPaymentId`, la clave foranea, y no por el numero de comprobante
 * dentro de `description`.
 */
export async function pagosAProveedoresContraElLibro(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "SupplierPayment"')

  const contraLibro = await buscar(`
    SELECT p."number"                                        AS numero,
           p."amount"::numeric(14,2)::text                    AS pagado,
           COALESCE(sum(m."amount"), 0)::numeric(14,2)::text  AS movido,
           count(m."id")::text                                AS cuantos
      FROM "SupplierPayment" p
      LEFT JOIN "SupplierAccountMovement" m
             ON m."paymentId" = p."id" AND m."type" = 'PAYMENT'
     GROUP BY p."id", p."number", p."amount"
    HAVING count(m."id") <> 1
        OR COALESCE(sum(m."amount"), 0) <> -p."amount"
     ORDER BY p."number"
  `)

  const contraCaja = await buscar(`
    SELECT p."number"                                         AS numero,
           (-p."amount")::numeric(14,2)::text                  AS esperado,
           COALESCE(sum(cm."amount"), 0)::numeric(14,2)::text  AS "enCaja"
      FROM "SupplierPayment" p
      LEFT JOIN "CashRegisterMovement" cm ON cm."supplierPaymentId" = p."id"
     WHERE p."method" = 'CASH'
     GROUP BY p."id", p."number", p."amount"
    HAVING -p."amount" <> COALESCE(sum(cm."amount"), 0)
     ORDER BY p."number"
  `)

  const noEfectivoEnCaja = await buscar(`
    SELECT p."number" AS numero,
           p."method" AS medio
      FROM "SupplierPayment" p
     WHERE p."method" <> 'CASH'
       AND EXISTS (
         SELECT 1 FROM "CashRegisterMovement" cm WHERE cm."supplierPaymentId" = p."id"
       )
     ORDER BY p."number"
  `)

  return {
    nombre: 'Pagos a proveedores',
    revisadas,
    inconsistencias: [
      ...contraLibro.map((f): Inconsistencia => ({
        entidad: `Pago ${String(f.numero)}`,
        regla: 'todo pago deja un movimiento de cuenta por el mismo importe, en negativo',
        esperado: `-${String(f.pagado)} en 1 movimiento`,
        encontrado: `${String(f.movido)} en ${String(f.cuantos)}`,
        diferencia: null,
      })),
      ...contraCaja.map((f): Inconsistencia => ({
        entidad: `Pago ${String(f.numero)}`,
        regla: 'un pago en efectivo sale del cajon',
        esperado: String(f.esperado),
        encontrado: String(f.enCaja),
        diferencia: restar(String(f.enCaja), String(f.esperado)),
      })),
      ...noEfectivoEnCaja.map((f): Inconsistencia => ({
        entidad: `Pago ${String(f.numero)}`,
        regla: 'un pago que no es en efectivo NO sale del cajon',
        esperado: 'ningun movimiento de caja',
        encontrado: `movimiento de caja con medio ${String(f.medio)}`,
        diferencia: null,
      })),
    ],
  }
}

/**
 * Nadie imputa mas de lo que hay.
 *
 * Dos reglas, y ninguna es una IGUALDAD:
 *
 *   suma(imputaciones de un pago)       <=  el importe del pago
 *   suma(imputaciones de una recepcion) <=  el importe de la obligacion
 *
 * Que sean desigualdades es el punto: sobre-imputar es imposible, sub-imputar
 * es legitimo. Un pago puede quedar parcialmente sin imputar --un anticipo, o
 * plata que sobro despues de cubrir todo lo pendiente-- y eso no es un
 * descuadre: el saldo lo lleva el libro, no la imputacion. Ver
 * docs/SUPPLIER_PAYMENT_ALLOCATION.md.
 *
 * La segunda es la que cierra el cuarto caso de concurrencia del objetivo 34:
 * dos pagos simultaneos que juntos cancelaran dos veces el mismo importe
 * pendiente apareceria aca.
 */
export async function imputacionesContraSusTopes(): Promise<Comprobacion> {
  const revisadas = await contar('SELECT count(*)::bigint AS n FROM "SupplierPaymentAllocation"')

  const sobrePago = await buscar(`
    SELECT p."number"                                        AS numero,
           p."amount"::numeric(14,2)::text                    AS pago,
           COALESCE(sum(a."amount"), 0)::numeric(14,2)::text  AS imputado
      FROM "SupplierPayment" p
      JOIN "SupplierPaymentAllocation" a ON a."paymentId" = p."id"
     GROUP BY p."id", p."number", p."amount"
    HAVING sum(a."amount") > p."amount"
     ORDER BY p."number"
  `)

  // EL TOPE DE UNA ENTREGA ES SU IMPORTE ORIGINAL, NO EL NETO, y esa eleccion
  // es el objetivo 24 entero.
  //
  // La obligacion neta puede quedar por DEBAJO de lo ya imputado, y es
  // legitimo: una entrega de $100.000 que se pago entera y despues se devolvio
  // por $20.000 queda con $100.000 imputados sobre una obligacion neta de
  // $80.000. Las imputaciones no se mueven hacia atras --son inmutables-- y ese
  // exceso ES el credito a favor, que el libro ya refleja como saldo negativo.
  //
  // Y LA REGLA QUE PARECIA FALTAR NO FALTA: "el exceso sobre el neto tiene que
  // estar explicado por devoluciones, y no superarlas" es EXACTAMENTE esta misma
  // comprobacion escrita de otra forma. La cuenta lo dice en una linea:
  //
  //     exceso        = imputado - (total - devuelto)
  //     exceso > devuelto  <=>  imputado - total + devuelto > devuelto
  //                        <=>  imputado > total
  //
  // Escribirlas como dos reglas daria una que no puede fallar nunca --el mismo
  // codigo inalcanzable disfrazado de defensa que la Fase 4B tuvo que borrar del
  // pago-- y ademas informaria dos veces el mismo descuadre. Ver
  // docs/PURCHASE_RETURN_ACCOUNTING.md.
  const sobreObligacion = await buscar(`
    SELECT r."id"::text                                      AS id,
           o."number"                                        AS orden,
           r."total"::numeric(14,2)::text                     AS total,
           COALESCE(sum(a."amount"), 0)::numeric(14,2)::text  AS imputado
      FROM "PurchaseReceipt" r
      JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
      JOIN "SupplierPaymentAllocation" a ON a."receiptId" = r."id"
     GROUP BY r."id", o."number", r."total"
    HAVING sum(a."amount") > r."total"
     ORDER BY r."id"
  `)

  // Una imputacion contra una entrega que NUNCA entro al libro no significa
  // nada: seria plata aplicada a una obligacion que el sistema no reconoce.
  const sinObligacion = await buscar(`
    SELECT a."id"::text  AS id,
           p."number"    AS numero,
           r."id"::text  AS "receiptId"
      FROM "SupplierPaymentAllocation" a
      JOIN "SupplierPayment" p ON p."id" = a."paymentId"
      JOIN "PurchaseReceipt" r ON r."id" = a."receiptId"
     WHERE r."debtRecorded" = false
     ORDER BY a."id"
  `)

  return {
    nombre: 'Imputaciones',
    revisadas,
    inconsistencias: [
      ...sobrePago.map((f): Inconsistencia => ({
        entidad: `Pago ${String(f.numero)}`,
        regla: 'lo imputado no supera el importe del pago',
        esperado: `<= ${String(f.pago)}`,
        encontrado: String(f.imputado),
        diferencia: restar(String(f.imputado), String(f.pago)),
      })),
      ...sobreObligacion.map((f): Inconsistencia => ({
        entidad: `Recepción #${String(f.id)} — ${String(f.orden)}`,
        regla: 'lo imputado a una entrega no supera lo que costo',
        esperado: `<= ${String(f.total)}`,
        encontrado: String(f.imputado),
        diferencia: restar(String(f.imputado), String(f.total)),
      })),
      ...sinObligacion.map((f): Inconsistencia => ({
        entidad: `Imputación #${String(f.id)} — ${String(f.numero)}`,
        regla: 'toda imputacion apunta a una entrega que entro al libro',
        esperado: 'entrega con deuda registrada',
        encontrado: `recepción #${String(f.receiptId)} sin deuda registrada`,
        diferencia: null,
      })),
    ],
  }
}

// ===========================================================================
// Devoluciones a proveedor
// ===========================================================================

/**
 * Toda devolucion confirmada movio stock y emitio su credito.
 *
 * TRES reglas, y las tres son igualdades:
 *
 *   el importe de la devolucion  ==  suma de sus renglones
 *   lo que salio del deposito    ==  lo que la devolucion dice que sale
 *   el credito al proveedor      ==  el importe de la devolucion
 *
 * Es el equivalente de `recepcionesContraElStock` del otro lado del camion. Sin
 * la primera, un renglon editado por fuera del servicio dejaria un credito que
 * no corresponde a la mercaderia. Sin la segunda, una devolucion podria acreditar
 * plata sin que nada saliera del deposito. Sin la tercera, la mercaderia se iria
 * sin que el proveedor nos acredite nada.
 *
 * Solo mira las CONFIRMADAS: un borrador no tiene que haber movido nada, y una
 * cancelada tampoco.
 */
export async function devolucionesContraSusEfectos(): Promise<Comprobacion> {
  const revisadas = await contar(
    `SELECT count(*)::bigint AS n FROM "PurchaseReturn" WHERE "status" = 'CONFIRMED'`,
  )

  const importes = await buscar(`
    SELECT d."number"                                        AS numero,
           d."total"::numeric(14,2)::text                     AS anotado,
           COALESCE(sum(di."amount"), 0)::numeric(14,2)::text AS calculado
      FROM "PurchaseReturn" d
      LEFT JOIN "PurchaseReturnItem" di ON di."purchaseReturnId" = d."id"
     WHERE d."status" = 'CONFIRMED'
     GROUP BY d."id", d."number", d."total"
    HAVING d."total" <> COALESCE(sum(di."amount"), 0)
     ORDER BY d."number"
  `)

  // Por producto: una devolucion de tres renglones tiene tres movimientos, y
  // agrupar solo por devolucion dejaria pasar que dos de ellos se hayan cruzado.
  const stock = await buscar(`
    SELECT d."number"                        AS numero,
           p."name"                          AS producto,
           (-sum(di."stockQuantity"))::text  AS esperado,
           COALESCE((
             SELECT sum(m."quantity") FROM "StockMovement" m
              WHERE m."referenceType" = 'PurchaseReturn'
                AND m."referenceId" = d."id"
                AND m."productId" = di."productId"
                AND m."type" = 'PURCHASE_RETURN'
           ), 0)::text                       AS movido
      FROM "PurchaseReturn" d
      JOIN "PurchaseReturnItem" di ON di."purchaseReturnId" = d."id"
      JOIN "Product" p ON p."id" = di."productId"
     WHERE d."status" = 'CONFIRMED'
     GROUP BY d."id", d."number", p."name", di."productId"
    HAVING -sum(di."stockQuantity") <> COALESCE((
             SELECT sum(m."quantity") FROM "StockMovement" m
              WHERE m."referenceType" = 'PurchaseReturn'
                AND m."referenceId" = d."id"
                AND m."productId" = di."productId"
                AND m."type" = 'PURCHASE_RETURN'
           ), 0)
     ORDER BY d."number"
  `)

  const credito = await buscar(`
    SELECT d."number"                              AS numero,
           (-d."total")::numeric(14,2)::text        AS esperado,
           COALESCE((
             SELECT sum(m."amount") FROM "SupplierAccountMovement" m
              WHERE m."returnId" = d."id" AND m."type" = 'PURCHASE_CREDIT'
           ), 0)::numeric(14,2)::text              AS encontrado
      FROM "PurchaseReturn" d
     WHERE d."status" = 'CONFIRMED'
       AND -d."total" <> COALESCE((
             SELECT sum(m."amount") FROM "SupplierAccountMovement" m
              WHERE m."returnId" = d."id" AND m."type" = 'PURCHASE_CREDIT'
           ), 0)
     ORDER BY d."number"
  `)

  // Y al reves: un credito que apunta a una devolucion que NO esta confirmada
  // seria plata acreditada por mercaderia que nunca salio.
  const creditoSinDevolucion = await buscar(`
    SELECT m."id"::text  AS id,
           d."number"    AS numero,
           d."status"    AS estado
      FROM "SupplierAccountMovement" m
      JOIN "PurchaseReturn" d ON d."id" = m."returnId"
     WHERE d."status" <> 'CONFIRMED'
     ORDER BY m."id"
  `)

  return {
    nombre: 'Devoluciones',
    revisadas,
    inconsistencias: [
      ...importes.map((f): Inconsistencia => ({
        entidad: `Devolución ${String(f.numero)}`,
        regla: 'el importe es la suma de sus renglones',
        esperado: String(f.calculado),
        encontrado: String(f.anotado),
        diferencia: restar(String(f.anotado), String(f.calculado)),
      })),
      ...stock.map((f): Inconsistencia => ({
        entidad: `Devolución ${String(f.numero)} — ${String(f.producto)}`,
        regla: 'toda devolucion confirmada saco su mercaderia',
        esperado: String(f.esperado),
        encontrado: String(f.movido),
        diferencia: restar(String(f.movido), String(f.esperado)),
      })),
      ...credito.map((f): Inconsistencia => ({
        entidad: `Devolución ${String(f.numero)}`,
        regla: 'toda devolucion confirmada acredita al proveedor',
        esperado: String(f.esperado),
        encontrado: String(f.encontrado),
        diferencia: restar(String(f.encontrado), String(f.esperado)),
      })),
      ...creditoSinDevolucion.map((f): Inconsistencia => ({
        entidad: `Movimiento #${String(f.id)} — ${String(f.numero)}`,
        regla: 'un credito de devolucion viene de una devolucion confirmada',
        esperado: 'CONFIRMED',
        encontrado: String(f.estado),
        diferencia: null,
      })),
    ],
  }
}

/**
 * No se devolvio mas de lo que llego, ni a un costo distinto del que entro.
 *
 * La primera regla es una DESIGUALDAD: devolver menos de lo recibido es lo
 * normal, y devolver todo tambien. Lo que no puede pasar es devolver mas, que es
 * lo que aparece si dos confirmaciones simultaneas se pasaran el tope entre las
 * dos --el caso del objetivo 28--.
 *
 * La segunda es una IGUALDAD y es la del objetivo 10: el costo de cada renglon
 * tiene que ser el CONGELADO en la recepcion. Un renglon con el costo de hoy en
 * vez del original acreditaria plata que el proveedor nunca cobro, y ninguna otra
 * comprobacion lo notaria: los importes cerrarian entre si.
 */
export async function devolucionesContraLoRecibido(): Promise<Comprobacion> {
  const revisadas = await contar(`
    SELECT count(*)::bigint AS n
      FROM "PurchaseReturnItem" di
      JOIN "PurchaseReturn" d ON d."id" = di."purchaseReturnId"
     WHERE d."status" = 'CONFIRMED'
  `)

  const cantidades = await buscar(`
    SELECT ri."id"::text                   AS id,
           p."name"                        AS producto,
           ri."receivedQuantity"::text     AS recibido,
           sum(di."quantity")::text        AS devuelto
      FROM "PurchaseReceiptItem" ri
      JOIN "Product" p ON p."id" = ri."productId"
      JOIN "PurchaseReturnItem" di ON di."purchaseReceiptItemId" = ri."id"
      JOIN "PurchaseReturn" d ON d."id" = di."purchaseReturnId"
     WHERE d."status" = 'CONFIRMED'
     GROUP BY ri."id", p."name", ri."receivedQuantity"
    HAVING sum(di."quantity") > ri."receivedQuantity"
     ORDER BY ri."id"
  `)

  const costos = await buscar(`
    SELECT d."number"                      AS numero,
           p."name"                        AS producto,
           ri."unitCost"::text             AS original,
           di."unitCost"::text             AS usado
      FROM "PurchaseReturnItem" di
      JOIN "PurchaseReturn" d ON d."id" = di."purchaseReturnId"
      JOIN "PurchaseReceiptItem" ri ON ri."id" = di."purchaseReceiptItemId"
      JOIN "Product" p ON p."id" = di."productId"
     WHERE di."unitCost" <> ri."unitCost"
     ORDER BY d."number", p."name"
  `)

  return {
    nombre: 'Cantidades devueltas',
    revisadas,
    inconsistencias: [
      ...cantidades.map((f): Inconsistencia => ({
        entidad: `Recepción línea #${String(f.id)} — ${String(f.producto)}`,
        regla: 'no se devuelve mas de lo que llego',
        esperado: `<= ${String(f.recibido)}`,
        encontrado: String(f.devuelto),
        diferencia: restar(String(f.devuelto), String(f.recibido)),
      })),
      ...costos.map((f): Inconsistencia => ({
        entidad: `Devolución ${String(f.numero)} — ${String(f.producto)}`,
        regla: 'se devuelve al costo congelado en la recepcion',
        esperado: String(f.original),
        encontrado: String(f.usado),
        diferencia: restar(String(f.usado), String(f.original)),
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
  clientesContraSuLibro,
  ventasACuentaContraElLibro,
  pagosDeClientesContraElLibro,
  anulacionesContraLaCuenta,
  proveedoresContraSuLibro,
  recepcionesContraLaDeuda,
  pagosAProveedoresContraElLibro,
  imputacionesContraSusTopes,
  devolucionesContraSusEfectos,
  devolucionesContraLoRecibido,
]
