/**
 * De donde sale la mercaderia cuando un producto tiene lotes.
 *
 * Lo usan la venta, la perdida, la rotura y el consumo interno: todas las
 * salidas que no vienen de una devolucion a proveedor --esa sabe de que partida
 * llego-- ni de una anulacion --esa lee las asignaciones originales--.
 *
 * Ver docs/FEFO_POLICY.md.
 */

import { conflict } from '@/server/http/errors'
import type { TxClient } from '@/modules/inventory/service'
import {
  CERO_C,
  aTextoCantidad,
  esPositivaCantidad,
  minCantidad,
  restarCantidades,
  sumarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import { formatearCantidadConUnidad, type UnidadDeVenta } from '@/modules/products/units'
import type { FechaLocal } from '@/lib/tiempo'
import {
  lotesDisponibles,
  motivoDeRepartoInvalido,
  separarVendible,
  type LineaDeReparto,
} from './fefo'
import { politicaDeLoteODefecto, type PoliticaDeLote } from './politicas'

export interface LineaDeSalida {
  /** `null` es el stock que no pertenece a ninguna partida. NO es un lote. */
  lotId: number | null
  quantity: Cantidad
}

export interface ProductoParaSalida {
  id: number
  name: string
  saleUnit: UnidadDeVenta
  lotTracking: string
}

/**
 * Resuelve de que partidas sale una cantidad.
 *
 * Devuelve una sola linea con `lotId: null` cuando el producto no se sigue por
 * lote, que es el caso de todo el catalogo existente: ni una consulta de mas.
 *
 * Cuando SI se sigue:
 *   1. se leen los lotes con unidades, en orden FEFO;
 *   2. se separan los vencidos, que no son vendibles;
 *   3. se toma de los lotes primero y del stock sin asignar despues.
 *
 * El orden del punto 3 no es arbitrario: lo sin asignar no tiene vencimiento, no
 * es urgente nunca, y dejar partidas fechadas para el final es exactamente lo
 * que FEFO existe para evitar.
 *
 * `manual` es el reparto declarado --objetivo 14--. Se comprueba entero: cada
 * lote tiene que existir, tener unidades, no estar vencido, y la suma tiene que
 * dar EXACTAMENTE la cantidad. El servidor no le cree al navegador.
 */
export async function resolverSalida(
  tx: TxClient,
  entrada: {
    branchId: number
    producto: ProductoParaSalida
    quantity: Cantidad
    hoy: FechaLocal
    manual?: readonly LineaDeReparto[] | undefined
  },
): Promise<LineaDeSalida[]> {
  const politica: PoliticaDeLote = politicaDeLoteODefecto(entrada.producto.lotTracking)
  if (politica === 'NONE') return [{ lotId: null, quantity: entrada.quantity }]

  const todos = await lotesDisponibles(tx, entrada.branchId, entrada.producto.id, entrada.hoy)
  const { vendible, vencido, lotes } = separarVendible(todos)

  if (entrada.manual !== undefined) {
    const motivo = motivoDeRepartoInvalido(lotes, entrada.manual, entrada.quantity)
    if (motivo !== null) {
      throw conflict(`${entrada.producto.name}: ${motivo}.`, { code: 'INSUFFICIENT_LOT_STOCK' })
    }
    return entrada.manual.map((l) => ({ lotId: l.lotId, quantity: l.quantity }))
  }

  const sinAsignar = await stockSinAsignar(tx, entrada.branchId, entrada.producto.id)
  const disponible = sumarCantidades(vendible, sinAsignar)

  if (restarCantidades(entrada.quantity, disponible).greaterThan(CERO_C)) {
    // Los tres numeros, por separado. Decir solo "no hay stock" cuando el
    // agregado dice 10 obliga a adivinar por que.
    const con = (c: Cantidad) =>
      formatearCantidadConUnidad(aTextoCantidad(c), entrada.producto.saleUnit)
    throw conflict(
      `No hay suficiente "${entrada.producto.name}" vendible: se pidieron ` +
        `${con(entrada.quantity)}, hay ${con(disponible)} vendibles y ` +
        `${con(vencido)} vencidos.`,
      { code: esPositivaCantidad(vencido) ? 'INSUFFICIENT_SELLABLE_STOCK' : 'INSUFFICIENT_STOCK' },
    )
  }

  const salida: LineaDeSalida[] = []
  let falta = entrada.quantity

  for (const lote of lotes) {
    if (!esPositivaCantidad(falta)) break
    const toma = minCantidad(falta, lote.quantity)
    salida.push({ lotId: lote.lotId, quantity: toma })
    falta = restarCantidades(falta, toma)
  }

  if (esPositivaCantidad(falta)) salida.push({ lotId: null, quantity: falta })

  // Por lotId ascendente ANTES de escribir. FEFO decide de donde sale, leyendo;
  // el orden de los bloqueos es otro asunto, y mezclarlos es el interbloqueo.
  // Lo sin asignar va primero porque no toma bloqueo de lote.
  return salida.sort((a, b) => (a.lotId ?? 0) - (b.lotId ?? 0))
}

/**
 * Lo que NO pertenece a ninguna partida. Derivado, nunca guardado.
 *
 * Cuenta TODOS los lotes, vencidos incluidos: el vencido ocupa stock aunque no
 * se pueda vender, y restarlo de mas haria aparecer unidades sin asignar que no
 * existen.
 */
export async function stockSinAsignar(
  tx: TxClient,
  branchId: number,
  productId: number,
): Promise<Cantidad> {
  const filas = await tx.$queryRaw<Array<{ sinAsignar: Cantidad }>>`
    SELECT (COALESCE(bs."quantity", 0) - COALESCE(sum(bls."quantity"), 0))::numeric(14,3)
             AS "sinAsignar"
      FROM "Product" p
      LEFT JOIN "BranchStock" bs
        ON bs."productId" = p."id" AND bs."branchId" = ${branchId}
      LEFT JOIN "ProductLot" l ON l."productId" = p."id"
      LEFT JOIN "BranchLotStock" bls
        ON bls."lotId" = l."id" AND bls."branchId" = ${branchId}
     WHERE p."id" = ${productId}
     GROUP BY bs."quantity"
  `
  return filas[0]?.sinAsignar ?? CERO_C
}
