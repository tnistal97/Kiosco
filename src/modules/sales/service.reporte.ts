/**
 * Reporte de ventas por rango de fechas.
 *
 * Vive aparte de `service.ts` porque es lectura y no toca nada: no comparte
 * ni una linea con el registro ni con la anulacion, que son las dos
 * operaciones delicadas del modulo.
 */

import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'
import { invalid } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import { MAX_DIAS_REPORTE, type ReporteVentasQuery } from './schemas'
import type { Monto } from '@/lib/money'
import type { TextoCantidad } from '@/lib/cantidad'
import { aMonto, multiplicar, redondearPesos, sumar, type Dinero } from '@/server/money'
import { aTextoCantidad, type Cantidad } from '@/server/cantidad'
import { unidadDeVentaODefecto, type UnidadDeVenta } from '@/modules/products/units'
import { cantidadDeDias, esFechaLocal, rangoDeSucursal } from '@/server/tiempo'

export interface VentaDelReporte {
  id: number
  date: string
  status: string
  canceledAt: Date | null
  cancelReason: string | null
  paymentMethod: string | null
  total: Monto
  user: { id: number; name: string }
  canceledBy: { id: number; name: string } | null
  items: Array<{
    id: number
    quantity: TextoCantidad
    /** La unidad en la que se vendio. Sin ella `0.425` no se puede leer. */
    saleUnit: UnidadDeVenta
    price: Monto
    product: { id: number; name: string }
  }>
}

export interface TotalesDelReporte {
  /** Ventas no anuladas del rango completo, no solo de la pagina. */
  ventas: number
  anuladas: number
  /**
   * Lo recaudado en el rango. `null` sin `reports.sales.view`.
   *
   * Contar operaciones y ver cuanto factura el local no son la misma
   * informacion. El cajero necesita lo primero para encontrar una venta que
   * tiene que anular; lo segundo es una cifra del negocio. Misma disciplina
   * que el costo de un producto: no se esconde en la pantalla, no sale de la
   * respuesta.
   */
  recaudado: Monto | null
}

/**
 * Total de una lista de lineas.
 *
 * Cada subtotal se redondea a dos decimales y despues se suman, en ese orden y
 * no al reves: es como se arma el ticket, y el reporte tiene que dar lo mismo
 * que el papel que se llevo el cliente.
 */
function totalDeLineas(lineas: Array<{ price: Dinero; quantity: Cantidad }>): Dinero {
  return sumar(...lineas.map((l) => redondearPesos(multiplicar(l.price, l.quantity))))
}

/**
 * Ventas del rango, paginadas, con los totales del rango entero.
 *
 * Los totales se calculan sobre todo el rango y no sobre la pagina: si se
 * sumaran los de la pagina, cambiar de pagina cambiaria la recaudacion del
 * mes, que es exactamente lo que un reporte no debe hacer.
 */
export async function reporteDeVentas(
  session: Session,
  query: ReporteVentasQuery,
): Promise<Paginated<VentaDelReporte> & { totales: TotalesDelReporte }> {
  // El rango se interpreta en la ZONA HORARIA DE LA SUCURSAL.
  //
  // Hasta la Fase 3C esto se armaba con `T00:00:00.000Z` --UTC-- y en
  // Argentina el "dia" iba de las 21:00 del dia anterior a las 20:59 del
  // pedido: **toda venta hecha despues de las 21:00 desaparecia del dia**. La
  // 3C lo corrigio quitando la `Z`, lo que traslado la decision a la zona del
  // PROCESO: correcta en el servidor del local, incorrecta en cualquier otro.
  //
  // Desde la 3D la decide un dato del negocio. Ver docs/TIMEZONE_POLICY.md.
  if (!esFechaLocal(query.start) || !esFechaLocal(query.end)) throw invalid('Fechas invalidas')
  if (query.start > query.end) throw invalid('La fecha inicial es posterior a la final')

  // Se cuentan DIAS DE CALENDARIO y no milisegundos divididos: un rango que
  // cruza un cambio de horario de verano tiene un dia de 23 horas, y la
  // division devolveria 30,96 dias para un mes de 31.
  const dias = cantidadDeDias(query.start, query.end)
  if (dias > MAX_DIAS_REPORTE) throw invalid(`El rango no puede superar ${MAX_DIAS_REPORTE} dias`)

  const { desde, hasta } = await rangoDeSucursal(prisma, session.branchId, query.start, query.end)

  const where: Prisma.SaleWhereInput = {
    branchId: session.branchId,
    date: { gte: desde, lte: hasta },
    ...(query.estado === 'todas' ? {} : { status: query.estado }),
    ...(query.userId === undefined ? {} : { userId: query.userId }),
    ...(query.saleId === undefined ? {} : { id: query.saleId }),
    // El medio de pago no vive en Sale sino en el movimiento de caja que la
    // venta genera. Se filtra por la relacion, no por un campo que no existe.
    ...(query.paymentMethod === undefined
      ? {}
      : { cashMovements: { some: { type: 'sale', paymentMethod: query.paymentMethod } } }),
  }

  const [total, anuladas, ventas] = await Promise.all([
    prisma.sale.count({ where }),
    prisma.sale.count({ where: { ...where, status: 'canceled' } }),
    prisma.sale.findMany({
      where,
      orderBy: { date: 'desc' },
      ...toSkipTake(query),
      select: {
        id: true,
        date: true,
        status: true,
        canceledAt: true,
        cancelReason: true,
        user: { select: { id: true, name: true } },
        canceledBy: { select: { id: true, name: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            price: true,
            product: { select: { id: true, name: true, saleUnit: true } },
          },
        },
        // El medio de pago sale del movimiento vinculado por `saleId`. Antes
        // se deducia parseando "Venta #123" del texto de la descripcion y, si
        // no coincidia, asumia "efectivo" en silencio: cualquier venta con
        // tarjeta cuya descripcion no encajara figuraba como efectivo.
        cashMovements: {
          where: { type: 'sale' },
          select: { paymentMethod: true },
          take: 1,
        },
      },
    }),
  ])

  // La recaudacion del rango completo, AGREGADA EN LA BASE.
  //
  // Hasta la Fase 3D esto traia todas las lineas del rango --`findMany` sobre
  // `SaleItem`-- y las sumaba en JavaScript. Con un mes flojo eran cientos de
  // filas y no se notaba; con un anio de un almacen que vende cien tickets por
  // dia son decenas de miles de objetos construidos para devolver un numero.
  // La suma la hace ahora PostgreSQL, con el mismo redondeo por linea.
  //
  // Solo se pide si quien consulta puede verla: sin el permiso, la consulta ni
  // siquiera se ejecuta.
  const puedeVerRecaudado = session.permissions.has('reports.sales.view')
  const recaudado = puedeVerRecaudado
    ? await prisma.$queryRaw<Array<{ total: string }>>`
        SELECT COALESCE(sum(round(i."price" * i."quantity", 2)), 0)::numeric(14,2)::text AS total
          FROM "SaleItem" i
          JOIN "Sale" s ON s."id" = i."saleId"
         WHERE s."branchId" = ${session.branchId}
           AND s."date" >= ${desde}
           AND s."date" <= ${hasta}
           AND s."status" = 'completed'
           ${query.userId === undefined ? Prisma.empty : Prisma.sql`AND s."userId" = ${query.userId}`}
           ${query.saleId === undefined ? Prisma.empty : Prisma.sql`AND s."id" = ${query.saleId}`}
      `
    : null

  const data: VentaDelReporte[] = ventas.map(({ cashMovements, items, ...venta }) => ({
    ...venta,
    date: venta.date.toISOString(),
    paymentMethod: cashMovements[0]?.paymentMethod ?? null,
    items: items.map(({ product, ...i }) => ({
      ...i,
      quantity: aTextoCantidad(i.quantity),
      saleUnit: unidadDeVentaODefecto(product.saleUnit),
      price: aMonto(i.price),
      product: { id: product.id, name: product.name },
    })),
    total: aMonto(totalDeLineas(items)),
  }))

  return {
    ...paginado(data, total, query),
    totales: {
      ventas: total - anuladas,
      anuladas,
      recaudado: recaudado === null ? null : (recaudado[0]?.total ?? '0.00'),
    },
  }
}
