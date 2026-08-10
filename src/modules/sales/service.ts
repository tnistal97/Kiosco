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
import type { Monto } from '@/lib/money'
import {
  CERO_D,
  aMonto,
  absoluto,
  comparar,
  dinero,
  esCero,
  esNegativo,
  multiplicar,
  negar,
  redondearPesos,
  restar,
  sumar,
  type Dinero,
} from '@/server/money'
import type { TextoCantidad } from '@/lib/cantidad'
import {
  aTextoCantidad,
  cantidad as aCantidad,
  negarCantidad,
  sumarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import {
  motivoDeCantidadInvalida,
  unidadDeVentaODefecto,
  type UnidadDeVenta,
} from '@/modules/products/units'
import { esEfectivo, etiquetaDeMedio, normalizarMedio, type MedioDePago } from './payment-methods'
import type { PagoInput } from './schemas'
import { turnoAbiertoDe, turnoParaOperar } from '@/modules/cash/service.turnos'
import { applyStockMovement } from '@/modules/inventory/service'

export interface SaleLineInput {
  productId: number
  quantity: TextoCantidad
}

/** Un pago ya resuelto: con su importe y su vuelto calculados por el servidor. */
interface PagoResuelto {
  method: MedioDePago
  amount: Dinero
  cashReceived: Dinero | null
  changeGiven: Dinero | null
  reference: string | null
}

/**
 * Convierte lo que llego en la peticion en pagos comprobados.
 *
 * Dos formas de entrada, una sola salida:
 *
 *   `payments`       la forma nueva. Uno o varios, y su suma tiene que ser
 *                    EXACTAMENTE el total.
 *   `paymentMethod`  la forma anterior a la Fase 3, un solo medio. Se
 *                    convierte en un unico pago por el total.
 *
 * El vuelto lo calcula esta funcion, no el cliente: mandarlo permitiria
 * declarar un vuelto que no coincide con la cuenta.
 */
function resolverPagos(input: CreateSaleInput, total: Dinero): PagoResuelto[] {
  if (!input.payments || input.payments.length === 0) {
    const method = normalizarMedio(input.paymentMethod ?? 'CASH')
    return [{ method, amount: total, cashReceived: null, changeGiven: null, reference: null }]
  }

  const pagos = input.payments.map((p) => {
    const amount = dinero(p.amount)
    const recibido = p.cashReceived === undefined ? null : dinero(p.cashReceived)

    if (recibido !== null && comparar(recibido, amount) < 0) {
      throw invalid(
        `Se recibieron ${aMonto(recibido)} para un pago de ${aMonto(amount)}: falta plata`,
        undefined,
        { code: 'PAYMENTS_DO_NOT_MATCH_TOTAL' },
      )
    }

    return {
      method: p.method,
      amount,
      cashReceived: recibido,
      changeGiven: recibido === null ? null : restar(recibido, amount),
      reference: p.reference ?? null,
    }
  })

  const sumaDePagos = sumar(...pagos.map((p) => p.amount))
  if (comparar(sumaDePagos, total) !== 0) {
    const falta = restar(total, sumaDePagos)
    throw invalid(
      esNegativo(falta)
        ? `Los pagos suman ${aMonto(sumaDePagos)} y el total es ${aMonto(total)}: sobran ${aMonto(absoluto(falta))}`
        : `Los pagos suman ${aMonto(sumaDePagos)} y el total es ${aMonto(total)}: faltan ${aMonto(falta)}`,
      undefined,
      { code: 'PAYMENTS_DO_NOT_MATCH_TOTAL' },
    )
  }

  return pagos
}

/** Producto tal como se lee del catalogo para armar la venta. */
interface Catalogado {
  id: number
  name: string
  price: Dinero
  /** Para congelarlo en la linea. NUNCA sale hacia la respuesta. */
  cost: Dinero | null
  saleUnit: string
}

export interface CreateSaleInput {
  items: SaleLineInput[]
  /** Forma nueva: uno o varios pagos que suman el total. */
  payments?: PagoInput[]
  /** Forma anterior a la Fase 3: un solo medio para toda la venta. */
  paymentMethod?: string
}

/**
 * Lo que sale hacia la API.
 *
 * Los importes viajan como cadena decimal, no como numero: un numero de JSON
 * es un `double` de IEEE 754 y devolveria el importe al tipo del que acabamos
 * de sacarlo. Ver docs/PHASE3_MONEY_MIGRATION.md.
 */
export interface CreatedSale {
  id: number
  total: Monto
  date: Date
  items: Array<{
    productId: number
    name: string
    quantity: TextoCantidad
    /** La unidad en la que se vendio. Sin ella, `0.425` no dice nada. */
    saleUnit: UnidadDeVenta
    price: Monto
    subtotal: Monto
  }>
  payments: Array<{
    method: MedioDePago
    /** Nombre para mostrar: "Efectivo", "Débito"… El codigo no se muestra. */
    label: string
    amount: Monto
    cashReceived: Monto | null
    changeGiven: Monto | null
    reference: string | null
  }>
  /** Lo que de verdad entro al cajon. Cero si no hubo efectivo. */
  cashCollected: Monto
  /** Vuelto total. Cero cuando se pago justo o no hubo efectivo. */
  changeGiven: Monto
}

/**
 * Si el carrito trae el mismo producto en dos lineas, se suman.
 *
 * Importa: con dos lineas de 8 unidades y 10 en stock, comprobar linea por
 * linea da "hay stock" dos veces y el resultado final es -6.
 */
function consolidar(items: SaleLineInput[]): Array<{ productId: number; quantity: Cantidad }> {
  const porProducto = new Map<number, Cantidad>()
  for (const item of items) {
    const acumulado = porProducto.get(item.productId)
    const cantidad = aCantidad(item.quantity)
    porProducto.set(item.productId, acumulado ? sumarCantidades(acumulado, cantidad) : cantidad)
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
      // 0) La caja tiene que estar abierta, si la sucursal lo exige.
      //
      //    Va PRIMERO, antes de tocar el stock: rechazar una venta despues de
      //    haber descontado unidades obligaria a devolverlas, y en una
      //    transaccion que despues falla eso es facil de creer y dificil de
      //    comprobar. Ver docs/CASH_SHIFT_MODEL.md.
      const turno = await turnoParaOperar(tx, branchId)

      // 1) Los productos se leen de la base, filtrados por la sucursal de la
      //    sesion. Un producto de otra sucursal simplemente no aparece.
      //    `cost` se lee para CONGELARLO en la linea, no para mostrarlo: no
      //    sale hacia ninguna respuesta de esta operacion --la caja nunca ve
      //    el costo, tenga o no el permiso-- y se guarda tal cual, con NULL
      //    cuando el producto no lo tiene cargado.
      const productos = await tx.product.findMany({
        where: { id: { in: lineas.map((l) => l.productId) }, branchId },
        select: { id: true, name: true, price: true, cost: true, saleUnit: true },
      })

      // Cada linea se empareja con su producto una sola vez. A partir de aca
      // el flujo trabaja con pares ya resueltos, sin volver a consultar el
      // mapa y sin tener que afirmar que el resultado no es nulo.
      const porId = new Map(productos.map((p) => [p.id, p]))
      const pedido: Array<{ productId: number; quantity: Cantidad; producto: Catalogado }> = []
      const faltantes: number[] = []

      for (const linea of lineas) {
        const producto = porId.get(linea.productId)
        if (producto) pedido.push({ ...linea, producto })
        else faltantes.push(linea.productId)
      }

      if (faltantes.length > 0) {
        // El tercer argumento es el que lleva el codigo; el segundo son los
        // detalles de validacion. Escrito en el segundo, el error salia con
        // codigo generico `VALIDATION` y el cliente no podia distinguirlo.
        throw invalid(
          `Producto no disponible en esta sucursal: ${faltantes.join(', ')}`,
          undefined,
          { code: 'PRODUCT_NOT_IN_BRANCH' },
        )
      }

      // 1 bis) La cantidad tiene que tener sentido para la unidad del producto.
      //
      //    `1.235` unidades no existe. Se comprueba DESPUES de emparejar
      //    porque hasta aca no se sabia en que unidad se vende cada linea, y
      //    ANTES de tocar el stock para que el rechazo no deje nada a medias.
      //
      //    `applyStockMovement` vuelve a comprobarlo --es la unica puerta y no
      //    confia en quien la llama--; esto adelanta el mensaje al usuario con
      //    el nombre del producto adentro.
      for (const linea of pedido) {
        const unidad = unidadDeVentaODefecto(linea.producto.saleUnit)
        const motivo = motivoDeCantidadInvalida(unidad, aTextoCantidad(linea.quantity))
        if (motivo !== null) {
          throw invalid(`${linea.producto.name}: ${motivo}`, undefined, {
            code: 'INVALID_QUANTITY_FOR_UNIT',
          })
        }
      }

      // 2) Precios y total, siempre desde la base y siempre en Decimal.
      //
      //    El subtotal se redondea a dos decimales porque es una linea del
      //    ticket --se puede leer y se puede cobrar--. El total es la suma de
      //    subtotales ya redondeados: asi el ticket cierra con lo que muestra,
      //    linea por linea. Sumar exacto y redondear al final daria un total
      //    que no coincide con la suma de lo que el cliente ve.
      //
      //    La multiplicacion es `Decimal × Decimal`: precio por cantidad, los
      //    dos exactos. Con 0,425 kg a $9.800 el subtotal da $4.165,00 y no
      //    $4.164,999999, que es lo que devolveria la misma cuenta en punto
      //    flotante.
      const itemsConPrecio = pedido.map(({ producto, quantity }) => ({
        productId: producto.id,
        name: producto.name,
        quantity,
        saleUnit: unidadDeVentaODefecto(producto.saleUnit),
        price: producto.price,
        // El costo del producto EN ESTE MOMENTO. Se congela junto con el
        // precio y por el mismo motivo: la rentabilidad de esta venta es un
        // hecho de hoy y no puede cambiar porque manana llegue mercaderia mas
        // cara. `null` cuando no se sabe, nunca cero.
        costAtSale: producto.cost,
        subtotal: redondearPesos(multiplicar(producto.price, quantity)),
      }))

      const total = sumar(...itemsConPrecio.map((i) => i.subtotal))

      // 3) Los pagos, comprobados contra el total.
      //
      //    Es LA regla de la entidad: la suma de los pagos es EXACTAMENTE el
      //    total. No "aproximadamente": exactamente. Por eso el dinero se
      //    migro a Decimal antes que esto.
      const pagos = resolverPagos(input, total)

      // 4) Venta, items y pagos, en una sola escritura.
      const venta = await tx.sale.create({
        data: {
          userId: session.userId,
          branchId,
          total,
          items: {
            create: itemsConPrecio.map((i) => ({
              productId: i.productId,
              quantity: i.quantity,
              price: i.price,
              costAtSale: i.costAtSale,
            })),
          },
          payments: {
            create: pagos.map((p) => ({
              method: p.method,
              amount: p.amount,
              cashReceived: p.cashReceived,
              changeGiven: p.changeGiven,
              reference: p.reference,
            })),
          },
        },
        select: { id: true, date: true },
      })

      // 5) El stock, por el libro de inventario.
      //
      //    Ya no hay un UPDATE aca: lo aplica `applyStockMovement`, que es el
      //    unico lugar de todo `src/` autorizado a escribir sobre BranchStock.
      //    Sigue siendo condicional y atomico --comprueba, descuenta y dice
      //    cuanto habia, en una sola sentencia-- y ademas deja la fila del
      //    libro con el saldo anterior y el resultante.
      //
      //    Va DESPUES de crear la venta porque el movimiento la referencia:
      //    sin el id, el historial diria "-2" sin decir por que. Si el stock
      //    no alcanza, la transaccion entera se deshace y la venta no queda.
      //
      //    El orden por id de producto viene de `consolidar` y no es
      //    cosmetico: dos ventas simultaneas toman los bloqueos de fila en el
      //    mismo orden y por lo tanto no pueden quedar en interbloqueo.
      //
      //    Sin auditoria propia: la venta ya se audita entera unas lineas mas
      //    abajo. Ver docs/INVENTORY_LEDGER.md, seccion 6.
      for (const linea of pedido) {
        await applyStockMovement(tx, {
          branchId,
          productId: linea.productId,
          type: 'SALE',
          quantity: negarCantidad(linea.quantity),
          saleUnit: unidadDeVentaODefecto(linea.producto.saleUnit),
          userId: session.userId,
          referenceType: 'Sale',
          referenceId: venta.id,
        })
      }

      // 6) La caja recibe SOLO el efectivo.
      //
      //    Una venta de $30.000 cobrada $20.000 por transferencia y $10.000 en
      //    efectivo aumenta el cajon en $10.000. Es el caso que da sentido a
      //    todo el objetivo, y tiene su prueba.
      //
      //    Se crea UN movimiento por medio, no uno por venta: asi el listado
      //    de caja muestra como se cobro de verdad, y el esperado del turno
      //    suma exactamente lo que entro.
      for (const pago of pagos) {
        await tx.cashRegisterMovement.create({
          data: {
            branchId,
            userId: session.userId,
            amount: pago.amount,
            paymentMethod: pago.method,
            description: `Venta #${venta.id}`,
            type: 'sale',
            saleId: venta.id,
            shiftId: turno?.id ?? null,
          },
        })
      }

      const enEfectivo = sumar(...pagos.filter((p) => esEfectivo(p.method)).map((p) => p.amount))

      //    `increment` se traduce a `SET currentCash = currentCash + $1`, que
      //    es atomico. La version anterior leia el saldo, sumaba en JavaScript
      //    y escribia el resultado: dos ventas simultaneas leian el mismo
      //    valor y una de las dos se perdia.
      if (!esCero(enEfectivo)) {
        await tx.branch.update({
          where: { id: branchId },
          data: { currentCash: { increment: enEfectivo } },
        })
      }

      // La bitacora guarda los importes como cadena, igual que la API: un
      // JSON con `4850.000000001` adentro seria una prueba documental de algo
      // que nunca paso.
      const itemsParaMostrar = itemsConPrecio.map((i) => ({
        productId: i.productId,
        name: i.name,
        quantity: aTextoCantidad(i.quantity),
        saleUnit: i.saleUnit,
        price: aMonto(i.price),
        subtotal: aMonto(i.subtotal),
      }))

      const pagosParaMostrar = pagos.map((p) => ({
        method: p.method,
        label: etiquetaDeMedio(p.method),
        amount: aMonto(p.amount),
        cashReceived: p.cashReceived === null ? null : aMonto(p.cashReceived),
        changeGiven: p.changeGiven === null ? null : aMonto(p.changeGiven),
        reference: p.reference,
      }))

      const vuelto = sumar(...pagos.map((p) => p.changeGiven ?? CERO_D))

      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Sale',
        recordId: venta.id,
        action: 'create',
        after: {
          id: venta.id,
          branchId,
          turno: turno?.id ?? null,
          total: aMonto(total),
          pagos: pagosParaMostrar,
          enEfectivo: aMonto(enEfectivo),
          items: itemsParaMostrar,
        },
        origin: 'POST /api/sales',
      })

      return {
        id: venta.id,
        total: aMonto(total),
        date: venta.date,
        items: itemsParaMostrar,
        payments: pagosParaMostrar,
        cashCollected: aMonto(enEfectivo),
        changeGiven: aMonto(vuelto),
      }
    },
    { timeout: 15_000, maxWait: 15_000 },
  )
}

export interface CancelResult {
  id: number
  status: 'canceled'
  restoredItems: number
  cashReversed: Monto
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

      // Restauracion de stock, item por item, por el libro de inventario.
      //
      // El movimiento inverso NO edita ni borra el SALE original: lo deja
      // donde esta y agrega su opuesto. En el historial del producto se lee
      // exactamente lo que paso:
      //
      //   Venta #123          -2   38 → 36
      //   Anulacion venta #123 +2   36 → 38
      const items = await tx.saleItem.findMany({
        where: { saleId },
        select: {
          productId: true,
          quantity: true,
          price: true,
          product: { select: { saleUnit: true } },
        },
      })

      for (const item of [...items].sort((a, b) => a.productId - b.productId)) {
        await applyStockMovement(tx, {
          branchId: venta.branchId,
          productId: item.productId,
          type: 'SALE_CANCEL',
          // La cantidad EXACTA que se vendio, leida de la linea. Restaurar
          // 0,425 kg devuelve 0,425 kg: sin recalcular y sin redondear.
          quantity: item.quantity,
          saleUnit: unidadDeVentaODefecto(item.product.saleUnit),
          userId: session.userId,
          reason: motivo,
          referenceType: 'Sale',
          referenceId: saleId,
        })
      }

      // Reversion de caja: contramovimiento, no borrado del original.
      const originales = await tx.cashRegisterMovement.findMany({
        where: { saleId, type: 'sale' },
        select: { amount: true, paymentMethod: true },
      })

      let efectivoRevertido: Dinero = CERO_D

      // El contramovimiento se cuelga del turno ABIERTO AHORA, no del turno en
      // el que se hizo la venta. Es lo correcto: la plata sale del cajon de
      // quien esta atendiendo hoy, no del de anteayer. Si el turno original ya
      // cerro, su diferencia no se toca --un turno cerrado es inmutable-- y la
      // devolucion aparece como egreso del turno actual.
      const turnoActivo = await turnoAbiertoDe(tx, venta.branchId)

      for (const mov of originales) {
        await tx.cashRegisterMovement.create({
          data: {
            branchId: venta.branchId,
            userId: session.userId,
            // El contramovimiento es el opuesto EXACTO del original, no un
            // importe recalculado: asi la suma de los dos da cero sin residuo.
            amount: negar(mov.amount),
            paymentMethod: mov.paymentMethod,
            description: `Anulacion de venta #${saleId}: ${motivo}`,
            type: 'sale_cancel',
            saleId,
            shiftId: turnoActivo?.id ?? null,
          },
        })

        if (esEfectivo(mov.paymentMethod)) {
          efectivoRevertido = sumar(efectivoRevertido, mov.amount)
        }
      }

      if (!esCero(efectivoRevertido)) {
        await tx.branch.update({
          where: { id: venta.branchId },
          data: { currentCash: { decrement: efectivoRevertido } },
        })
      }

      await audit(tx, {
        userId: session.userId,
        branchId: session.branchId,
        table: 'Sale',
        recordId: saleId,
        action: 'cancel',
        reason: motivo,
        before: {
          status: 'completed',
          items: items.map((i) => ({
            productId: i.productId,
            quantity: aTextoCantidad(i.quantity),
            unidad: unidadDeVentaODefecto(i.product.saleUnit),
            price: aMonto(i.price),
          })),
          vendedorId: venta.userId,
          fecha: venta.date,
        },
        after: {
          status: 'canceled',
          motivo,
          anuladaPor: session.userId,
          efectivoRevertido: aMonto(efectivoRevertido),
        },
        origin: 'POST /api/sales/:id/cancel',
      })

      return {
        id: saleId,
        status: 'canceled' as const,
        restoredItems: items.length,
        cashReversed: aMonto(efectivoRevertido),
      }
    },
    { timeout: 15_000, maxWait: 15_000 },
  )
}

/** Tipo del cliente dentro de una transaccion, reexportado por comodidad. */
export type TxClient = Prisma.TransactionClient
