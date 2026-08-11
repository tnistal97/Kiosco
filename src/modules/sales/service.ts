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
import { conflict, forbidden, invalid, notFound } from '@/server/http/errors'
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
  esCeroCantidad,
  negarCantidad,
  restarCantidades,
  sumarCantidades,
  type Cantidad,
} from '@/server/cantidad'
import {
  motivoDeCantidadInvalida,
  unidadDeVentaODefecto,
  type UnidadDeVenta,
} from '@/modules/products/units'
import {
  MEDIO_CUENTA,
  esCuenta,
  esEfectivo,
  etiquetaDeMedio,
  normalizarMedio,
  type MedioDePago,
} from './payment-methods'
import type { PagoInput } from './schemas'
import { turnoAbiertoDe, turnoParaOperar } from '@/modules/cash/service.turnos'
import { applyStockMovement } from '@/modules/inventory/service'
import { applyAccountMovement, autorizanteDelLimite } from '@/modules/clients/cuenta'
import { resolverSalida } from '@/modules/lots/salida'
import { politicaDeLoteODefecto } from '@/modules/lots/politicas'
import type { LineaDeReparto } from '@/modules/lots/fefo'
import { hoyEnSucursal } from '@/server/tiempo'

export interface SaleLineInput {
  productId: number
  quantity: TextoCantidad
  /**
   * Reparto por lote DECLARADO. Fase 4D. Opcional y raro.
   *
   * Sin esto --que es el flujo normal-- el servidor reparte por FEFO. Con esto
   * exige `lots.adjust`. Ver docs/FEFO_POLICY.md.
   */
  lots?: Array<{ lotId: number; quantity: TextoCantidad }>
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
  /** NONE | OPTIONAL | REQUIRED. Fase 4D. */
  lotTracking: string
}

export interface CreateSaleInput {
  items: SaleLineInput[]
  /** Forma nueva: uno o varios pagos que suman el total. */
  payments?: PagoInput[]
  /** Forma anterior a la Fase 3: un solo medio para toda la venta. */
  paymentMethod?: string
  /**
   * A quien se le vende. Opcional, y va a seguir siendolo.
   *
   * Una venta al mostrador no lo necesita: obligar a identificar a todo
   * comprador convertiria la venta rapida en un tramite. La UNICA excepcion la
   * impone el servidor unas lineas mas abajo: con una linea `ACCOUNT` el
   * cliente pasa a ser obligatorio, porque una deuda sin deudor no se cobra.
   */
  clientId?: number
  /**
   * Autorizacion explicita para fiar por encima del limite de credito.
   *
   * No alcanza con mandarlo: exige `accounts.overrideLimit`, y queda guardado
   * QUIEN autorizo en la fila del libro, no solo en la bitacora.
   */
  autorizarExcesoDeCredito?: boolean
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
  /**
   * Lo que quedo a cuenta, y como quedo el cliente. Null en una venta cobrada.
   *
   * Va en la respuesta y no solo en la base porque es lo que hay que mostrarle
   * a quien atiende en el momento: "Juan queda debiendo $32.000". Sin esto,
   * confirmar una venta fiada no diria nada distinto de confirmar una cobrada.
   */
  account: {
    clientId: number
    clientName: string
    /** Lo que se cargo a la cuenta en ESTA venta. */
    charged: Monto
    previousBalance: Monto
    resultingBalance: Monto
    /**
     * Cuanto del cargo se absorbio con saldo a favor que el cliente ya tenia.
     *
     * `"0.00"` en el caso normal. Cuando es distinto de cero, la venta no
     * genero toda esa deuda: parte salio del credito que el cliente tenia.
     */
    creditApplied: Monto
    /** Verdadero cuando hizo falta autorizar el exceso de limite. */
    limitOverridden: boolean
  } | null
}

/**
 * Si el carrito trae el mismo producto en dos lineas, se suman.
 *
 * Importa: con dos lineas de 8 unidades y 10 en stock, comprobar linea por
 * linea da "hay stock" dos veces y el resultado final es -6.
 */
function consolidar(
  items: SaleLineInput[],
): Array<{ productId: number; quantity: Cantidad; lots?: LineaDeReparto[] }> {
  const porProducto = new Map<number, Cantidad>()
  // El reparto declarado se consolida igual que la cantidad, y por el mismo
  // motivo: dos lineas del mismo producto que eligen la misma partida tienen
  // que sumar, no pisarse.
  const lotesPorProducto = new Map<number, Map<number, Cantidad>>()

  for (const item of items) {
    const acumulado = porProducto.get(item.productId)
    const cantidad = aCantidad(item.quantity)
    porProducto.set(item.productId, acumulado ? sumarCantidades(acumulado, cantidad) : cantidad)

    if (item.lots !== undefined) {
      const mapa = lotesPorProducto.get(item.productId) ?? new Map<number, Cantidad>()
      for (const l of item.lots) {
        const previo = mapa.get(l.lotId)
        const c = aCantidad(l.quantity)
        mapa.set(l.lotId, previo ? sumarCantidades(previo, c) : c)
      }
      lotesPorProducto.set(item.productId, mapa)
    }
  }

  return (
    [...porProducto.entries()]
      .map(([productId, quantity]) => {
        const mapa = lotesPorProducto.get(productId)
        return {
          productId,
          quantity,
          ...(mapa === undefined
            ? {}
            : { lots: [...mapa.entries()].map(([lotId, q]) => ({ lotId, quantity: q })) }),
        }
      })
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
        select: {
          id: true,
          name: true,
          price: true,
          cost: true,
          saleUnit: true,
          // Fase 4D. Se lee siempre --cuesta una columna en una consulta que ya
          // se hacia-- y decide si esta linea necesita elegir partida.
          lotTracking: true,
        },
      })

      // Cada linea se empareja con su producto una sola vez. A partir de aca
      // el flujo trabaja con pares ya resueltos, sin volver a consultar el
      // mapa y sin tener que afirmar que el resultado no es nulo.
      const porId = new Map(productos.map((p) => [p.id, p]))
      const pedido: Array<{
        productId: number
        quantity: Cantidad
        lots?: LineaDeReparto[]
        producto: Catalogado
      }> = []
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
      //
      //    Desde la Fase 4A una de esas lineas puede ser `ACCOUNT`, y la regla
      //    NO se relaja para permitirlo: el fiado CUBRE parte del total, asi
      //    que la suma sigue dando exacto. Lo que cambia es a donde va cada
      //    linea --el efectivo al cajon, la cuenta al libro del cliente-- y eso
      //    se resuelve en los pasos 6 y 7.
      const pagos = resolverPagos(input, total)

      // 3 bis) Fiar exige cliente, y exige permiso.
      //
      //    Es LA regla del objetivo 2, y la impone el servidor: una venta al
      //    mostrador no necesita cliente, pero una deuda sin deudor no se puede
      //    cobrar. Se comprueba ANTES de tocar el stock para que el rechazo no
      //    deje nada a medias.
      const aCuenta = sumar(...pagos.filter((p) => esCuenta(p.method)).map((p) => p.amount))
      const hayFiado = !esCero(aCuenta)

      if (hayFiado && input.clientId === undefined) {
        throw invalid('Una venta con saldo a cuenta necesita un cliente.', undefined, {
          code: 'ACCOUNT_SALE_NEEDS_CLIENT',
        })
      }
      if (hayFiado && !session.permissions.has('accounts.charge')) {
        throw forbidden('No tiene permiso para vender a cuenta')
      }

      // El autorizante del exceso de limite. Comprueba el permiso aunque
      // despues no haga falta usarlo: pedir una autorizacion que no se tiene es
      // un rechazo, no algo que se ignore en silencio.
      const autorizante = autorizanteDelLimite(session, input.autorizarExcesoDeCredito === true)

      // El cliente se lee aca --dentro de la transaccion y acotado a la
      // sucursal-- porque su nombre entra en la respuesta y en la bitacora, y
      // porque un id de otra sucursal no puede quedar asociado a esta venta.
      const cliente =
        input.clientId === undefined
          ? null
          : await tx.client.findFirst({
              where: { id: input.clientId, branchId },
              select: { id: true, name: true },
            })

      if (input.clientId !== undefined && !cliente) throw notFound('El cliente no existe')

      // 4) Venta, items y pagos, en una sola escritura.
      const venta = await tx.sale.create({
        data: {
          userId: session.userId,
          branchId,
          clientId: cliente?.id ?? null,
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
        // Los items vuelven con su id desde la Fase 4D: son la clave foranea de
        // `SaleItemLotAllocation`, y pedirlos aca sale gratis --la fila ya se
        // escribio-- mientras que releerlos despues seria una consulta mas.
        select: { id: true, date: true, items: { select: { id: true, productId: true } } },
      })

      const itemsCreados = new Map(venta.items.map((i) => [i.productId, i.id]))

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
      //
      //    Fase 4D: cuando el producto tiene lotes, la linea puede salir de
      //    varias partidas. `SaleItem.quantity` NO se parte --el cliente compro
      //    cinco yogures, no tres de una cosa y dos de otra-- y el reparto queda
      //    en `SaleItemLotAllocation`, que es lo que despues lee la anulacion.
      //
      //    `resolverSalida` devuelve una sola linea sin lote para todo producto
      //    con `lotTracking = NONE`, que es el catalogo entero: ni una consulta
      //    de mas en el camino de siempre.
      const conLotes = pedido.some((l) => politicaDeLoteODefecto(l.producto.lotTracking) !== 'NONE')
      const hoy = conLotes ? await hoyEnSucursal(tx, branchId) : ''

      for (const linea of pedido) {
        if (linea.lots !== undefined && !session.permissions.has('lots.adjust')) {
          throw forbidden('No tenés permiso para elegir el lote a mano')
        }

        const salida = await resolverSalida(tx, {
          branchId,
          producto: {
            id: linea.productId,
            name: linea.producto.name,
            saleUnit: unidadDeVentaODefecto(linea.producto.saleUnit),
            lotTracking: linea.producto.lotTracking,
          },
          quantity: linea.quantity,
          hoy,
          manual: linea.lots,
        })

        const item = itemsCreados.get(linea.productId)

        for (const parte of salida) {
          await applyStockMovement(tx, {
            branchId,
            productId: linea.productId,
            lotId: parte.lotId,
            type: 'SALE',
            quantity: negarCantidad(parte.quantity),
            saleUnit: unidadDeVentaODefecto(linea.producto.saleUnit),
            userId: session.userId,
            referenceType: 'Sale',
            referenceId: venta.id,
          })

          if (parte.lotId !== null && item !== undefined) {
            await tx.saleItemLotAllocation.create({
              data: { saleItemId: item, lotId: parte.lotId, quantity: parte.quantity },
            })
          }
        }
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
      //
      //    `ACCOUNT` queda AFUERA, y no es un detalle: un cargo a cuenta no es
      //    plata que cambio de manos, es una promesa. Anotarlo en la caja haria
      //    que el listado del turno muestre dinero que nadie recibio. Cada
      //    linea de pago va a exactamente uno de dos destinos, y hay una
      //    reconciliacion por cada destino.
      for (const pago of pagos.filter((p) => !esCuenta(p.method))) {
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

      // 7) Lo fiado va al libro del cliente.
      //
      //    UN movimiento por venta, no uno por linea: la venta cargo un importe
      //    a la cuenta, y partirlo en dos porque el ticket tenia dos lineas
      //    `ACCOUNT` no diria nada mas.
      //
      //    Va DESPUES de la caja para que el orden de los bloqueos sea siempre
      //    el mismo, y es aca donde se comprueba el limite de credito: dentro
      //    de la transaccion y en la misma sentencia que mueve el saldo, que es
      //    lo unico que impide que dos cajas simultaneas se pasen entre las
      //    dos. Ver docs/CUSTOMER_ACCOUNT_LEDGER.md.
      let cuenta: CreatedSale['account'] = null

      if (hayFiado && cliente) {
        const movimiento = await applyAccountMovement(tx, {
          branchId,
          clientId: cliente.id,
          type: 'SALE_CHARGE',
          amount: aCuenta,
          userId: session.userId,
          saleId: venta.id,
          authorizedById: autorizante,
        })

        cuenta = {
          clientId: cliente.id,
          clientName: cliente.name,
          charged: aMonto(aCuenta),
          previousBalance: aMonto(movimiento.previousBalance),
          resultingBalance: aMonto(movimiento.resultingBalance),
          creditApplied: aMonto(movimiento.creditoAplicado),
          limitOverridden: autorizante !== null,
        }
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
          // El cliente y lo fiado, cuando los hubo. La bitacora NO repite el
          // movimiento del libro: guarda quien hizo la venta y a quien se le
          // fio; el movimiento con sus saldos vive en
          // `CustomerAccountMovement`, que es su responsabilidad.
          clientId: cliente?.id ?? null,
          cliente: cliente?.name ?? null,
          aCuenta: cuenta === null ? null : cuenta.charged,
          limiteAutorizadoPor: autorizante,
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
        account: cuenta,
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
  /**
   * Lo que se devolvio a la cuenta del cliente. Null si la venta no tenia
   * parte fiada.
   *
   * `resultingBalance` puede quedar NEGATIVO, y ese es el caso importante: si
   * el cliente ya habia pagado parte de lo que se le fio, al anular la venta
   * esa plata pasa a estar a su favor. Ver docs/CUSTOMER_ACCOUNT_LEDGER.md.
   */
  account: {
    clientId: number
    clientName: string
    reverted: Monto
    previousBalance: Monto
    resultingBalance: Monto
    /** Cuanto le queda a favor al cliente. `"0.00"` si no le queda nada. */
    saldoAFavor: Monto
  } | null
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
        select: {
          id: true,
          branchId: true,
          status: true,
          userId: true,
          date: true,
          clientId: true,
          client: { select: { id: true, name: true } },
        },
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
          // Fase 4D: a que partidas hay que devolver. Se LEEN, no se recalculan.
          lots: { select: { lotId: true, quantity: true }, orderBy: { lotId: 'asc' } },
        },
      })

      for (const item of [...items].sort((a, b) => a.productId - b.productId)) {
        // FEFO NO se recalcula en la anulacion, y es de las decisiones que mas
        // importan de la fase: diez dias despues, el lote que vencia manana ya
        // vencio y FEFO elegiria otro. Las tres unidades volverian a una partida
        // que nunca las tuvo, y el lote vencido quedaria con un faltante que
        // nadie puede explicar. Ver docs/FEFO_POLICY.md.
        //
        // Lo que no salio de ningun lote --el stock sin asignar de un producto
        // OPTIONAL-- vuelve igual: es la resta entre lo vendido y lo repartido.
        const repartido = item.lots.reduce((s, l) => sumarCantidades(s, l.quantity), aCantidad(0))
        const sinLote = restarCantidades(item.quantity, repartido)

        const partes: Array<{ lotId: number | null; quantity: Cantidad }> = [
          ...(esCeroCantidad(sinLote) ? [] : [{ lotId: null, quantity: sinLote }]),
          ...item.lots.map((l) => ({ lotId: l.lotId, quantity: l.quantity })),
        ]

        for (const parte of partes) {
          await applyStockMovement(tx, {
            branchId: venta.branchId,
            productId: item.productId,
            lotId: parte.lotId,
            type: 'SALE_CANCEL',
            // La cantidad EXACTA que se vendio, leida de la linea. Restaurar
            // 0,425 kg devuelve 0,425 kg: sin recalcular y sin redondear.
            quantity: parte.quantity,
            saleUnit: unidadDeVentaODefecto(item.product.saleUnit),
            userId: session.userId,
            reason: motivo,
            referenceType: 'Sale',
            referenceId: saleId,
          })
        }
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

      // Reversion de la cuenta corriente: movimiento inverso, no borrado.
      //
      // Se lee lo que se cargo de los PAGOS de la venta y no del libro, y esa
      // eleccion importa: el pago dice cuanto se fio en ESTA venta, mientras
      // que el libro pudo haberse movido despues por cobros y ajustes que no
      // tienen nada que ver con ella.
      //
      // EL CASO DIFICIL --objetivo 18-- y la politica, escrita:
      //
      //   venta fiada        +20.000   saldo 20.000
      //   el cliente paga     -8.000   saldo 12.000
      //   se anula la venta  -20.000   saldo -8.000
      //
      // Quedan $8.000 A FAVOR del cliente, y es lo correcto: esa plata la puso
      // de verdad y la mercaderia volvio. El pago anterior NO se toca ni se
      // reinterpreta --es un hecho, y ya tiene su comprobante-- y la anulacion
      // revierte exactamente lo que la venta habia cargado. Cualquier otra
      // politica --revertir "lo que quede", o cancelar el pago-- obligaria al
      // sistema a decidir de quien es esa plata, y no es una decision suya.
      let cuenta: CancelResult['account'] = null

      const lineasACuenta = await tx.salePayment.findMany({
        where: { saleId, method: MEDIO_CUENTA },
        select: { amount: true },
      })
      const fiado = sumar(...lineasACuenta.map((p) => p.amount))

      if (!esCero(fiado)) {
        if (!venta.client) {
          // No deberia poder ocurrir: la venta con parte a cuenta exige cliente
          // y la clave foranea lo sostiene. Decirlo es mejor que revertir la
          // caja y dejar la deuda viva sin que nadie se entere.
          throw conflict(
            `La venta #${saleId} tiene ${aMonto(fiado)} a cuenta pero no tiene cliente asociado. ` +
              'No se puede anular sin dejar la cuenta descuadrada.',
            { code: 'ACCOUNT_SALE_NEEDS_CLIENT' },
          )
        }

        const movimiento = await applyAccountMovement(tx, {
          branchId: venta.branchId,
          clientId: venta.client.id,
          type: 'SALE_CANCEL',
          amount: negar(fiado),
          userId: session.userId,
          reason: motivo,
          saleId,
        })

        cuenta = {
          clientId: venta.client.id,
          clientName: venta.client.name,
          reverted: aMonto(fiado),
          previousBalance: aMonto(movimiento.previousBalance),
          resultingBalance: aMonto(movimiento.resultingBalance),
          saldoAFavor: esNegativo(movimiento.resultingBalance)
            ? aMonto(absoluto(movimiento.resultingBalance))
            : aMonto(CERO_D),
        }
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
          clientId: venta.clientId,
          cuentaRevertida: cuenta === null ? null : cuenta.reverted,
          saldoDelCliente: cuenta === null ? null : cuenta.resultingBalance,
        },
        origin: 'POST /api/sales/:id/cancel',
      })

      return {
        id: saleId,
        status: 'canceled' as const,
        restoredItems: items.length,
        cashReversed: aMonto(efectivoRevertido),
        account: cuenta,
      }
    },
    { timeout: 15_000, maxWait: 15_000 },
  )
}

/** Tipo del cliente dentro de una transaccion, reexportado por comodidad. */
export type TxClient = Prisma.TransactionClient
