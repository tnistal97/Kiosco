/**
 * Las partidas que llegan con una recepcion.
 *
 * La mercaderia que entra trae partidas que el sistema no vio nunca: el operario
 * lee el codigo del envase. Por eso la recepcion declara lotes POR CODIGO y este
 * modulo los resuelve o los crea.
 *
 * Ver docs/LOT_TRACKING_DESIGN.md, objetivos 8 y 9 de la Fase 4D.
 */

import { conflict, invalid } from '@/server/http/errors'
import type { TxClient } from '@/modules/inventory/service'
import {
  CERO_C,
  aTextoCantidad,
  cantidad as aCantidad,
  compararCantidades,
  sumarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import type { TextoCantidad } from '@/lib/cantidad'
import type { FechaLocal } from '@/lib/tiempo'
import { comoFechaDeBase } from './fefo'
import {
  normalizarCodigoDeLote,
  politicaDeLoteODefecto,
  politicaDeVencimientoODefecto,
} from './politicas'

export interface LoteDeclarado {
  code: string
  expirationDate?: FechaLocal | null
  manufacturedAt?: FechaLocal | null
  /** EN UNIDAD DE COMPRA, igual que la linea. */
  quantity: TextoCantidad
}

export interface ParteRecibida {
  lotId: number
  code: string
  /** EN UNIDAD DE COMPRA. */
  quantity: Cantidad
  /** EN UNIDAD DE VENTA: quantity x unitsPerPurchaseUnit. */
  stockQuantity: Cantidad
}

export interface ProductoParaEntrada {
  id: number
  name: string
  lotTracking: string
  expirationTracking: string
}

/**
 * Comprueba el reparto declarado contra la politica del producto.
 *
 * Se hace ANTES de escribir nada --antes incluso de crear la cabecera de la
 * recepcion-- para que un rechazo no deje media entrega registrada.
 */
export function motivoDeLotesInvalidos(
  producto: ProductoParaEntrada,
  lotes: readonly LoteDeclarado[] | undefined,
  recibido: Cantidad,
): string | null {
  const politica = politicaDeLoteODefecto(producto.lotTracking)
  const venc = politicaDeVencimientoODefecto(producto.expirationTracking)

  if (politica === 'NONE') {
    return lotes === undefined
      ? null
      : `"${producto.name}" no se sigue por lote: la recepción no puede declarar partidas.`
  }

  if (lotes === undefined) {
    return politica === 'REQUIRED'
      ? `"${producto.name}" se sigue por lote: hay que decir de qué partidas llegó.`
      : null
  }

  const codigos = lotes.map((l) => normalizarCodigoDeLote(l.code))
  if (new Set(codigos).size !== codigos.length) {
    return `"${producto.name}": una partida no puede aparecer dos veces en la misma línea.`
  }

  for (const lote of lotes) {
    const vence = lote.expirationDate ?? null
    if (venc === 'REQUIRED' && vence === null) {
      return `"${producto.name}" exige fecha de vencimiento: falta la de la partida ${lote.code}.`
    }
    if (venc === 'NONE' && vence !== null) {
      return `"${producto.name}" no controla vencimiento: la partida ${lote.code} no lleva fecha.`
    }
    const elaborado = lote.manufacturedAt ?? null
    if (elaborado !== null && vence !== null && elaborado > vence) {
      return `La partida ${lote.code} figura elaborada después de su vencimiento.`
    }
  }

  // TODO o NADA. Una linea a medias asignar deja mercaderia en el deposito que el
  // sistema no sabe de que partida es, y como la recepcion es inmutable eso no se
  // puede completar despues. Ver el objetivo 41.
  const suma = lotes.reduce((s, l) => sumarCantidades(s, aCantidad(l.quantity)), CERO_C)
  if (compararCantidades(suma, recibido) !== 0) {
    return (
      `"${producto.name}": las partidas suman ${aTextoCantidad(suma)} y llegaron ` +
      `${aTextoCantidad(recibido)}. Una recepción no puede quedar repartida a medias.`
    )
  }

  return null
}

/**
 * Resuelve o crea las partidas declaradas, y devuelve el reparto con sus ids.
 *
 * Una partida que YA EXISTE no se toca: si el papel del proveedor trae una fecha
 * distinta de la que ya estaba, se rechaza en vez de pisarla. Dos entregas de la
 * misma partida tienen que decir lo mismo, y si no lo dicen, una de las dos esta
 * mal cargada y hay que mirarla. Corregir la fecha tiene su propio camino, con
 * su permiso y su bitacora.
 */
export async function resolverLotesRecibidos(
  tx: TxClient,
  entrada: {
    producto: ProductoParaEntrada
    lotes: readonly LoteDeclarado[]
    unitsPerPurchaseUnit: Cantidad
    userId: number
  },
): Promise<ParteRecibida[]> {
  const partes: ParteRecibida[] = []

  for (const lote of entrada.lotes) {
    const codeNormalized = normalizarCodigoDeLote(lote.code)
    const vence = lote.expirationDate ?? null
    const elaborado = lote.manufacturedAt ?? null

    const existente = await tx.productLot.findUnique({
      where: { productId_codeNormalized: { productId: entrada.producto.id, codeNormalized } },
      select: { id: true, code: true, expirationDate: true },
    })

    let lotId: number
    if (existente) {
      const guardada = existente.expirationDate
      const declarada = vence === null ? null : comoFechaDeBase(vence)
      const iguales =
        (guardada === null && declarada === null) ||
        (guardada !== null && declarada !== null && guardada.getTime() === declarada.getTime())

      if (!iguales) {
        throw conflict(
          `La partida ${existente.code} de "${entrada.producto.name}" ya está cargada con ` +
            'otra fecha de vencimiento. Revisá cuál de las dos es la correcta: corregir la ' +
            'fecha es una operación aparte, con su propio permiso.',
          { code: 'CONFLICT' },
        )
      }
      lotId = existente.id
    } else {
      const creado = await tx.productLot.create({
        data: {
          productId: entrada.producto.id,
          code: lote.code.trim(),
          codeNormalized,
          expirationDate: vence === null ? null : comoFechaDeBase(vence),
          manufacturedAt: elaborado === null ? null : comoFechaDeBase(elaborado),
          createdById: entrada.userId,
        },
        select: { id: true },
      })
      lotId = creado.id
    }

    const cantidad = aCantidad(lote.quantity)
    const stockQuantity = cantidad.times(entrada.unitsPerPurchaseUnit)
    if (stockQuantity.lessThanOrEqualTo(CERO_C)) {
      throw invalid(`La partida ${lote.code} no aporta ninguna unidad al stock`)
    }

    partes.push({ lotId, code: lote.code.trim(), quantity: cantidad, stockQuantity })
  }

  // Por lotId ascendente antes de escribir: el orden de los bloqueos es parte
  // del contrato. Ver docs/LOT_TRACKING_DESIGN.md.
  return partes.sort((a, b) => a.lotId - b.lotId)
}
