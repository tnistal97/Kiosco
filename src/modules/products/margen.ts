/**
 * Ganancia, margen y markup.
 *
 * SE CALCULAN, no se guardan. Los tres se deducen de precio y costo, y
 * guardarlos significaria mantenerlos sincronizados en cada cambio de
 * cualquiera de los dos: el dia que un camino se olvide, la pantalla muestra
 * un margen que no es el de ese producto y nadie se entera.
 *
 * Vive aca, sin Prisma, porque lo necesitan las dos puntas: el formulario para
 * mostrarlo mientras se tipea y el servidor para los reportes.
 *
 * Las tres cuentas, que NO son la misma y por eso llevan nombres distintos:
 *
 *   Ganancia   precio − costo                          $450
 *   Margen     (precio − costo) / precio × 100         37,50 %   sobre la venta
 *   Markup     (precio − costo) / costo  × 100         60,00 %   sobre la compra
 *
 * Confundirlos es el error clasico: "le pongo 40 % arriba" es markup, y quien
 * cree que asi consigue un margen del 40 % se queda corto todos los meses.
 */

import { aCentavos, desdeCentavos, restarMontos, type Monto } from '@/lib/money'

export interface Rentabilidad {
  /** precio − costo. Null cuando no hay costo cargado. */
  ganancia: Monto | null
  /**
   * Porcentaje sobre el PRECIO, con dos decimales, como cadena: `"37.50"`.
   *
   * Null cuando no se puede calcular: sin costo, o con precio cero. Nunca
   * `Infinity` ni `NaN`: los dos se muestran como texto en pantalla y los dos
   * son mentiras distintas.
   */
  margen: string | null
  /** Porcentaje sobre el COSTO. Null sin costo o con costo cero. */
  markup: string | null
  /** Si se esta vendiendo por debajo del costo. La pantalla lo destaca. */
  bajoCosto: boolean
}

const SIN_DATOS: Rentabilidad = { ganancia: null, margen: null, markup: null, bajoCosto: false }

/**
 * Porcentaje con dos decimales, exacto hasta donde se puede.
 *
 * Se trabaja en centesimas de punto --`3750` son 37,50 %-- para no arrastrar
 * el error de una division en punto flotante hasta la pantalla. La division
 * final es la unica y se redondea medio hacia arriba, igual que el dinero.
 */
function porcentaje(numerador: number, denominador: number): string | null {
  if (denominador === 0) return null

  const centesimas = (numerador * 10_000) / denominador
  if (!Number.isFinite(centesimas)) return null

  const signo = centesimas < 0 ? '-' : ''
  const absoluto = Math.round(Math.abs(centesimas))
  const enteros = Math.trunc(absoluto / 100)
  const resto = absoluto % 100

  return `${signo}${enteros}.${String(resto).padStart(2, '0')}`
}

/**
 * Rentabilidad de un producto.
 *
 * Los cuatro casos raros, resueltos a proposito y no por descuido:
 *
 *   costo null    todo null. "No sabemos", que es distinto de "cero".
 *   costo 0       margen 100 %, markup null. Regalado no tiene sobreprecio:
 *                 dividir por cero daria Infinity.
 *   precio 0      margen null, markup calculable y negativo. No se puede
 *                 medir cuanto se gana sobre una venta de cero.
 *   costo > precio  los tres negativos, y `bajoCosto`. Es informacion real:
 *                 se esta vendiendo a perdida y hay que verlo, no ocultarlo.
 *
 * El costo se guarda con cuatro decimales y aca se lee con dos. La diferencia
 * mueve el margen menos de una centesima de punto, y a cambio las tres cuentas
 * usan la misma aritmetica de centavos enteros que el resto del sistema.
 */
export function calcularRentabilidad(precio: Monto, costo: Monto | null): Rentabilidad {
  if (costo === null) return SIN_DATOS

  const p = aCentavos(precio)
  const c = aCentavos(costo)
  const diferencia = p - c

  return {
    ganancia: restarMontos(precio, costo),
    margen: porcentaje(diferencia, p),
    markup: porcentaje(diferencia, c),
    bajoCosto: diferencia < 0,
  }
}

/** Para mostrar: `"37,50 %"`. Un guion cuando no hay dato. */
export function formatearPorcentaje(valor: string | null): string {
  if (valor === null) return '—'
  return `${valor.replace('.', ',')} %`
}

/**
 * El precio que daria un margen buscado. Para la ayuda del formulario.
 *
 * `precio = costo / (1 − margen/100)`. Con margen 100 % o mas no hay precio
 * posible --el denominador seria cero o negativo-- y devuelve null en vez de
 * un numero enorme que parezca una respuesta.
 */
export function precioParaMargen(costo: Monto, margenPorCiento: number): Monto | null {
  if (margenPorCiento >= 100) return null
  const c = aCentavos(costo)
  if (c <= 0) return null

  const denominador = 100 - margenPorCiento
  if (denominador <= 0) return null

  return desdeCentavos(Math.round((c * 100) / denominador))
}
