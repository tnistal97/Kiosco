/**
 * Ajustes de inventario.
 *
 * Desde la Fase 3A este modulo NO escribe stock: se lo pide al servicio
 * central de inventario, que es el unico que toca `BranchStock` y el que deja
 * la fila en el libro. Aca queda lo que es propio del ajuste: comprobar que el
 * producto sea de la sucursal, exigir el motivo y convertir un recuento
 * ("quedan 30") en el delta que de verdad ocurrio ("+10").
 *
 * Ver docs/INVENTORY_LEDGER.md.
 */

import { prisma } from '@/lib/prisma'
import { invalid, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import type { AjusteAbsolutoInput, AjusteRelativoInput } from './schemas'
import type { Monto } from '@/lib/money'
import type { TextoCantidad } from '@/lib/cantidad'
import { aMonto } from '@/server/money'
import {
  aTextoCantidad,
  cantidad as aCantidad,
  esCeroCantidad,
  restarCantidades,
} from '@/server/cantidad'
import { applyStockMovement } from '@/modules/inventory/service'
import { estadoDeStock, type EstadoStock } from '@/modules/inventory/minimum'
import {
  formatearCantidadConUnidad,
  motivoDeCantidadInvalida,
  unidadDeVentaODefecto,
  type UnidadDeVenta,
} from '@/modules/products/units'

export interface StockDeProducto {
  id: number
  productId: number
  name: string
  barcode: string | null
  price: Monto
  category: { id: number; name: string }
  saleUnit: UnidadDeVenta
  quantity: TextoCantidad
  minimumStock: TextoCantidad
  /** OK | LOW | OUT. Calculado, nunca guardado. */
  estado: EstadoStock
}

export interface StockAjustado {
  productId: number
  quantity: TextoCantidad
  /** Lo que habia antes. La pantalla muestra "40 → 50", no solo "50". */
  previousQuantity: TextoCantidad
  movementId: number
}

/**
 * Comprueba que el producto exista Y pertenezca a la sucursal de la sesion, y
 * devuelve su unidad de venta.
 *
 * Devuelve 404, no 403, cuando es de otra sucursal: un 403 confirmaria que
 * el producto existe en algun lado, que ya es informacion.
 *
 * La unidad se lee aca y no en el servicio de inventario porque esta consulta
 * ya se hacia: sale gratis, y `applyStockMovement` la exige.
 */
async function unidadDelProductoDeLaSucursal(
  session: Session,
  productId: number,
): Promise<UnidadDeVenta> {
  const producto = await prisma.product.findFirst({
    where: { id: productId, branchId: session.branchId },
    select: { saleUnit: true },
  })
  if (!producto) throw notFound('Producto no encontrado')
  return unidadDeVentaODefecto(producto.saleUnit)
}

/** Rechaza `1.235` en un producto que se vende por unidad. */
function exigirCantidadDeLaUnidad(unidad: UnidadDeVenta, valor: TextoCantidad): void {
  const motivo = motivoDeCantidadInvalida(unidad, valor)
  if (motivo !== null) throw invalid(motivo)
}

export async function stockDe(session: Session, productId: number): Promise<StockDeProducto> {
  const producto = await prisma.product.findFirst({
    where: { id: productId, branchId: session.branchId },
    select: {
      id: true,
      name: true,
      price: true,
      saleUnit: true,
      minimumStock: true,
      category: { select: { id: true, name: true } },
      barcodes: { where: { isPrimary: true }, select: { code: true }, take: 1 },
    },
  })
  if (!producto) throw notFound('Producto no encontrado')

  const stock = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId: session.branchId, productId } },
    select: { quantity: true },
  })

  const quantity = stock === null ? '0.000' : aTextoCantidad(stock.quantity)
  const minimumStock = aTextoCantidad(producto.minimumStock)

  return {
    id: producto.id,
    productId: producto.id,
    name: producto.name,
    barcode: producto.barcodes[0]?.code ?? null,
    price: aMonto(producto.price),
    category: producto.category,
    saleUnit: unidadDeVentaODefecto(producto.saleUnit),
    quantity,
    minimumStock,
    estado: estadoDeStock(quantity, minimumStock),
  }
}

/**
 * Recuento de inventario: "quedan 30".
 *
 * Se convierte en el delta que de verdad ocurrio. Nunca se escribe "el stock
 * nuevo es 30" sin registrar como se llego: el libro guarda +10 o -4, con el
 * saldo anterior y el resultante.
 *
 * El delta se calcula DENTRO de la transaccion, contra el saldo real. Un
 * recuento sobre un producto que otra caja acaba de vender queda registrado
 * con los numeros que de verdad habia, no con los que la pantalla mostraba
 * hace treinta segundos.
 */
export async function fijarStock(
  session: Session,
  productId: number,
  input: AjusteAbsolutoInput,
): Promise<StockAjustado> {
  const saleUnit = await unidadDelProductoDeLaSucursal(session, productId)

  // Cero es un recuento valido --"no quedo nada"--, asi que solo se comprueba
  // el fraccionamiento cuando hay algo que contar.
  if (!esCeroCantidad(aCantidad(input.quantity))) {
    exigirCantidadDeLaUnidad(saleUnit, input.quantity)
  }

  return prisma.$transaction(async (tx) => {
    const antes = await tx.branchStock.findUnique({
      where: { branchId_productId: { branchId: session.branchId, productId } },
      select: { quantity: true },
    })

    const actual = antes?.quantity ?? aCantidad(0)
    const delta = restarCantidades(aCantidad(input.quantity), actual)

    if (esCeroCantidad(delta)) {
      throw invalid(
        `El recuento coincide con el stock actual ` +
          `(${formatearCantidadConUnidad(aTextoCantidad(actual), saleUnit)}): ` +
          'no hay nada que registrar',
      )
    }

    const resultado = await applyStockMovement(tx, {
      branchId: session.branchId,
      productId,
      // Un recuento es un ajuste, siempre. Las perdidas y roturas se declaran
      // por el otro camino, donde el usuario dice cuantas unidades y por que.
      type: 'MANUAL_ADJUSTMENT',
      quantity: delta,
      saleUnit,
      userId: session.userId,
      reason: input.reason,
      referenceType: 'BranchStock',
      referenceId: productId,
      audit: { origin: 'PUT /api/stock/:productId' },
    })

    return {
      productId,
      quantity: aTextoCantidad(resultado.resultingQuantity),
      previousQuantity: aTextoCantidad(resultado.previousQuantity),
      movementId: resultado.movementId,
    }
  })
}

/**
 * Ajuste relativo: "entraron 12", "se rompieron 0,750 kg".
 *
 * El tipo lo declara quien ajusta, y es el unico dato que despues permite
 * preguntar cuanto se rompio en el mes. Por omision es un ajuste generico:
 * obligar a clasificar cada correccion de carga como perdida seria mentir.
 */
export async function ajustarStock(
  session: Session,
  productId: number,
  input: AjusteRelativoInput,
): Promise<StockAjustado> {
  const saleUnit = await unidadDelProductoDeLaSucursal(session, productId)

  return prisma.$transaction(async (tx) => {
    const resultado = await applyStockMovement(tx, {
      branchId: session.branchId,
      productId,
      // La partida, cuando el producto la exige. `applyStockMovement` comprueba
      // que el lote sea de este producto y que la politica lo admita: no hace
      // falta repetirlo aca.
      lotId: input.lotId ?? null,
      type: input.type,
      quantity: aCantidad(input.delta),
      saleUnit,
      userId: session.userId,
      reason: input.reason,
      referenceType: 'BranchStock',
      referenceId: productId,
      audit: { origin: 'PATCH /api/stock/:productId' },
    })

    return {
      productId,
      quantity: aTextoCantidad(resultado.resultingQuantity),
      previousQuantity: aTextoCantidad(resultado.previousQuantity),
      movementId: resultado.movementId,
    }
  })
}
