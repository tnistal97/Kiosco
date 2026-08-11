/**
 * Reportes operativos.
 *
 * Seis materias --ventas, rentabilidad, productos, inventario, compras y
 * caja-- y un permiso propio para cada grupo de informacion. No es una
 * pantalla con veinte graficos: son las preguntas que un almacen se hace y no
 * puede responder mirando el mostrador.
 *
 * TRES REGLAS QUE VALEN PARA TODO EL ARCHIVO:
 *
 *   1. AGREGA LA BASE. Ni una consulta trae filas para sumarlas en
 *      JavaScript. Un mes de ventas son miles de lineas y no tienen por que
 *      pasar por la memoria del servidor para dar un total.
 *
 *   2. LA RENTABILIDAD USA `costAtSale`. Nunca `Product.cost`. Calcular la
 *      ganancia de marzo con el costo de hoy da una cifra falsa con
 *      apariencia de dato. Ver docs/REPORTING_MODEL.md.
 *
 *   3. EL DIA LO DEFINE LA SUCURSAL. Todo rango pasa por `rangoDeSucursal`.
 *      Ver docs/TIMEZONE_POLICY.md.
 */

import { prisma } from '@/lib/prisma'
import type { Session } from '@/server/auth/session'
import { forbidden, invalid } from '@/server/http/errors'
import { cantidadDeDias, comoTimestampUTC, esFechaLocal, rangoDeSucursal } from '@/server/tiempo'
import type { Monto } from '@/lib/money'
import type { TextoCantidad } from '@/lib/cantidad'
import type { Permission } from '@/server/authz/permissions'
import { MEDIO_EFECTIVO, etiquetaDeMedio } from '@/modules/sales/payment-methods'
import { etiquetaDeTipo } from '@/modules/inventory/movement-types'
import type { RangoQuery } from './schemas'

/** Cuantos dias como maximo cubre un reporte. Un anio y un dia bisiesto. */
export const MAX_DIAS = 366

/** Cuantas filas devuelve un ranking. Suficiente para decidir, corto para leer. */
const TOPE_RANKING = 20

/**
 * Resuelve el rango y comprueba el permiso, en ese orden.
 *
 * Todo reporte empieza por aca: sin esto, cada uno tendria su propia forma de
 * interpretar las fechas, que es exactamente como aparecio el error de las
 * 21:00 de la Fase 3C.
 */
async function preparar(
  session: Session,
  query: RangoQuery,
  permiso: Permission,
): Promise<{ desde: string; hasta: string; branchId: number }> {
  if (!session.permissions.has(permiso)) {
    throw forbidden('No tiene permiso para ver este reporte')
  }
  if (!esFechaLocal(query.desde) || !esFechaLocal(query.hasta)) throw invalid('Fechas invalidas')
  if (query.desde > query.hasta) throw invalid('La fecha inicial es posterior a la final')
  if (cantidadDeDias(query.desde, query.hasta) > MAX_DIAS) {
    throw invalid(`El rango no puede superar ${String(MAX_DIAS)} dias`)
  }

  const { desde, hasta } = await rangoDeSucursal(prisma, session.branchId, query.desde, query.hasta)

  // Los bordes salen como TEXTO, no como `Date`, y las consultas los castean
  // con `::timestamp`. Es obligatorio: un `Date` viaja como `timestamptz` y
  // obliga a PostgreSQL a convertir la columna con la zona de la SESION, que
  // sale del sistema operativo del servidor de base de datos. Con la base en
  // Argentina, eso corre cada venta posterior a las 21:00 fuera de su propio
  // dia. Ver `comoTimestampUTC` y docs/TIMEZONE_POLICY.md.
  return {
    desde: comoTimestampUTC(desde),
    hasta: comoTimestampUTC(hasta),
    branchId: session.branchId,
  }
}

/** Las consultas devuelven texto: un `numeric` que pasa por `number` ya perdio. */
type Fila = Record<string, string | null>

async function filas(sql: string, ...valores: unknown[]): Promise<Fila[]> {
  return prisma.$queryRawUnsafe<Fila[]>(sql, ...valores)
}

const monto = (v: string | null | undefined): Monto => v ?? '0.00'
const cantidad = (v: string | null | undefined): TextoCantidad => v ?? '0.000'

// ===========================================================================
// Clientes y cuenta corriente
// ===========================================================================

export interface ReporteDeClientes {
  cartera: {
    /** Lo que el conjunto de clientes debe HOY. No es una ganancia. */
    saldoPendiente: Monto
    deudores: number
    deudaPromedio: Monto
    /** Lo que el comercio le debe a sus clientes: pagos de mas y anulaciones. */
    saldoAFavor: Monto
    conSaldoAFavor: number
    /** Cuantos estan por encima de su limite. Casi siempre por una autorizacion. */
    sobreLimite: number
  }
  /** Lo que pasa DENTRO del rango. Lo de arriba es una foto de hoy. */
  periodo: {
    ventasACuenta: Monto
    cuantasVentasACuenta: number
    cobrado: Monto
    cuantosCobros: number
    /** Cuanto de lo cobrado entro al cajon. El resto fue transferencia o tarjeta. */
    cobradoEnEfectivo: Monto
    ajustes: Monto
  }
  topDeudores: Array<{ cliente: string; saldo: Monto; limite: Monto | null }>
  cobrosPorMedio: Array<{ medio: string; etiqueta: string; cobrado: Monto; cuantos: number }>
}

/**
 * La cartera de clientes y el movimiento de cuenta corriente del rango.
 *
 * DOS COSAS QUE ESTE REPORTE NO HACE, y las dos son deliberadas:
 *
 *   1. NO LLAMA GANANCIA A LA DEUDA. `saldoPendiente` es lo que falta cobrar,
 *      no lo que se gano. Una venta fiada ya figura en el reporte de ventas
 *      como facturacion y en el de rentabilidad como margen; sumarla de nuevo
 *      aca la contaria dos veces. Lo que este reporte agrega es la pregunta que
 *      los otros dos no responden: cuanto de eso todavia no entro.
 *
 *   2. NO MEZCLA LA FOTO CON LA PELICULA. `cartera` es el estado de HOY --los
 *      saldos son acumulados y no tienen fecha-- y `periodo` es lo que ocurrio
 *      dentro del rango. Mostrarlos juntos sin distinguirlos haria pensar que
 *      la deuda se genero toda en esos dias.
 *
 * Ver docs/REPORTING_MODEL.md.
 */
export async function reporteDeClientes(
  session: Session,
  query: RangoQuery,
): Promise<ReporteDeClientes> {
  const { desde, hasta, branchId } = await preparar(session, query, 'reports.clients.view')

  const [cartera, periodo, deudores, medios] = await Promise.all([
    filas(
      `SELECT
         COALESCE(sum("balance") FILTER (WHERE "balance" > 0), 0)::numeric(14,2)::text AS deuda,
         count(*) FILTER (WHERE "balance" > 0)::text                                   AS deudores,
         COALESCE(-sum("balance") FILTER (WHERE "balance" < 0), 0)::numeric(14,2)::text AS "aFavor",
         count(*) FILTER (WHERE "balance" < 0)::text                                   AS "conAFavor",
         count(*) FILTER (
           WHERE "creditLimit" IS NOT NULL AND "balance" > "creditLimit"
         )::text                                                                       AS "sobreLimite"
       FROM "Client" WHERE "branchId" = $1`,
      branchId,
    ),
    // Todo el movimiento del rango en UNA consulta agregada por tipo. Cuatro
    // agregados separados serian cuatro recorridas de la misma tabla.
    filas(
      `SELECT
         COALESCE(sum("amount") FILTER (WHERE "type" = 'SALE_CHARGE'), 0)::numeric(14,2)::text AS fiado,
         count(*) FILTER (WHERE "type" = 'SALE_CHARGE')::text                     AS "cuantasFiadas",
         COALESCE(-sum("amount") FILTER (WHERE "type" = 'PAYMENT'), 0)::numeric(14,2)::text    AS cobrado,
         count(*) FILTER (WHERE "type" = 'PAYMENT')::text                         AS "cuantosCobros",
         COALESCE(sum("amount") FILTER (WHERE "type" = 'MANUAL_ADJUSTMENT'), 0)::numeric(14,2)::text AS ajustes,
         COALESCE((
           SELECT sum(p."amount") FROM "CustomerPayment" p
            WHERE p."branchId" = $1 AND p."createdAt" >= $2::timestamp AND p."createdAt" <= $3::timestamp
              AND p."method" = 'CASH'
         ), 0)::numeric(14,2)::text                                               AS "enEfectivo"
       FROM "CustomerAccountMovement"
       WHERE "branchId" = $1 AND "createdAt" >= $2::timestamp AND "createdAt" <= $3::timestamp`,
      branchId,
      desde,
      hasta,
    ),
    filas(
      `SELECT "name"                        AS cliente,
              "balance"::numeric(14,2)::text AS saldo,
              "creditLimit"::numeric(14,2)::text AS limite
         FROM "Client"
        WHERE "branchId" = $1 AND "balance" > 0
        ORDER BY "balance" DESC
        LIMIT ${String(TOPE_RANKING)}`,
      branchId,
    ),
    filas(
      `SELECT "method"                            AS medio,
              sum("amount")::numeric(14,2)::text  AS cobrado,
              count(*)::text                      AS cuantos
         FROM "CustomerPayment"
        WHERE "branchId" = $1 AND "createdAt" >= $2::timestamp AND "createdAt" <= $3::timestamp
        GROUP BY "method" ORDER BY sum("amount") DESC`,
      branchId,
      desde,
      hasta,
    ),
  ])

  const c = cartera[0] ?? {}
  const p = periodo[0] ?? {}
  const cuantosDeudores = Number(c.deudores ?? '0')

  return {
    cartera: {
      saldoPendiente: monto(c.deuda),
      deudores: cuantosDeudores,
      // El promedio se calcula sobre los que DEBEN, no sobre todos los
      // clientes: dividir por el padron entero daria un numero que baja cada
      // vez que se carga un cliente nuevo, y eso no significa nada.
      deudaPromedio:
        cuantosDeudores === 0 ? '0.00' : (Number(c.deuda ?? '0') / cuantosDeudores).toFixed(2),
      saldoAFavor: monto(c.aFavor),
      conSaldoAFavor: Number(c.conAFavor ?? '0'),
      sobreLimite: Number(c.sobreLimite ?? '0'),
    },
    periodo: {
      ventasACuenta: monto(p.fiado),
      cuantasVentasACuenta: Number(p.cuantasFiadas ?? '0'),
      cobrado: monto(p.cobrado),
      cuantosCobros: Number(p.cuantosCobros ?? '0'),
      cobradoEnEfectivo: monto(p.enEfectivo),
      ajustes: monto(p.ajustes),
    },
    topDeudores: deudores.map((f) => ({
      cliente: f.cliente ?? '—',
      saldo: monto(f.saldo),
      // `null` significa "sin limite configurado", y viaja tal cual: no se
      // reemplaza por cero, que es la afirmacion contraria.
      limite: f.limite ?? null,
    })),
    cobrosPorMedio: medios.map((f) => ({
      medio: f.medio ?? '—',
      etiqueta: etiquetaDeMedio(f.medio ?? ''),
      cobrado: monto(f.cobrado),
      cuantos: Number(f.cuantos ?? '0'),
    })),
  }
}

// ===========================================================================
// Ventas
// ===========================================================================

export interface ReporteDeVentas {
  totales: {
    facturado: Monto
    operaciones: number
    ticketPromedio: Monto
    anuladas: number
    facturadoAnulado: Monto
  }
  porDia: Array<{ dia: string; facturado: Monto; operaciones: number }>
  porCajero: Array<{ usuario: string; facturado: Monto; operaciones: number }>
  porMedio: Array<{ medio: string; etiqueta: string; cobrado: Monto; operaciones: number }>
}

/**
 * Ventas del rango: cuanto, cuantas, quien y como cobraron.
 *
 * Las anuladas se cuentan aparte y NO suman al facturado: una venta anulada no
 * es facturacion, es un error corregido. Verlas es util --muchas anulaciones
 * en un turno es una senial-- pero mezclarlas seria mentir.
 *
 * `porDia` agrupa por el dia COMERCIAL, convirtiendo el instante a la zona de
 * la sucursal dentro de la propia consulta. Agrupar por la fecha UTC pondria
 * las ventas de despues de las 21:00 en el dia siguiente, que es el error
 * original de la Fase 3C escrito en SQL.
 */
export async function reporteDeVentas(
  session: Session,
  query: RangoQuery,
): Promise<ReporteDeVentas> {
  const { desde, hasta, branchId } = await preparar(session, query, 'reports.sales.view')
  const zona = (
    await prisma.branch.findUniqueOrThrow({
      where: { id: branchId },
      select: { timeZone: true },
    })
  ).timeZone

  const [resumen, porDia, porCajero, porMedio] = await Promise.all([
    filas(
      `SELECT
         COALESCE(sum("total") FILTER (WHERE "status" = 'completed'), 0)::numeric(14,2)::text AS facturado,
         count(*) FILTER (WHERE "status" = 'completed')::text                  AS operaciones,
         count(*) FILTER (WHERE "status" = 'canceled')::text                   AS anuladas,
         COALESCE(sum("total") FILTER (WHERE "status" = 'canceled'), 0)::numeric(14,2)::text  AS anulado
       FROM "Sale"
       WHERE "branchId" = $1 AND "date" >= $2::timestamp AND "date" <= $3::timestamp`,
      branchId,
      desde,
      hasta,
    ),
    filas(
      `SELECT to_char(("date" AT TIME ZONE 'UTC' AT TIME ZONE $4), 'YYYY-MM-DD') AS dia,
              sum("total")::numeric(14,2)::text                                  AS facturado,
              count(*)::text                                                     AS operaciones
         FROM "Sale"
        WHERE "branchId" = $1 AND "date" >= $2::timestamp AND "date" <= $3::timestamp AND "status" = 'completed'
        GROUP BY 1 ORDER BY 1`,
      branchId,
      desde,
      hasta,
      zona,
    ),
    filas(
      `SELECT u."name"          AS usuario,
              sum(s."total")::numeric(14,2)::text AS facturado,
              count(*)::text       AS operaciones
         FROM "Sale" s JOIN "User" u ON u."id" = s."userId"
        WHERE s."branchId" = $1 AND s."date" >= $2::timestamp AND s."date" <= $3::timestamp AND s."status" = 'completed'
        GROUP BY u."name" ORDER BY sum(s."total") DESC`,
      branchId,
      desde,
      hasta,
    ),
    filas(
      `SELECT p."method"         AS medio,
              sum(p."amount")::numeric(14,2)::text AS cobrado,
              count(*)::text        AS operaciones
         FROM "SalePayment" p JOIN "Sale" s ON s."id" = p."saleId"
        WHERE s."branchId" = $1 AND s."date" >= $2::timestamp AND s."date" <= $3::timestamp AND s."status" = 'completed'
        GROUP BY p."method" ORDER BY sum(p."amount") DESC`,
      branchId,
      desde,
      hasta,
    ),
  ])

  const r = resumen[0]
  const operaciones = Number(r?.operaciones ?? 0)
  const facturado = monto(r?.facturado ?? null)

  return {
    totales: {
      facturado,
      operaciones,
      // El ticket promedio con cero operaciones es CERO y no un error de
      // division: no hubo ventas, no hubo ticket.
      ticketPromedio: operaciones === 0 ? '0.00' : (Number(facturado) / operaciones).toFixed(2),
      anuladas: Number(r?.anuladas ?? 0),
      facturadoAnulado: monto(r?.anulado ?? null),
    },
    porDia: porDia.map((f) => ({
      dia: f.dia ?? '',
      facturado: monto(f.facturado),
      operaciones: Number(f.operaciones ?? 0),
    })),
    porCajero: porCajero.map((f) => ({
      usuario: f.usuario ?? '',
      facturado: monto(f.facturado),
      operaciones: Number(f.operaciones ?? 0),
    })),
    porMedio: porMedio.map((f) => ({
      medio: f.medio ?? '',
      etiqueta: etiquetaDeMedio(f.medio ?? ''),
      cobrado: monto(f.cobrado),
      operaciones: Number(f.operaciones ?? 0),
    })),
  }
}

// ===========================================================================
// Rentabilidad
// ===========================================================================

export interface ReporteDeRentabilidad {
  facturado: Monto
  costoVendido: Monto
  gananciaBruta: Monto
  /** Porcentaje sobre la facturacion. `null` si no se facturo nada. */
  margenBruto: string | null
  /** Lineas cuyo costo no se conocia. La cifra de arriba NO las incluye. */
  lineasSinCosto: number
  lineasTotales: number
  /** Cuanto se facturo en esas lineas, para saber que porcion queda afuera. */
  facturadoSinCosto: Monto
  porProducto: Array<{
    producto: string
    facturado: Monto
    costo: Monto
    ganancia: Monto
    margen: string | null
    lineasSinCosto: number
  }>
}

/**
 * Rentabilidad del rango, con el costo CONGELADO en cada venta.
 *
 * La honestidad de este reporte esta en lo que deja afuera. Una linea sin
 * `costAtSale` --producto sin costo cargado, venta anterior a la Fase 3D-- no
 * entra en el costo vendido NI en la facturacion que se le compara, y se
 * informa cuantas fueron y cuanto facturaron. La alternativa seria contarlas
 * con costo cero, que las mostraria como el producto mas rentable del local.
 */
export async function reporteDeRentabilidad(
  session: Session,
  query: RangoQuery,
): Promise<ReporteDeRentabilidad> {
  const { desde, hasta, branchId } = await preparar(session, query, 'reports.costs.view')

  const [resumen, porProducto] = await Promise.all([
    filas(
      `SELECT
         COALESCE(sum(round(i."price" * i."quantity", 2))
                  FILTER (WHERE i."costAtSale" IS NOT NULL), 0)::numeric(14,2)::text   AS facturado,
         COALESCE(sum(round(i."costAtSale" * i."quantity", 2)), 0)::numeric(14,2)::text AS costo,
         count(*) FILTER (WHERE i."costAtSale" IS NULL)::text            AS "sinCosto",
         count(*)::text                                                  AS total,
         COALESCE(sum(round(i."price" * i."quantity", 2))
                  FILTER (WHERE i."costAtSale" IS NULL), 0)::numeric(14,2)::text        AS "facturadoSinCosto"
       FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId"
       WHERE s."branchId" = $1 AND s."date" >= $2::timestamp AND s."date" <= $3::timestamp AND s."status" = 'completed'`,
      branchId,
      desde,
      hasta,
    ),
    filas(
      `SELECT p."name"                                                    AS producto,
              COALESCE(sum(round(i."price" * i."quantity", 2))
                       FILTER (WHERE i."costAtSale" IS NOT NULL), 0)::numeric(14,2)::text AS facturado,
              COALESCE(sum(round(i."costAtSale" * i."quantity", 2)), 0)::numeric(14,2)::text AS costo,
              count(*) FILTER (WHERE i."costAtSale" IS NULL)::text        AS "sinCosto"
         FROM "SaleItem" i
         JOIN "Sale" s ON s."id" = i."saleId"
         JOIN "Product" p ON p."id" = i."productId"
        WHERE s."branchId" = $1 AND s."date" >= $2::timestamp AND s."date" <= $3::timestamp AND s."status" = 'completed'
        GROUP BY p."name"
        ORDER BY (COALESCE(sum(round(i."price" * i."quantity", 2))
                           FILTER (WHERE i."costAtSale" IS NOT NULL), 0)
                  - COALESCE(sum(round(i."costAtSale" * i."quantity", 2)), 0)) DESC
        LIMIT ${String(TOPE_RANKING)}`,
      branchId,
      desde,
      hasta,
    ),
  ])

  const r = resumen[0]
  const facturado = monto(r?.facturado ?? null)
  const costo = monto(r?.costo ?? null)
  const ganancia = (Number(facturado) - Number(costo)).toFixed(2)

  return {
    facturado,
    costoVendido: costo,
    gananciaBruta: ganancia,
    margenBruto: porcentaje(ganancia, facturado),
    lineasSinCosto: Number(r?.sinCosto ?? 0),
    lineasTotales: Number(r?.total ?? 0),
    facturadoSinCosto: monto(r?.facturadoSinCosto ?? null),
    porProducto: porProducto.map((f) => {
      const fact = monto(f.facturado)
      const cst = monto(f.costo)
      const gan = (Number(fact) - Number(cst)).toFixed(2)
      return {
        producto: f.producto ?? '',
        facturado: fact,
        costo: cst,
        ganancia: gan,
        margen: porcentaje(gan, fact),
        lineasSinCosto: Number(f.sinCosto ?? 0),
      }
    }),
  }
}

/** `parte / total` en porcentaje con un decimal. `null` cuando el total es cero. */
function porcentaje(parte: string, total: string): string | null {
  const t = Number(total)
  if (!Number.isFinite(t) || t === 0) return null
  return ((Number(parte) / t) * 100).toFixed(1)
}

// ===========================================================================
// Productos
// ===========================================================================

export interface ReporteDeProductos {
  masVendidos: Array<{ producto: string; unidades: TextoCantidad; facturado: Monto }>
  menosVendidos: Array<{ producto: string; unidades: TextoCantidad; facturado: Monto }>
  /** Del catalogo activo, los que no se vendieron ni una vez en el rango. */
  sinVentas: number
}

export async function reporteDeProductos(
  session: Session,
  query: RangoQuery,
): Promise<ReporteDeProductos> {
  const { desde, hasta, branchId } = await preparar(session, query, 'reports.sales.view')

  const vendidos = `
    SELECT p."name"                                        AS producto,
           sum(i."quantity")::numeric(14,3)::text          AS unidades,
           sum(round(i."price" * i."quantity", 2))::numeric(14,2)::text AS facturado
      FROM "SaleItem" i
      JOIN "Sale" s ON s."id" = i."saleId"
      JOIN "Product" p ON p."id" = i."productId"
     WHERE s."branchId" = $1 AND s."date" >= $2::timestamp AND s."date" <= $3::timestamp AND s."status" = 'completed'
     GROUP BY p."name"`

  const [mas, menos, sinVentas] = await Promise.all([
    filas(`${vendidos} ORDER BY sum(i."quantity") DESC LIMIT ${String(TOPE_RANKING)}`, branchId, desde, hasta), // prettier-ignore
    filas(`${vendidos} ORDER BY sum(i."quantity") ASC LIMIT ${String(TOPE_RANKING)}`, branchId, desde, hasta), // prettier-ignore
    filas(
      `SELECT count(*)::text AS n
         FROM "Product" p
        WHERE p."branchId" = $1 AND p."isActive"
          AND NOT EXISTS (
            SELECT 1 FROM "SaleItem" i JOIN "Sale" s ON s."id" = i."saleId"
             WHERE i."productId" = p."id" AND s."date" >= $2::timestamp AND s."date" <= $3::timestamp
               AND s."status" = 'completed'
          )`,
      branchId,
      desde,
      hasta,
    ),
  ])

  const aLista = (fs: Fila[]) =>
    fs.map((f) => ({
      producto: f.producto ?? '',
      unidades: cantidad(f.unidades),
      facturado: monto(f.facturado),
    }))

  return {
    masVendidos: aLista(mas),
    menosVendidos: aLista(menos),
    sinVentas: Number(sinVentas[0]?.n ?? 0),
  }
}

// ===========================================================================
// Inventario
// ===========================================================================

export interface ReporteDeInventario {
  productos: number
  agotados: number
  bajoMinimo: number
  sinCosto: number
  /** Solo con `reports.costs.view`. Stock x costo ACTUAL, no historico. */
  valorizado: Monto | null
  /** Cuanto stock no entra en la valorizacion por no tener costo. */
  productosSinValorizar: number | null
  movimientosPorTipo: Array<{ tipo: string; etiqueta: string; cuantos: number }>
}

/**
 * Estado del inventario. La valorizacion, solo con permiso de costos.
 *
 * La valorizacion usa el costo ACTUAL y no el historico, y esta bien que asi
 * sea: la pregunta es "cuanto vale reponer lo que tengo hoy", no "cuanto pague
 * por ello". Es la unica cifra del sistema que usa `Product.cost` a
 * proposito, y por eso lleva su explicacion al lado.
 */
export async function reporteDeInventario(
  session: Session,
  query: RangoQuery,
): Promise<ReporteDeInventario> {
  const { desde, hasta, branchId } = await preparar(session, query, 'reports.inventory.view')
  const verCostos = session.permissions.has('reports.costs.view')

  const [resumen, valor, movimientos] = await Promise.all([
    filas(
      `SELECT count(*)::text                                            AS productos,
              count(*) FILTER (WHERE bs."quantity" <= 0)::text          AS agotados,
              count(*) FILTER (WHERE bs."quantity" > 0
                               AND bs."quantity" <= p."minimumStock")::text AS bajos,
              count(*) FILTER (WHERE p."cost" IS NULL)::text            AS "sinCosto"
         FROM "Product" p
         LEFT JOIN "BranchStock" bs ON bs."productId" = p."id" AND bs."branchId" = p."branchId"
        WHERE p."branchId" = $1 AND p."isActive"`,
      branchId,
    ),
    verCostos
      ? filas(
          `SELECT COALESCE(sum(round(bs."quantity" * p."cost", 2)), 0)::numeric(14,2)::text AS valor,
                  count(*) FILTER (WHERE p."cost" IS NULL AND bs."quantity" > 0)::text AS "sinValor"
             FROM "Product" p
             JOIN "BranchStock" bs ON bs."productId" = p."id" AND bs."branchId" = p."branchId"
            WHERE p."branchId" = $1 AND p."isActive"`,
          branchId,
        )
      : Promise.resolve<Fila[]>([]),
    filas(
      `SELECT "type" AS tipo, count(*)::text AS cuantos
         FROM "StockMovement"
        WHERE "branchId" = $1 AND "createdAt" >= $2::timestamp AND "createdAt" <= $3::timestamp
        GROUP BY "type" ORDER BY count(*) DESC`,
      branchId,
      desde,
      hasta,
    ),
  ])

  const r = resumen[0]
  return {
    productos: Number(r?.productos ?? 0),
    agotados: Number(r?.agotados ?? 0),
    bajoMinimo: Number(r?.bajos ?? 0),
    sinCosto: Number(r?.sinCosto ?? 0),
    valorizado: verCostos ? monto(valor[0]?.valor ?? null) : null,
    productosSinValorizar: verCostos ? Number(valor[0]?.sinValor ?? 0) : null,
    movimientosPorTipo: movimientos.map((f) => ({
      tipo: f.tipo ?? '',
      etiqueta: etiquetaDeTipo(f.tipo ?? ''),
      cuantos: Number(f.cuantos ?? 0),
    })),
  }
}

// ===========================================================================
// Compras
// ===========================================================================

export interface ReporteDeCompras {
  ordenes: number
  recepciones: number
  totalComprado: Monto
  porProveedor: Array<{ proveedor: string; ordenes: number; total: Monto }>
  diferenciasDeCosto: Array<{
    orden: string
    producto: string
    esperado: Monto
    recibido: Monto
    diferencia: Monto
  }>
}

/**
 * Compras del rango, medidas por lo que LLEGO y no por lo que se pidio.
 *
 * `totalComprado` suma recepciones: una orden confirmada que nunca llego no
 * es una compra, es una promesa. Las diferencias entre el costo pedido y el
 * recibido se listan enteras --no un resumen-- porque cada una es una
 * conversacion pendiente con un proveedor.
 */
export async function reporteDeCompras(
  session: Session,
  query: RangoQuery,
): Promise<ReporteDeCompras> {
  const { desde, hasta, branchId } = await preparar(session, query, 'reports.purchases.view')

  const [resumen, porProveedor, diferencias] = await Promise.all([
    filas(
      `SELECT
         (SELECT count(*) FROM "PurchaseOrder"
           WHERE "branchId" = $1 AND "createdAt" >= $2::timestamp AND "createdAt" <= $3::timestamp)::text AS ordenes,
         (SELECT count(*) FROM "PurchaseReceipt"
           WHERE "branchId" = $1 AND "receivedAt" >= $2::timestamp AND "receivedAt" <= $3::timestamp)::text AS recepciones,
         (SELECT COALESCE(sum(round(ri."receivedQuantity" * ri."unitCost", 2)), 0)
            FROM "PurchaseReceiptItem" ri
            JOIN "PurchaseReceipt" r ON r."id" = ri."purchaseReceiptId"
           WHERE r."branchId" = $1 AND r."receivedAt" >= $2::timestamp AND r."receivedAt" <= $3::timestamp)::numeric(14,2)::text AS total`,
      branchId,
      desde,
      hasta,
    ),
    filas(
      `SELECT sup."name"            AS proveedor,
              count(DISTINCT o."id")::text AS ordenes,
              COALESCE(sum(round(ri."receivedQuantity" * ri."unitCost", 2)), 0)::numeric(14,2)::text AS total
         FROM "PurchaseReceipt" r
         JOIN "PurchaseReceiptItem" ri ON ri."purchaseReceiptId" = r."id"
         JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
         JOIN "Supplier" sup ON sup."id" = o."supplierId"
        WHERE r."branchId" = $1 AND r."receivedAt" >= $2::timestamp AND r."receivedAt" <= $3::timestamp
        GROUP BY sup."name" ORDER BY 3 DESC`,
      branchId,
      desde,
      hasta,
    ),
    filas(
      `SELECT o."number"                                        AS orden,
              p."name"                                          AS producto,
              ri."expectedUnitCost"::numeric(14,2)::text        AS esperado,
              ri."unitCost"::numeric(14,2)::text                AS recibido,
              (ri."unitCost" - ri."expectedUnitCost")::numeric(14,2)::text AS diferencia
         FROM "PurchaseReceiptItem" ri
         JOIN "PurchaseReceipt" r ON r."id" = ri."purchaseReceiptId"
         JOIN "PurchaseOrder" o ON o."id" = r."purchaseOrderId"
         JOIN "Product" p ON p."id" = ri."productId"
        WHERE r."branchId" = $1 AND r."receivedAt" >= $2::timestamp AND r."receivedAt" <= $3::timestamp
          AND ri."unitCost" <> ri."expectedUnitCost"
        ORDER BY abs(ri."unitCost" - ri."expectedUnitCost") DESC
        LIMIT ${String(TOPE_RANKING)}`,
      branchId,
      desde,
      hasta,
    ),
  ])

  const r = resumen[0]
  return {
    ordenes: Number(r?.ordenes ?? 0),
    recepciones: Number(r?.recepciones ?? 0),
    totalComprado: monto(r?.total ?? null),
    porProveedor: porProveedor.map((f) => ({
      proveedor: f.proveedor ?? '',
      ordenes: Number(f.ordenes ?? 0),
      total: monto(f.total),
    })),
    diferenciasDeCosto: diferencias.map((f) => ({
      orden: f.orden ?? '',
      producto: f.producto ?? '',
      esperado: monto(f.esperado),
      recibido: monto(f.recibido),
      diferencia: monto(f.diferencia),
    })),
  }
}

// ===========================================================================
// Caja
// ===========================================================================

export interface ReporteDeCaja {
  turnos: number
  turnosConDiferencia: number
  sobrantes: Monto
  faltantes: Monto
  ingresos: Monto
  egresos: Monto
  retiros: Monto
  ventasEnEfectivo: Monto
  detalle: Array<{
    turno: number
    abierto: string
    cerradoPor: string | null
    esperado: Monto | null
    contado: Monto | null
    diferencia: Monto | null
  }>
}

/**
 * Turnos del rango y sus diferencias.
 *
 * Sobrantes y faltantes se informan por separado y no como un neto: un turno
 * que sobro $500 y otro que falto $500 no son un cero, son dos problemas.
 */
export async function reporteDeCaja(session: Session, query: RangoQuery): Promise<ReporteDeCaja> {
  const { desde, hasta, branchId } = await preparar(session, query, 'reports.cash.view')

  const [resumen, movimientos, detalle] = await Promise.all([
    filas(
      `SELECT count(*)::text                                                     AS turnos,
              count(*) FILTER (WHERE "difference" <> 0)::text                    AS "conDiferencia",
              COALESCE(sum("difference") FILTER (WHERE "difference" > 0), 0)::numeric(14,2)::text AS sobrantes,
              COALESCE(sum("difference") FILTER (WHERE "difference" < 0), 0)::numeric(14,2)::text AS faltantes
         FROM "CashShift"
        WHERE "branchId" = $1 AND "status" = 'closed'
          AND "openedAt" >= $2::timestamp AND "openedAt" <= $3::timestamp`,
      branchId,
      desde,
      hasta,
    ),
    filas(
      `SELECT
         COALESCE(sum("amount") FILTER (WHERE "type" = 'ingreso'), 0)::numeric(14,2)::text  AS ingresos,
         COALESCE(sum("amount") FILTER (WHERE "type" = 'egreso'), 0)::numeric(14,2)::text   AS egresos,
         COALESCE(sum("amount") FILTER (WHERE "type" = 'retiro'), 0)::numeric(14,2)::text   AS retiros,
         COALESCE(sum("amount") FILTER (WHERE "type" = 'sale'), 0)::numeric(14,2)::text     AS ventas
       FROM "CashRegisterMovement"
       WHERE "branchId" = $1 AND "date" >= $2::timestamp AND "date" <= $3::timestamp
         AND "paymentMethod" = $4`,
      branchId,
      desde,
      hasta,
      MEDIO_EFECTIVO,
    ),
    filas(
      `SELECT sh."id"::text                AS turno,
              sh."openedAt"::text          AS abierto,
              u."name"                     AS cerrado,
              sh."expectedAmount"::numeric(14,2)::text AS esperado,
              sh."countedAmount"::numeric(14,2)::text  AS contado,
              sh."difference"::numeric(14,2)::text     AS diferencia
         FROM "CashShift" sh
         LEFT JOIN "User" u ON u."id" = sh."closedById"
        WHERE sh."branchId" = $1 AND sh."openedAt" >= $2::timestamp AND sh."openedAt" <= $3::timestamp
          AND sh."status" <> 'legacy'
        ORDER BY sh."openedAt" DESC LIMIT ${String(TOPE_RANKING * 2)}`,
      branchId,
      desde,
      hasta,
    ),
  ])

  const r = resumen[0]
  const m = movimientos[0]
  return {
    turnos: Number(r?.turnos ?? 0),
    turnosConDiferencia: Number(r?.conDiferencia ?? 0),
    sobrantes: monto(r?.sobrantes ?? null),
    faltantes: monto(r?.faltantes ?? null),
    ingresos: monto(m?.ingresos ?? null),
    egresos: monto(m?.egresos ?? null),
    retiros: monto(m?.retiros ?? null),
    ventasEnEfectivo: monto(m?.ventas ?? null),
    detalle: detalle.map((f) => ({
      turno: Number(f.turno ?? 0),
      abierto: f.abierto ?? '',
      cerradoPor: f.cerrado ?? null,
      esperado: f.esperado === null ? null : monto(f.esperado),
      contado: f.contado === null ? null : monto(f.contado),
      diferencia: f.diferencia === null ? null : monto(f.diferencia),
    })),
  }
}
