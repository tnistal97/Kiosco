/**
 * Las cuentas de una compra, del lado del servidor.
 *
 * Hermano de `conversion.ts`, que hace lo mismo en enteros para el navegador.
 * Este es el que decide lo que se GUARDA, y por eso trabaja en `Decimal` de
 * punta a punta: ni una de estas funciones convierte a `number`.
 *
 * Hay una prueba que corre las dos implementaciones sobre la misma tabla de
 * casos y compara. Dos versiones de la misma cuenta que se separan en silencio
 * son peores que una sola: la pantalla mostraria un total y la base guardaria
 * otro, y nadie sabria cual creer.
 *
 * Ver docs/PURCHASE_FLOW.md.
 */

import { invalid } from '@/server/http/errors'
import {
  aTextoCantidad,
  cantidad as aCantidad,
  redondearCantidad,
  type Cantidad,
} from '@/server/cantidad'
import {
  aMonto,
  aMontoCosto,
  dinero,
  redondearCosto,
  redondearPesos,
  sumar,
  type Dinero,
} from '@/server/money'
import { motivoDeConversionInvalida } from './conversion'
import type { UnidadDeCompra, UnidadDeVenta } from '@/modules/products/units'
import type { TextoCantidad } from '@/lib/cantidad'

/**
 * Cuantas unidades de venta entran al stock.
 *
 *   cantidadDeStock = cantidadDeCompra × unidadesPorUnidadDeCompra
 *
 * Exacta: multiplicar dos numeros de tres decimales da uno de seis, y el
 * redondeo a tres solo actuaria sobre decimales que la validacion de la unidad
 * ya rechazo. La base comprueba esta misma igualdad con un CHECK, asi que si
 * las dos cuentas se separaran la fila no entraria.
 */
export function cantidadDeStock(
  cantidadDeCompra: Cantidad,
  unidadesPorUnidadDeCompra: Cantidad,
): Cantidad {
  return redondearCantidad(cantidadDeCompra.times(unidadesPorUnidadDeCompra))
}

/**
 * Costo por unidad de STOCK. Lo que termina en `Product.cost`.
 *
 *   costoDeStock = unitCost ÷ unidadesPorUnidadDeCompra
 *
 * A CUATRO decimales, que es la escala de la columna y la razon de que sea 4:
 * la division no siempre cierra. $1.000 la caja entre 3 unidades da $333,3333,
 * y reconstruir la caja desde ahi da $999,9999. Con dos decimales el error
 * seria de un centavo por unidad; con cuatro es de una diezmilesima.
 *
 * La alternativa --guardar la fraccion exacta-- exigiria un tipo racional que
 * PostgreSQL no tiene.
 */
export function costoDeStock(unitCost: Dinero, unidadesPorUnidadDeCompra: Cantidad): Dinero {
  if (unidadesPorUnidadDeCompra.lessThanOrEqualTo(0)) {
    throw invalid('Una unidad de compra tiene que contener al menos una unidad de venta')
  }
  return redondearCosto(unitCost.dividedBy(unidadesPorUnidadDeCompra))
}

/**
 * Subtotal de una linea.
 *
 *   subtotal = cantidadDeCompra × unitCost
 *
 * A dos decimales, UNA sola vez y al final: es un importe que se compara
 * contra una factura. Redondear en pasos intermedios es lo que hacia que la
 * suma de subtotales y el total difirieran en un centavo.
 */
export function subtotalDeLinea(cantidadDeCompra: Cantidad, unitCost: Dinero): Dinero {
  return redondearPesos(unitCost.times(cantidadDeCompra))
}

/**
 * Total de la orden: la suma de los subtotales, y nada mas.
 *
 * NO se acepta del cliente. Es la misma regla que rige el total de una venta
 * desde la Fase 0, y por el mismo motivo: lo que llega por la red lo escribe
 * cualquiera.
 */
export function totalDeOrden(subtotales: Dinero[]): Dinero {
  return redondearPesos(sumar(...subtotales))
}

/**
 * Todo lo que hay que saber de una linea, calculado de una vez.
 *
 * Devolver las cuatro cosas juntas evita que un camino calcule el subtotal y
 * se olvide de comprobar la conversion, que es exactamente el tipo de olvido
 * que deja una orden imposible de recibir.
 */
export interface LineaCalculada {
  cantidadDeCompra: Cantidad
  unitCost: Dinero
  subtotal: Dinero
  cantidadDeStock: Cantidad
  costoDeStock: Dinero
}

export function calcularLinea(entrada: {
  saleUnit: UnidadDeVenta
  purchaseUnit: UnidadDeCompra
  cantidadDeCompra: TextoCantidad
  unitsPerPurchaseUnit: TextoCantidad
  /**
   * Costo por unidad de compra. Cadena canonica, con hasta cuatro decimales:
   * es un `Monto` de dos, o lo que devuelve `costSchema`, que admite cuatro.
   */
  unitCost: string
}): LineaCalculada {
  const motivo = motivoDeConversionInvalida(
    entrada.saleUnit,
    entrada.purchaseUnit,
    entrada.cantidadDeCompra,
    entrada.unitsPerPurchaseUnit,
  )
  if (motivo !== null) {
    throw invalid(motivo, undefined, { code: 'INVALID_PURCHASE_CONVERSION' })
  }

  const cantidadDeCompra = aCantidad(entrada.cantidadDeCompra)
  const factor = aCantidad(entrada.unitsPerPurchaseUnit)
  const unitCost = dinero(entrada.unitCost)

  return {
    cantidadDeCompra,
    unitCost,
    subtotal: subtotalDeLinea(cantidadDeCompra, unitCost),
    cantidadDeStock: cantidadDeStock(cantidadDeCompra, factor),
    costoDeStock: costoDeStock(unitCost, factor),
  }
}

/**
 * La diferencia entre lo que decia la orden y lo que dice la factura.
 *
 * Se calcula para MOSTRARLA, no para esconderla. Modificar la orden original
 * al recibir haria desaparecer la diferencia, y con ella la unica pista de que
 * el proveedor aumento. Ver docs/PURCHASE_RECEIVING.md.
 */
export interface DiferenciaDeCosto {
  esperado: string
  recibido: string
  /** recibido − esperado. Positivo, nos cobraron de mas. */
  diferencia: string
  /** En puntos porcentuales, con dos decimales. `null` si el esperado es 0. */
  porcentaje: string | null
  hayDiferencia: boolean
}

export function diferenciaDeCosto(esperado: Dinero, recibido: Dinero): DiferenciaDeCosto {
  const delta = recibido.minus(esperado)
  const hay = !delta.isZero()

  // Sobre un esperado de cero --mercaderia bonificada que llego facturada-- el
  // porcentaje seria una division por cero. Se devuelve null y no Infinity: la
  // pantalla muestra el importe, que es el dato que sirve.
  const porcentaje = esperado.isZero()
    ? null
    : aMonto(redondearPesos(delta.dividedBy(esperado).times(100)))

  return {
    esperado: aMontoCosto(esperado),
    recibido: aMontoCosto(recibido),
    diferencia: aMontoCosto(delta),
    porcentaje,
    hayDiferencia: hay,
  }
}

/** Cuanto queda por recibir de una linea, en unidad de compra. */
export function pendienteDeLinea(pedido: Cantidad, recibido: Cantidad): Cantidad {
  const resto = pedido.minus(recibido)
  return resto.isNegative() ? aCantidad(0) : resto
}

/** Lo mismo, como texto, para el DTO. */
export function pendienteComoTexto(pedido: Cantidad, recibido: Cantidad): TextoCantidad {
  return aTextoCantidad(pendienteDeLinea(pedido, recibido))
}
