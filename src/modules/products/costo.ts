/**
 * El costo de un producto cambia por un solo lugar: aca.
 *
 * LA REGLA, y no tiene excepciones:
 *
 *   `Product.cost` es el `newCost` de la fila de `ProductCostHistory` con el
 *   `id` MAS ALTO de ese producto.
 *
 * No "la ultima recepcion". No "el ultimo cambio manual". **El ultimo
 * evento**, venga de donde venga. Si el lunes llego mercaderia a $1.100 y el
 * martes alguien lo corrigio a mano a $1.050 con motivo, el costo es $1.050:
 * la recepcion no le gana a una decision posterior de una persona con permiso.
 * Y al reves: si despues de esa correccion llega otro camion, manda el camion.
 *
 * POR QUE EL `id` Y NO LA FECHA. `createdAt` sale de `now()`, que en
 * PostgreSQL es la hora de INICIO DE LA TRANSACCION, no la del INSERT. Dos
 * transacciones que se pisan pueden quedar con las fechas al reves del orden
 * en que realmente escribieron. El `id` viene de una secuencia y se asigna en
 * el INSERT, que ocurre despues de tomar el bloqueo de mas abajo: por eso el
 * orden de `id` es exactamente el orden en que se escribio.
 *
 * `createdAt` sigue estando y sigue siendo lo que se le muestra a la gente.
 * Para decidir, manda el `id`.
 *
 * EL BLOQUEO. Antes de leer el costo actual se toma `FOR UPDATE` sobre la fila
 * del producto. Sin eso, dos cambios simultaneos leerian el mismo costo
 * anterior y dejarian dos filas de historial que dicen venir del mismo punto:
 * el encadenamiento `previousCost` -> `newCost` quedaria roto y la
 * reconciliacion lo marcaria, con razon.
 *
 * Ver docs/PHASE3_RECONCILIATION.md.
 */

import type { Prisma } from '@prisma/client'
import type { prisma } from '@/lib/prisma'
import { iguales, type Dinero } from '@/server/money'

type Cliente = Prisma.TransactionClient | typeof prisma

export interface CambioDeCosto {
  productId: number
  /** El costo que queda. `null` significa DEJARLO SIN COSTO, no ponerlo en cero. */
  nuevo: Dinero | null
  userId: number
  /** Obligatorio: un cambio de costo sin motivo no se puede auditar despues. */
  reason: string
  /** De quien vino la mercaderia, cuando vino de una compra. */
  supplierId?: number | null
  /** La RECEPCION que lo movio. Null en un cambio manual. */
  receiptId?: number | null
}

export interface ResultadoDelCambio {
  /** Falso cuando el costo ya era ese: no se escribe nada. */
  cambio: boolean
  anterior: Dinero | null
  nuevo: Dinero | null
  /** El id de la fila de historial, cuando hubo cambio. */
  historialId: number | null
}

/**
 * Cambia el costo y deja el rastro, en ese orden y bajo bloqueo.
 *
 * Devuelve `cambio: false` sin escribir nada cuando el costo nuevo es igual al
 * viejo. Es deliberado: una recepcion al mismo costo de siempre no tiene por
 * que ensuciar el historial con una fila que dice que nada cambio, y quien
 * mira la ficha de un producto quiere ver los cambios, no las confirmaciones.
 */
export async function registrarCambioDeCosto(
  tx: Cliente,
  entrada: CambioDeCosto,
): Promise<ResultadoDelCambio> {
  // El bloqueo. Hace esperar a cualquier otra transaccion que quiera cambiar
  // el costo de ESTE producto, que es lo que vuelve verdadero el orden por
  // `id`.
  //
  // `FOR NO KEY UPDATE` y no `FOR UPDATE`, y la diferencia NO es cosmetica.
  //
  // Insertar una fila que referencia a `Product` --una linea de recepcion, una
  // de venta, una del historial de costos-- toma un `FOR KEY SHARE` sobre el
  // producto para que nadie le cambie la clave por debajo. `FOR UPDATE`
  // choca con ese bloqueo; `FOR NO KEY UPDATE` no, porque promete no tocar la
  // clave, que es exactamente lo que hace esta funcion.
  //
  // Con `FOR UPDATE` habia INTERBLOQUEO: dos recepciones del mismo producto
  // tomaban primero el `FOR KEY SHARE` de su linea de recepcion --compatibles
  // entre si--, despues una se quedaba con la fila de stock, y al llegar aca
  // cada una esperaba el bloqueo de clave que tenia la otra. Lo encontro
  // tests/concurrency/compras.test.ts, que ya existia desde la Fase 3C.
  const filas = await tx.$queryRaw<Array<{ cost: Dinero | null }>>`
    SELECT "cost" FROM "Product" WHERE "id" = ${entrada.productId} FOR NO KEY UPDATE
  `
  const fila = filas[0]
  if (!fila) throw new Error(`No existe el producto ${entrada.productId}`)

  const anterior = fila.cost
  const nuevo = entrada.nuevo

  const igual = anterior === null || nuevo === null ? anterior === nuevo : iguales(anterior, nuevo)
  if (igual) return { cambio: false, anterior, nuevo, historialId: null }

  await tx.product.update({ where: { id: entrada.productId }, data: { cost: nuevo } })

  const historial = await tx.productCostHistory.create({
    data: {
      productId: entrada.productId,
      previousCost: anterior,
      newCost: nuevo,
      supplierId: entrada.supplierId ?? null,
      receiptId: entrada.receiptId ?? null,
      userId: entrada.userId,
      reason: entrada.reason,
    },
    select: { id: true },
  })

  return { cambio: true, anterior, nuevo, historialId: historial.id }
}
