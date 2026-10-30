/**
 * Saca las ventas y las cajas de prueba de un local que empieza a operar, y le
 * deja la caja en $0.
 *
 * No destruye nada: antes de sacar las filas las copia al esquema
 * `archivo_pruebas`, en la misma base. Para volver atras alcanza con esas
 * tablas, y antes de correr esto en produccion hay un respaldo.
 *
 * Lo que se saca: ventas, sus lineas y pagos, los movimientos de caja, los
 * arqueos y los turnos.
 *
 * Lo que NO se toca:
 *   - El stock. El libro (`StockMovement`) es inmutable y explica el saldo de
 *     cada producto, asi que sus movimientos de venta se quedan. Son de
 *     productos de demostracion dados de baja.
 *   - La bitacora, los clientes y los productos.
 *   - Las secuencias: la primera venta real sigue el numero que venia. Si
 *     volviera a 1, se confundiria con las referencias que quedan en el libro.
 *
 * Se niega a trabajar si algo no es lo que dice el manifiesto: una venta o un
 * turno que no esta en la lista, una venta de un producto activo (no es de
 * prueba), un fiado o una partida de lote. La lista la arma quien reviso los
 * datos; este guion solo comprueba que siga siendo verdad.
 *
 * Se aplica UNA vez: la entrada de la bitacora lleva la `marca`. `aplicar: false`
 * hace todo, comprueba y deshace: el esquema de archivo tambien, porque en
 * PostgreSQL crear tablas es parte de la transaccion.
 */
import type { Prisma, PrismaClient } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { normalizeUsername } from '@/modules/users/username'

export const ORIGEN = 'scripts/limpiar-pruebas'
export const ESQUEMA = 'archivo_pruebas'

/** La de la importacion de planillas: no corre a la vez que una carga. */
const LLAVE_DE_IMPORTACION = 7301

export interface OpcionesDeLimpieza {
  sucursal: number
  autor: number
  marca: string
  /** Las ventas de prueba, una por una. */
  ventas: readonly number[]
  /** Los turnos de caja de prueba, uno por uno. */
  turnos: readonly number[]
  /** Quien va a usar la caja nueva: el local queda operativo a su nombre. */
  responsable: string
  /** false: hace todo, comprueba y deshace. */
  aplicar: boolean
}

export interface ResultadoDeLimpieza {
  ventas: number
  lineas: number
  pagos: number
  movimientosDeCaja: number
  arqueos: number
  turnos: number
  efectivoAcumuladoAntes: string
  turnoNuevo: number | null
  aplicado: boolean
  yaAplicada: { id: number; timestamp: Date } | null
}

class Ensayo extends Error {
  constructor(readonly resultado: ResultadoDeLimpieza) {
    super('ensayo: se deshace')
  }
}

function enteros(ids: readonly number[]): string {
  if (!ids.every((i) => Number.isInteger(i))) throw new Error('La lista trae algo que no es un id')
  return `ARRAY[${ids.join(',')}]::int[]`
}

async function huellaDelStock(tx: Prisma.TransactionClient): Promise<string> {
  const [fila] = await tx.$queryRaw<Array<{ huella: string }>>`
    SELECT md5(string_agg("branchId" || '|' || "productId" || '|' || quantity::text, E'\n'
             ORDER BY "branchId", "productId")) AS huella
    FROM "BranchStock"
  `
  return fila?.huella ?? ''
}

function iguales(a: readonly number[], b: readonly number[]): boolean {
  return [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join()
}

export async function limpiarPruebas(
  db: PrismaClient,
  opciones: OpcionesDeLimpieza,
): Promise<ResultadoDeLimpieza> {
  const { sucursal, marca, ventas, turnos } = opciones
  try {
    return await db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LLAVE_DE_IMPORTACION}::int, ${sucursal}::int)`

        const ya = await tx.auditLog.findFirst({
          where: {
            branchId: sucursal,
            tableName: 'Sale',
            actionType: 'delete',
            changes: { path: ['after', 'limpieza'], equals: marca },
          },
          select: { id: true, timestamp: true },
        })
        if (ya) {
          return {
            ventas: 0,
            lineas: 0,
            pagos: 0,
            movimientosDeCaja: 0,
            arqueos: 0,
            turnos: 0,
            efectivoAcumuladoAntes: '0',
            turnoNuevo: null,
            aplicado: false,
            yaAplicada: ya,
          }
        }

        const autor = await tx.user.findFirst({
          where: {
            id: opciones.autor,
            isActive: true,
            role: { name: { in: ['admin', 'duenio'] } },
          },
          select: { id: true },
        })
        if (!autor)
          throw new Error(`El autor ${String(opciones.autor)} no es un administrador activo`)

        const responsable = await tx.user.findUnique({
          where: { username: normalizeUsername(opciones.responsable) },
          select: { id: true, branchId: true, isActive: true },
        })
        if (responsable?.branchId !== sucursal || !responsable.isActive) {
          throw new Error(`"${opciones.responsable}" no es un usuario activo de la sucursal`)
        }

        // Lo que hay tiene que ser EXACTAMENTE lo de la lista.
        const hayVentas = await tx.sale.findMany({
          where: { branchId: sucursal },
          select: { id: true },
        })
        const hayTurnos = await tx.cashShift.findMany({
          where: { branchId: sucursal },
          select: { id: true },
        })
        if (
          !iguales(
            hayVentas.map((v) => v.id),
            ventas,
          )
        ) {
          throw new Error(
            `Las ventas de la sucursal no son las de la lista: hay ${hayVentas.map((v) => v.id).join(', ')}`,
          )
        }
        if (
          !iguales(
            hayTurnos.map((t) => t.id),
            turnos,
          )
        ) {
          throw new Error(
            `Los turnos de la sucursal no son los de la lista: hay ${hayTurnos.map((t) => t.id).join(', ')}`,
          )
        }

        const reales = await tx.saleItem.findMany({
          where: { saleId: { in: [...ventas] }, product: { isActive: true } },
          select: { saleId: true, product: { select: { name: true } } },
        })
        const real = reales[0]
        if (real) {
          throw new Error(
            `La venta ${String(real.saleId)} tiene un producto activo ("${real.product.name}"): no es de prueba`,
          )
        }

        const fiados = await tx.customerAccountMovement.count({
          where: { saleId: { in: [...ventas] } },
        })
        if (fiados > 0) throw new Error('Hay ventas de prueba con cuenta corriente')
        const lotes = await tx.saleItemLotAllocation.count({
          where: { saleItem: { saleId: { in: [...ventas] } } },
        })
        if (lotes > 0) throw new Error('Hay ventas de prueba con partidas de lote')
        const pagosDeOtros = await tx.cashRegisterMovement.count({
          where: {
            branchId: sucursal,
            OR: [{ customerPaymentId: { not: null } }, { supplierPaymentId: { not: null } }],
          },
        })
        if (pagosDeOtros > 0) throw new Error('Hay movimientos de caja de cobros o pagos reales')

        const sucursalAntes = await tx.branch.findUniqueOrThrow({
          where: { id: sucursal },
          select: { currentCash: true },
        })
        const stockAntes = await huellaDelStock(tx)

        // Primero el archivo. Si alguna tabla ya existe, esto falla y no se saca nada.
        const v = enteros(ventas)
        const t = enteros(turnos)
        await tx.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS ${ESQUEMA}`)
        const copias: Array<[string, string]> = [
          ['Sale', `id = ANY(${v})`],
          ['SaleItem', `"saleId" = ANY(${v})`],
          ['SalePayment', `"saleId" = ANY(${v})`],
          ['CashRegisterMovement', `"branchId" = ${String(sucursal)}`],
          ['CashCount', `"branchId" = ${String(sucursal)}`],
          ['CashShift', `id = ANY(${t})`],
          ['Branch', `id = ${String(sucursal)}`],
        ]
        for (const [tabla, filtro] of copias) {
          await tx.$executeRawUnsafe(
            `CREATE TABLE ${ESQUEMA}."${tabla}" AS SELECT * FROM public."${tabla}" WHERE ${filtro}`,
          )
        }

        // Despues, de hijos a padres.
        const movimientosDeCaja = await tx.cashRegisterMovement.deleteMany({
          where: { branchId: sucursal },
        })
        const arqueos = await tx.cashCount.deleteMany({ where: { branchId: sucursal } })
        const pagos = await tx.salePayment.deleteMany({ where: { saleId: { in: [...ventas] } } })
        const lineas = await tx.saleItem.deleteMany({ where: { saleId: { in: [...ventas] } } })
        const borradas = await tx.sale.deleteMany({ where: { id: { in: [...ventas] } } })
        const turnosBorrados = await tx.cashShift.deleteMany({ where: { id: { in: [...turnos] } } })

        await tx.branch.update({ where: { id: sucursal }, data: { currentCash: 0 } })

        const turno = await tx.cashShift.create({
          data: {
            branchId: sucursal,
            openedById: responsable.id,
            openingAmount: 0,
            openingNotes: 'Caja inicial del local, abierta al sacar los datos de prueba',
            status: 'open',
          },
          select: { id: true },
        })

        await audit(tx, {
          userId: autor.id,
          branchId: sucursal,
          table: 'CashShift',
          recordId: turno.id,
          action: 'open',
          after: { turno: turno.id, montoInicial: '0.00', abiertoPor: responsable.id },
          reason: 'Caja inicial del local',
          origin: ORIGEN,
        })

        const resultado = {
          ventas: borradas.count,
          lineas: lineas.count,
          pagos: pagos.count,
          movimientosDeCaja: movimientosDeCaja.count,
          arqueos: arqueos.count,
          turnos: turnosBorrados.count,
          efectivoAcumuladoAntes: sucursalAntes.currentCash.toString(),
          turnoNuevo: turno.id,
          aplicado: opciones.aplicar,
          yaAplicada: null,
        }

        await audit(tx, {
          userId: autor.id,
          branchId: sucursal,
          table: 'Sale',
          recordId: null,
          action: 'delete',
          after: { limpieza: marca, archivo: ESQUEMA, ...resultado, yaAplicada: undefined },
          reason: `Datos de prueba sacados antes de operar (${marca})`,
          origin: ORIGEN,
        })

        // Comprobaciones, todavia adentro de la transaccion.
        if ((await huellaDelStock(tx)) !== stockAntes)
          throw new Error('La limpieza cambió el stock')
        if (borradas.count !== ventas.length || turnosBorrados.count !== turnos.length) {
          throw new Error('No se sacaron todas las filas de la lista')
        }
        if ((await tx.sale.count({ where: { branchId: sucursal } })) !== 0) {
          throw new Error('Quedaron ventas en la sucursal')
        }

        if (!opciones.aplicar) throw new Ensayo(resultado)
        return resultado
      },
      { timeout: 60_000, maxWait: 10_000 },
    )
  } catch (error) {
    if (error instanceof Ensayo) return error.resultado
    throw error
  }
}
