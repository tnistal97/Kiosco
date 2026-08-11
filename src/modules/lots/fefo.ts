/**
 * FEFO: de que lote sale la mercaderia.
 *
 * First Expired, First Out. NO es FIFO, y confundirlos tira mercaderia: el
 * yogur que llego el lunes puede vencer en septiembre y el que llego el
 * miercoles el 18 de agosto.
 *
 * El modulo tiene dos mitades y estan separadas a proposito:
 *
 *   · `repartir()` es PURA. Recibe una lista y una cantidad, devuelve el
 *     reparto. Se puede probar con veinte casos sin base de datos.
 *   · `lotesDisponibles()` es la consulta, con su orden y su filtro de vencidos.
 *
 * Ver docs/FEFO_POLICY.md.
 */

import type { TxClient } from '@/modules/inventory/service'
import {
  CERO_C,
  aTextoCantidad,
  compararCantidades,
  esPositivaCantidad,
  minCantidad,
  restarCantidades,
  sumarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import type { FechaLocal } from '@/lib/tiempo'
import { diasHastaVencer, estadoDeVencimiento, type EstadoDeVencimiento } from './politicas'

export interface LoteDisponible {
  lotId: number
  code: string
  /** `YYYY-MM-DD` o null. NUNCA un instante: ver docs/LOT_EXPIRATION_POLICY.md. */
  expirationDate: FechaLocal | null
  quantity: Cantidad
  /** Negativo si ya vencio, null si no vence. */
  dias: number | null
  estado: EstadoDeVencimiento
}

export interface LineaDeReparto {
  lotId: number
  quantity: Cantidad
}

/**
 * Reparte una cantidad entre los lotes disponibles, EN EL ORDEN EN QUE VIENEN.
 *
 * No ordena: el orden es responsabilidad de quien arma la lista, y eso importa
 * porque la anulacion usa otro orden --el de las asignaciones originales-- y la
 * eleccion manual, ninguno.
 *
 * Devuelve `null` si no alcanza. No lanza: quien llama tiene el contexto para
 * armar el mensaje --el nombre del producto, cuanto habia-- y esta funcion no
 * lo tiene.
 */
export function repartir(
  lotes: readonly LoteDisponible[],
  cantidad: Cantidad,
): LineaDeReparto[] | null {
  const lineas: LineaDeReparto[] = []
  let falta = cantidad

  for (const lote of lotes) {
    if (!esPositivaCantidad(falta)) break
    if (!esPositivaCantidad(lote.quantity)) continue

    const toma = minCantidad(falta, lote.quantity)
    lineas.push({ lotId: lote.lotId, quantity: toma })
    falta = restarCantidades(falta, toma)
  }

  return esPositivaCantidad(falta) ? null : lineas
}

/** Cuanto suman los lotes de una lista. Lo vendible, lo vencido, lo que sea. */
export function totalDe(lotes: readonly LoteDisponible[]): Cantidad {
  return lotes.reduce((suma, l) => sumarCantidades(suma, l.quantity), CERO_C)
}

/**
 * Ordena una lista ya cargada por el criterio FEFO.
 *
 * Existe aparte de la consulta porque hay caminos que ya tienen los lotes en
 * memoria --la vista previa de una venta, la pantalla del producto-- y repetir
 * el criterio en dos lugares es como se separan.
 *
 * El orden, exacto:
 *   1. los que VENCEN, antes que los que no
 *   2. el vencimiento mas proximo primero
 *   3. el que entro antes
 *   4. el id, para que sea determinístico
 */
export function ordenFEFO(a: LoteDisponible, b: LoteDisponible): number {
  const aSinFecha = a.expirationDate === null
  const bSinFecha = b.expirationDate === null
  if (aSinFecha !== bSinFecha) return aSinFecha ? 1 : -1
  if (!aSinFecha && !bSinFecha && a.expirationDate !== b.expirationDate) {
    return (a.expirationDate ?? '') < (b.expirationDate ?? '') ? -1 : 1
  }
  return a.lotId - b.lotId
}

interface FilaDeLote {
  lotId: number
  code: string
  expirationDate: Date | null
  quantity: Cantidad
}

/**
 * Los lotes CON UNIDADES de un producto en una sucursal, en orden FEFO.
 *
 * `expirationDate` es una columna `DATE`: PostgreSQL la devuelve como `Date` a
 * medianoche UTC, y formatearla con `toISOString()` da el mismo `YYYY-MM-DD`
 * que hay guardado. Se leen los componentes UTC A PROPOSITO --nunca los
 * locales-- porque los locales la correrian un dia hacia atras en Argentina,
 * que es exactamente el error que las Fases 3C, 3D y 4A tuvieron que arreglar.
 *
 * El orden va en SQL y no en JavaScript porque este es el camino caliente de la
 * caja: ordenar diez filas en memoria es gratis, pero traerlas ya ordenadas
 * permite que la consulta se corte cuando alcance.
 */
export async function lotesDisponibles(
  tx: TxClient,
  branchId: number,
  productId: number,
  hoy: FechaLocal,
): Promise<LoteDisponible[]> {
  const filas = await tx.$queryRaw<FilaDeLote[]>`
    SELECT l."id"             AS "lotId",
           l."code"           AS "code",
           l."expirationDate" AS "expirationDate",
           bls."quantity"     AS "quantity"
      FROM "BranchLotStock" bls
      JOIN "ProductLot" l ON l."id" = bls."lotId"
     WHERE bls."branchId" = ${branchId}
       AND l."productId" = ${productId}
       AND bls."quantity" > 0
     ORDER BY (l."expirationDate" IS NULL),
              l."expirationDate" ASC,
              l."createdAt" ASC,
              l."id" ASC
  `

  return filas.map((f) => {
    const expirationDate = comoFechaLocal(f.expirationDate)
    const dias = diasHastaVencer(hoy, expirationDate)
    return {
      lotId: f.lotId,
      code: f.code,
      expirationDate,
      quantity: f.quantity,
      dias,
      estado: estadoDeVencimiento(dias),
    }
  })
}

/**
 * Una columna `DATE` como fecha de calendario.
 *
 * SIEMPRE por los componentes UTC. `toLocaleDateString()` o `getDate()` la
 * correrian un dia hacia atras en cualquier zona al oeste de Greenwich.
 */
export function comoFechaLocal(fecha: Date | null): FechaLocal | null {
  if (fecha === null) return null
  const a = String(fecha.getUTCFullYear()).padStart(4, '0')
  const m = String(fecha.getUTCMonth() + 1).padStart(2, '0')
  const d = String(fecha.getUTCDate()).padStart(2, '0')
  return `${a}-${m}-${d}`
}

/** Una fecha de calendario como `Date` para una columna `DATE`. Sin hora. */
export function comoFechaDeBase(fecha: FechaLocal): Date {
  return new Date(`${fecha}T00:00:00.000Z`)
}

export interface Vendibilidad {
  /** Todo lo que hay en lotes, vencido incluido. */
  enLotes: Cantidad
  /** Lo que FEFO puede tomar. */
  vendible: Cantidad
  /** Lo que no se puede vender por estar vencido. */
  vencido: Cantidad
  /** Los lotes que FEFO puede tomar, ya ordenados. */
  lotes: LoteDisponible[]
}

/**
 * Los tres numeros que la pantalla muestra por separado.
 *
 * Mostrar solo el disponible hace que la caja crea que alcanza y lo descubra al
 * cobrar. Ver el objetivo 15.
 */
export function separarVendible(lotes: readonly LoteDisponible[]): Vendibilidad {
  const vendibles = lotes.filter((l) => l.estado !== 'VENCIDO')
  const vencidos = lotes.filter((l) => l.estado === 'VENCIDO')
  return {
    enLotes: totalDe(lotes),
    vendible: totalDe(vendibles),
    vencido: totalDe(vencidos),
    lotes: vendibles,
  }
}

/**
 * Comprueba que el reparto declarado a mano sea legitimo.
 *
 * La eleccion manual de lote --objetivo 14-- se hace con permiso, pero el
 * servidor no le cree al navegador: comprueba que cada lote exista, tenga
 * unidades, no este vencido, y que el reparto sume EXACTAMENTE la cantidad
 * pedida. Devuelve el motivo del rechazo, o null.
 */
export function motivoDeRepartoInvalido(
  lotes: readonly LoteDisponible[],
  reparto: readonly LineaDeReparto[],
  cantidad: Cantidad,
): string | null {
  if (reparto.length === 0) return 'El reparto por lote no tiene ninguna línea'

  const vistos = new Set<number>()
  let suma = CERO_C

  for (const linea of reparto) {
    if (vistos.has(linea.lotId)) return 'Un lote no puede aparecer dos veces en el mismo reparto'
    vistos.add(linea.lotId)

    if (!esPositivaCantidad(linea.quantity)) {
      return 'Cada línea del reparto tiene que llevar una cantidad positiva'
    }

    const lote = lotes.find((l) => l.lotId === linea.lotId)
    if (!lote) return 'Se eligió un lote que no tiene unidades disponibles'
    if (lote.estado === 'VENCIDO') return `El lote ${lote.code} está vencido: no se puede vender`
    if (compararCantidades(linea.quantity, lote.quantity) > 0) {
      return `El lote ${lote.code} tiene ${aTextoCantidad(lote.quantity)} y se pidieron ${aTextoCantidad(linea.quantity)}`
    }

    suma = sumarCantidades(suma, linea.quantity)
  }

  if (compararCantidades(suma, cantidad) !== 0) {
    return `El reparto por lote suma ${aTextoCantidad(suma)} y la cantidad es ${aTextoCantidad(cantidad)}`
  }
  return null
}
