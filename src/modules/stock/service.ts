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
import { aMonto } from '@/server/money'
import { applyStockMovement } from '@/modules/inventory/service'
import { estadoDeStock, type EstadoStock } from '@/modules/inventory/minimum'

export interface StockDeProducto {
  id: number
  productId: number
  name: string
  barcode: string | null
  price: Monto
  category: { id: number; name: string }
  quantity: number
  minimumStock: number
  /** OK | LOW | OUT. Calculado, nunca guardado. */
  estado: EstadoStock
}

export interface StockAjustado {
  productId: number
  quantity: number
  /** Lo que habia antes. La pantalla muestra "40 → 50", no solo "50". */
  previousQuantity: number
  movementId: number
}

/**
 * Comprueba que el producto exista Y pertenezca a la sucursal de la sesion.
 *
 * Devuelve 404, no 403, cuando es de otra sucursal: un 403 confirmaria que
 * el producto existe en algun lado, que ya es informacion.
 */
async function exigirProductoDeLaSucursal(session: Session, productId: number): Promise<void> {
  const producto = await prisma.product.findFirst({
    where: { id: productId, branchId: session.branchId },
    select: { id: true },
  })
  if (!producto) throw notFound('Producto no encontrado')
}

export async function stockDe(session: Session, productId: number): Promise<StockDeProducto> {
  const producto = await prisma.product.findFirst({
    where: { id: productId, branchId: session.branchId },
    select: {
      id: true,
      name: true,
      barcode: true,
      price: true,
      minimumStock: true,
      category: { select: { id: true, name: true } },
    },
  })
  if (!producto) throw notFound('Producto no encontrado')

  const stock = await prisma.branchStock.findUnique({
    where: { branchId_productId: { branchId: session.branchId, productId } },
    select: { quantity: true },
  })

  const quantity = stock?.quantity ?? 0

  return {
    ...producto,
    price: aMonto(producto.price),
    productId: producto.id,
    quantity,
    estado: estadoDeStock(quantity, producto.minimumStock),
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
  await exigirProductoDeLaSucursal(session, productId)

  return prisma.$transaction(async (tx) => {
    const antes = await tx.branchStock.findUnique({
      where: { branchId_productId: { branchId: session.branchId, productId } },
      select: { quantity: true },
    })

    const actual = antes?.quantity ?? 0
    const delta = input.quantity - actual

    if (delta === 0) {
      throw invalid(
        `El recuento coincide con el stock actual (${actual}): no hay nada que registrar`,
      )
    }

    const resultado = await applyStockMovement(tx, {
      branchId: session.branchId,
      productId,
      // Un recuento es un ajuste, siempre. Las perdidas y roturas se declaran
      // por el otro camino, donde el usuario dice cuantas unidades y por que.
      type: 'MANUAL_ADJUSTMENT',
      quantity: delta,
      userId: session.userId,
      reason: input.reason,
      referenceType: 'BranchStock',
      referenceId: productId,
      audit: { origin: 'PUT /api/stock/:productId' },
    })

    return {
      productId,
      quantity: resultado.resultingQuantity,
      previousQuantity: resultado.previousQuantity,
      movementId: resultado.movementId,
    }
  })
}

/**
 * Ajuste relativo: "entraron 12", "se rompieron 3".
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
  await exigirProductoDeLaSucursal(session, productId)

  return prisma.$transaction(async (tx) => {
    const resultado = await applyStockMovement(tx, {
      branchId: session.branchId,
      productId,
      type: input.type,
      quantity: input.delta,
      userId: session.userId,
      reason: input.reason,
      referenceType: 'BranchStock',
      referenceId: productId,
      audit: { origin: 'PATCH /api/stock/:productId' },
    })

    return {
      productId,
      quantity: resultado.resultingQuantity,
      previousQuantity: resultado.previousQuantity,
      movementId: resultado.movementId,
    }
  })
}
