/**
 * Registro y anulacion de ventas.
 *
 * Aca vive la regla de negocio, no en el route handler y mucho menos en un
 * componente de React. El navegador manda que producto y cuantas unidades;
 * todo lo demas lo decide el servidor.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { conflict, invalid, notFound } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'

export type PaymentMethod = 'efectivo' | 'tarjeta' | 'mercado_pago'

export interface SaleLineInput {
  productId: number
  quantity: number
}

/** Producto tal como se lee del catalogo para armar la venta. */
interface Catalogado {
  id: number
  name: string
  price: number
}

export interface CreateSaleInput {
  items: SaleLineInput[]
  paymentMethod: PaymentMethod
}

export interface CreatedSale {
  id: number
  total: number
  date: Date
  items: Array<{
    productId: number
    name: string
    quantity: number
    price: number
    subtotal: number
  }>
  paymentMethod: PaymentMethod
}

/**
 * El dinero se guarda en Float (deuda documentada, se migra a Decimal en la
 * fase 2). Mientras tanto, todo importe se redondea a dos decimales en el
 * mismo punto para que la suma de subtotales y el total no diverjan.
 */
function redondear(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Si el carrito trae el mismo producto en dos lineas, se suman.
 *
 * Importa: con dos lineas de 8 unidades y 10 en stock, comprobar linea por
 * linea da "hay stock" dos veces y el resultado final es -6.
 */
function consolidar(items: SaleLineInput[]): SaleLineInput[] {
  const porProducto = new Map<number, number>()
  for (const item of items) {
    porProducto.set(item.productId, (porProducto.get(item.productId) ?? 0) + item.quantity)
  }
  return (
    [...porProducto.entries()]
      .map(([productId, quantity]) => ({ productId, quantity }))
      // Orden estable por id: dos ventas simultaneas toman los bloqueos de fila
      // en el mismo orden y no pueden quedar en interbloqueo.
      .sort((a, b) => a.productId - b.productId)
  )
}

export async function createSale(session: Session, input: CreateSaleInput): Promise<CreatedSale> {
  const lineas = consolidar(input.items)
  const branchId = session.branchId

  return prisma.$transaction(
    async (tx) => {
      // 1) Los productos se leen de la base, filtrados por la sucursal de la
      //    sesion. Un producto de otra sucursal simplemente no aparece.
      const productos = await tx.product.findMany({
        where: { id: { in: lineas.map((l) => l.productId) }, branchId },
        select: { id: true, name: true, price: true },
      })

      // Cada linea se empareja con su producto una sola vez. A partir de aca
      // el flujo trabaja con pares ya resueltos, sin volver a consultar el
      // mapa y sin tener que afirmar que el resultado no es nulo.
      const porId = new Map(productos.map((p) => [p.id, p]))
      const pedido: Array<{ productId: number; quantity: number; producto: Catalogado }> = []
      const faltantes: number[] = []

      for (const linea of lineas) {
        const producto = porId.get(linea.productId)
        if (producto) pedido.push({ ...linea, producto })
        else faltantes.push(linea.productId)
      }

      if (faltantes.length > 0) {
        throw invalid(`Producto no disponible en esta sucursal: ${faltantes.join(', ')}`, {
          code: 'PRODUCT_NOT_IN_BRANCH',
        })
      }

      // 2) Descuento de stock condicional y atomico.
      //
      //    Una comprobacion previa seguida de un decremento NO alcanza: entre
      //    la lectura y la escritura otra venta puede llevarse las unidades.
      //    Este UPDATE comprueba y descuenta en la misma sentencia, y PostgreSQL
      //    reevalua la condicion despues de esperar el bloqueo de la fila.
      //    Si devuelve 0 filas, no habia stock suficiente.
      for (const linea of pedido) {
        const filas = await tx.$executeRaw`
          UPDATE "BranchStock"
          SET "quantity" = "quantity" - ${linea.quantity}
          WHERE "branchId" = ${branchId}
            AND "productId" = ${linea.productId}
            AND "quantity" >= ${linea.quantity}
        `

        if (filas !== 1) {
          const actual = await tx.branchStock.findUnique({
            where: { branchId_productId: { branchId, productId: linea.productId } },
            select: { quantity: true },
          })
          throw conflict(
            `Stock insuficiente de "${linea.producto.name}": se pidieron ${linea.quantity} y hay ${actual?.quantity ?? 0}`,
            { code: 'INSUFFICIENT_STOCK' },
          )
        }
      }

      // 3) Precios y total, siempre desde la base.
      const itemsConPrecio = pedido.map(({ producto, quantity }) => ({
        productId: producto.id,
        name: producto.name,
        quantity,
        price: producto.price,
        subtotal: redondear(producto.price * quantity),
      }))

      const total = redondear(itemsConPrecio.reduce((suma, i) => suma + i.subtotal, 0))

      // 4) Venta e items.
      const venta = await tx.sale.create({
        data: {
          userId: session.userId,
          branchId,
          items: {
            create: itemsConPrecio.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              price: i.price,
            })),
          },
        },
        select: { id: true, date: true },
      })

      // 5) Movimiento de caja vinculado por clave foranea, no por texto.
      await tx.cashRegisterMovement.create({
        data: {
          branchId,
          userId: session.userId,
          amount: total,
          paymentMethod: input.paymentMethod,
          description: `Venta #${venta.id}`,
          type: 'sale',
          saleId: venta.id,
        },
      })

      // 6) Solo el efectivo mueve el saldo en caja.
      //
      //    `increment` se traduce a `SET currentCash = currentCash + $1`, que
      //    es atomico. La version anterior leia el saldo, sumaba en JavaScript
      //    y escribia el resultado: dos ventas simultaneas leian el mismo
      //    valor y una de las dos se perdia.
      if (input.paymentMethod === 'efectivo') {
        await tx.branch.update({
          where: { id: branchId },
          data: { currentCash: { increment: total } },
        })
      }

      await audit(tx, {
        userId: session.userId,
        table: 'Sale',
        recordId: venta.id,
        action: 'create',
        after: {
          id: venta.id,
          branchId,
          total,
          paymentMethod: input.paymentMethod,
          items: itemsConPrecio,
        },
        origin: 'POST /api/sales',
      })

      return {
        id: venta.id,
        total,
        date: venta.date,
        items: itemsConPrecio,
        paymentMethod: input.paymentMethod,
      }
    },
    { timeout: 15_000, maxWait: 15_000 },
  )
}

export interface CancelResult {
  id: number
  status: 'canceled'
  restoredItems: number
  cashReversed: number
}

/**
 * Anulacion logica.
 *
 * No borra la venta ni sus items: los conserva y marca el estado. Un registro
 * financiero borrado no se puede auditar despues.
 */
export async function cancelSale(
  session: Session,
  saleId: number,
  reason: string,
): Promise<CancelResult> {
  const motivo = reason.trim()
  if (!motivo) throw invalid('El motivo de la anulacion es obligatorio')

  return prisma.$transaction(
    async (tx) => {
      const venta = await tx.sale.findUnique({
        where: { id: saleId },
        select: { id: true, branchId: true, status: true, userId: true, date: true },
      })

      if (!venta) throw notFound('La venta no existe')

      // Mismo trato que "no existe": no confirmamos que la venta exista en
      // otra sucursal.
      if (venta.branchId !== session.branchId) throw notFound('La venta no existe')

      // Marca de anulacion condicionada al estado actual. Si dos anulaciones
      // llegan a la vez, la segunda afecta 0 filas y se rechaza: el stock no
      // se restaura dos veces.
      const canceladas = await tx.$executeRaw`
        UPDATE "Sale"
        SET "status" = 'canceled',
            "canceledAt" = NOW(),
            "canceledById" = ${session.userId},
            "cancelReason" = ${motivo}
        WHERE "id" = ${saleId} AND "status" = 'completed'
      `

      if (canceladas !== 1) throw conflict('La venta ya estaba anulada')

      // Restauracion de stock, item por item.
      const items = await tx.saleItem.findMany({
        where: { saleId },
        select: { productId: true, quantity: true, price: true },
      })

      for (const item of [...items].sort((a, b) => a.productId - b.productId)) {
        await tx.$executeRaw`
          UPDATE "BranchStock"
          SET "quantity" = "quantity" + ${item.quantity}
          WHERE "branchId" = ${venta.branchId} AND "productId" = ${item.productId}
        `
      }

      // Reversion de caja: contramovimiento, no borrado del original.
      const originales = await tx.cashRegisterMovement.findMany({
        where: { saleId, type: 'sale' },
        select: { amount: true, paymentMethod: true },
      })

      let efectivoRevertido = 0

      for (const mov of originales) {
        await tx.cashRegisterMovement.create({
          data: {
            branchId: venta.branchId,
            userId: session.userId,
            amount: redondear(-mov.amount),
            paymentMethod: mov.paymentMethod,
            description: `Anulacion de venta #${saleId}: ${motivo}`,
            type: 'sale_cancel',
            saleId,
          },
        })

        if (mov.paymentMethod === 'efectivo') {
          efectivoRevertido = redondear(efectivoRevertido + mov.amount)
        }
      }

      if (efectivoRevertido !== 0) {
        await tx.branch.update({
          where: { id: venta.branchId },
          data: { currentCash: { decrement: efectivoRevertido } },
        })
      }

      await audit(tx, {
        userId: session.userId,
        table: 'Sale',
        recordId: saleId,
        action: 'cancel',
        before: { status: 'completed', items, vendedorId: venta.userId, fecha: venta.date },
        after: {
          status: 'canceled',
          motivo,
          anuladaPor: session.userId,
          efectivoRevertido,
        },
        origin: 'POST /api/sales/:id/cancel',
      })

      return {
        id: saleId,
        status: 'canceled' as const,
        restoredItems: items.length,
        cashReversed: efectivoRevertido,
      }
    },
    { timeout: 15_000, maxWait: 15_000 },
  )
}

/** Tipo del cliente dentro de una transaccion, reexportado por comodidad. */
export type TxClient = Prisma.TransactionClient
