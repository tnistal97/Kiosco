/**
 * Cuanto de lo que hay NO se puede vender por estar vencido.
 *
 * El problema que resuelve, con los numeros del pedido de la Fase 5A.2: un
 * producto con `BranchStock = 10`, de los cuales 7 estan en lotes vencidos.
 * Vendibles hay 3. La caja mostraba 10, dejaba armar un ticket de 5, y el
 * rechazo aparecia al cobrar --con el cliente enfrente y la fila esperando--.
 *
 * La cuenta, y por que es EXACTAMENTE la del servidor:
 *
 *   vendible = total - vencido
 *
 * `resolverSalida()` autoriza `vendible_en_lotes + sin_asignar`, donde
 * `sin_asignar = total - todo_lo_que_esta_en_lotes`. Reemplazando:
 *
 *   vendible_en_lotes + total - (vendible_en_lotes + vencido) = total - vencido
 *
 * Las dos puntas dan el mismo numero por construccion, no por coincidencia. Hay
 * una prueba que compara el numero del DTO contra lo que el cobro deja pasar.
 *
 * IMPORTANTE: el numero del cliente es AYUDA, no autoridad. El cobro vuelve a
 * calcular todo dentro de la transaccion, con los lotes bloqueados. Ver
 * `resolverSalida()` en salida.ts y docs/FEFO_POLICY.md.
 */

import { Prisma } from '@prisma/client'
import type { TxClient } from '@/modules/inventory/service'
import { CERO_C, restarCantidades, type Cantidad } from '@/server/cantidad'
import type { FechaLocal } from '@/lib/tiempo'

interface FilaVencida {
  productId: number
  vencido: Cantidad
}

/**
 * Lo vencido de VARIOS productos, en UNA consulta.
 *
 * Una consulta para la pagina entera, no una por producto: es la diferencia
 * entre agregar un dato util al listado y convertir el listado en un N+1. Hay
 * una guardia que lo comprueba con 5 y con 40 productos.
 *
 * Los productos SIN seguimiento por lote quedan fuera a proposito, aunque
 * tengan lotes viejos de cuando lo tenian: `resolverSalida()` ni los mira si la
 * politica es `NONE`, asi que contarlos aca haria que la caja bloqueara una
 * venta que el servidor autoriza. La pantalla mentiria por exceso de celo, que
 * en una caja cuesta lo mismo que mentir por defecto.
 *
 * Vencido es `expirationDate < hoy`. El que vence HOY todavia se vende: ver
 * `estadoDeVencimiento()`, donde `VENCE_HOY` no es `VENCIDO`.
 */
export async function vencidoPorProducto(
  tx: TxClient,
  branchId: number,
  productIds: readonly number[],
  hoy: FechaLocal,
): Promise<Map<number, Cantidad>> {
  const mapa = new Map<number, Cantidad>()
  if (productIds.length === 0) return mapa

  const filas = await tx.$queryRaw<FilaVencida[]>`
    SELECT l."productId"                         AS "productId",
           SUM(bls."quantity")::numeric(14,3)    AS "vencido"
      FROM "BranchLotStock" bls
      JOIN "ProductLot" l ON l."id" = bls."lotId"
      JOIN "Product"    p ON p."id" = l."productId"
     WHERE bls."branchId" = ${branchId}
       AND bls."quantity" > 0
       AND l."productId" = ANY(${Prisma.sql`${[...productIds]}::int[]`})
       AND p."lotTracking" <> 'NONE'
       AND l."expirationDate" IS NOT NULL
       AND l."expirationDate" < CAST(${hoy} AS date)
     GROUP BY l."productId"
  `

  for (const fila of filas) mapa.set(fila.productId, fila.vencido)
  return mapa
}

export interface Vendible {
  /** Lo que dice `BranchStock`. Vencido incluido. */
  totalStock: Cantidad
  /** Lo que el cobro va a dejar vender. */
  sellableStock: Cantidad
  /** Lo que ocupa lugar y no se puede vender. */
  expiredStock: Cantidad
}

/**
 * Los tres numeros de un producto, a partir del total y de lo vencido.
 *
 * Sin lotes vencidos --el catalogo entero, hoy-- devuelve el total dos veces y
 * cero: es la respuesta correcta y no cuesta ninguna consulta.
 */
export function separarStock(total: Cantidad, vencido: Cantidad | undefined): Vendible {
  const venc = vencido ?? CERO_C
  return {
    totalStock: total,
    sellableStock: restarCantidades(total, venc),
    expiredStock: venc,
  }
}

/** Si hace falta preguntar por lotes. Con `NONE` en todo, no. */
export function algunoSigueLotes(filas: readonly { lotTracking: string }[]): boolean {
  return filas.some((f) => f.lotTracking !== 'NONE')
}
