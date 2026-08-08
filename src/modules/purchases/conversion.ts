/**
 * Unidad de compra → unidad de stock.
 *
 * ES LA CONVERSION DEL MODULO, y vive en un solo archivo. Ni un componente ni
 * una ruta la hacen a mano: repartirla seria garantizar que dos lugares
 * terminen dividiendo distinto.
 *
 *   Coca Cola 2,25 L
 *     saleUnit UNIT · purchaseUnit BOX · unitsPerPurchaseUnit 8
 *
 *     5 BOX pedidas → 3 BOX recibidas → +24 UNIT de stock
 *
 * Este modulo NO importa Prisma: lo usan las pantallas de compras. Su hermano
 * de servidor es `calculo.ts`, que hace las mismas cuentas en `Decimal` y es
 * el que decide lo que se guarda. Hay una prueba que compara los dos sobre la
 * misma tabla de casos, porque dos implementaciones que se separan en silencio
 * son peores que una sola imperfecta.
 *
 * El reparto es el de siempre:
 *
 *   el navegador calcula para MOSTRAR;
 *   el servidor calcula para GUARDAR.
 *
 * Con una excepcion que conviene decir: la conversion de CANTIDAD es exacta en
 * los dos lados y da el mismo numero siempre --es una multiplicacion de
 * enteros, y la base la comprueba con un CHECK--. La de COSTO es una DIVISION
 * y aca es una aproximacion a dos decimales; el numero fino, con cuatro, lo
 * calcula el servidor. Ver docs/PURCHASE_FLOW.md.
 */

import { aCentavos, desdeCentavos, type Monto } from '@/lib/money'
import { aMilesimas, desdeMilesimas, precioPorCantidad, type TextoCantidad } from '@/lib/cantidad'
import {
  formatearCantidadConUnidad,
  motivoDeCantidadInvalida,
  NOMBRE_DE_UNIDAD_DE_COMPRA,
  type UnidadDeCompra,
  type UnidadDeVenta,
} from '@/modules/products/units'

const MIL = 1000

/**
 * Cuantas unidades de venta entran al stock.
 *
 *   cantidadDeStock = cantidadDeCompra × unidadesPorUnidadDeCompra
 *
 * Toda la aritmetica es entera: milesimas por milesimas da un entero exacto en
 * millonesimas, y la vuelta a milesimas se hace medio hacia arriba a mano. Sin
 * esto, `5 * 8` sobre cantidades que vinieron de una cadena decimal podria dar
 * `39.99999999999999`, y la base --que comprueba esta igualdad con un CHECK--
 * rechazaria la recepcion.
 *
 * En la practica el redondeo no se aplica nunca: hace falta que el producto
 * tenga mas de tres decimales, y una cantidad asi se rechaza antes por la
 * politica de su unidad.
 */
export function cantidadDeStock(
  cantidadDeCompra: TextoCantidad,
  unidadesPorUnidadDeCompra: TextoCantidad,
): TextoCantidad {
  const compra = aMilesimas(cantidadDeCompra)
  const factor = aMilesimas(unidadesPorUnidadDeCompra)

  const producto = compra * factor
  if (!Number.isSafeInteger(producto)) {
    throw new Error(`Conversion fuera de rango: ${cantidadDeCompra} × ${unidadesPorUnidadDeCompra}`)
  }

  const signo = producto < 0 ? -1 : 1
  const absoluto = Math.abs(producto)
  const entero = Math.trunc(absoluto / MIL)
  const resto = absoluto % MIL

  return desdeMilesimas(signo * (resto >= MIL / 2 ? entero + 1 : entero))
}

/**
 * Comprueba que la conversion de una linea sea posible ANTES de pedirla.
 *
 * Devuelve el motivo del rechazo o `null` si esta bien. El caso que importa:
 *
 *   purchaseUnit PACK · unitsPerPurchaseUnit 2,5 · saleUnit UNIT
 *   3 PACK × 2,5 = 7,5 UNIT
 *
 * Media unidad no existe. Se rechaza AL CONFIRMAR LA ORDEN y no al recibir:
 * descubrirlo con el camion en la puerta no le sirve a nadie.
 *
 * El mensaje nombra los tres numeros a proposito. "Cantidad invalida" obliga a
 * adivinar cual de los tres esta mal.
 */
export function motivoDeConversionInvalida(
  unidadDeVenta: UnidadDeVenta,
  unidadDeCompra: UnidadDeCompra,
  cantidadDeCompra: TextoCantidad,
  unidadesPorUnidadDeCompra: TextoCantidad,
): string | null {
  if (aMilesimas(unidadesPorUnidadDeCompra) <= 0) {
    return 'Una unidad de compra tiene que contener al menos una unidad de venta'
  }

  let resultado: TextoCantidad
  try {
    resultado = cantidadDeStock(cantidadDeCompra, unidadesPorUnidadDeCompra)
  } catch {
    return 'La cantidad convertida se sale de rango'
  }

  const motivo = motivoDeCantidadInvalida(unidadDeVenta, resultado)
  if (motivo === null) return null

  return (
    `${cantidadDeCompra} ${NOMBRE_DE_UNIDAD_DE_COMPRA[unidadDeCompra].toLowerCase()} × ` +
    `${unidadesPorUnidadDeCompra} = ${resultado}, que no es una cantidad válida: ` +
    motivo.charAt(0).toLowerCase() +
    motivo.slice(1)
  )
}

/**
 * Subtotal de una linea de la orden.
 *
 *   subtotal = cantidadDeCompra × unitCost
 *
 * `unitCost` es POR UNIDAD DE COMPRA: una caja de 8 a $8.800 son $8.800, no
 * $1.100. Cinco cajas dan $44.000.
 *
 * Exacto: es la misma cuenta entera que usa una linea del ticket de venta.
 */
export function subtotalDeLinea(cantidadDeCompra: TextoCantidad, unitCost: Monto): Monto {
  return precioPorCantidad(unitCost, cantidadDeCompra)
}

/**
 * Costo por unidad de STOCK. Lo que termina en `Product.cost`.
 *
 *   costoDeStock = unitCost ÷ unidadesPorUnidadDeCompra
 *
 * $8.800 la caja ÷ 8 = $1.100 la botella.
 *
 * APROXIMADO A DOS DECIMALES, y es la unica cuenta de este archivo que lo es.
 * La division no siempre cierra: $1.000 entre 3 da $333,3333, y el numero que
 * se guarda tiene cuatro decimales. Este sirve para que el comprador vea a
 * cuanto le sale la unidad mientras tipea; el que queda en la base lo calcula
 * el servidor.
 */
export function costoDeStockAproximado(
  unitCost: Monto,
  unidadesPorUnidadDeCompra: TextoCantidad,
): Monto {
  const factor = aMilesimas(unidadesPorUnidadDeCompra)
  if (factor <= 0) throw new Error('Division por cero al convertir un costo de compra')

  const centavos = aCentavos(unitCost)
  const producto = centavos * MIL
  if (!Number.isSafeInteger(producto)) {
    throw new Error(`Costo fuera de rango: ${unitCost}`)
  }

  const signo = producto < 0 ? -1 : 1
  const absoluto = Math.abs(producto)
  const entero = Math.trunc(absoluto / factor)
  const resto = absoluto % factor

  return desdeCentavos(signo * (resto * 2 >= factor ? entero + 1 : entero))
}

/**
 * "5 cajas × 8 = 40 u." Para que la pantalla no tenga que armar la frase.
 *
 * Cuando la unidad de compra y la de venta coinciden y el factor es 1, la
 * frase no aporta nada --"12,500 kg × 1 = 12,500 kg"-- y se devuelve vacia.
 */
export function descripcionDeConversion(
  unidadDeVenta: UnidadDeVenta,
  unidadDeCompra: UnidadDeCompra,
  cantidadDeCompra: TextoCantidad,
  unidadesPorUnidadDeCompra: TextoCantidad,
): string {
  if (aMilesimas(unidadesPorUnidadDeCompra) === MIL) return ''

  const stock = cantidadDeStock(cantidadDeCompra, unidadesPorUnidadDeCompra)
  const nombre = NOMBRE_DE_UNIDAD_DE_COMPRA[unidadDeCompra].toLowerCase()
  return `${cantidadDeCompra} ${nombre} → ${formatearCantidadConUnidad(stock, unidadDeVenta)}`
}
