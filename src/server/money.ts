/**
 * Dinero en el servidor.
 *
 * Una sola regla, y no admite excepcion:
 *
 *   UN IMPORTE NO SE CONVIERTE A `number` PARA OPERAR.
 *
 * Ni con `Number(d)`, ni con `d.toNumber()`, ni sumando en un `reduce` sobre
 * floats. Sale de la base como `Decimal`, se opera como `Decimal` y sale hacia
 * la API como cadena. El unico `toNumber` que queda en el proyecto esta en
 * `aNumeroParaMostrar` de `src/lib/money.ts`, que sirve para porcentajes.
 *
 * Hay una regla de ESLint que lo hace cumplir sobre `src/modules` y
 * `src/server`. Una regla que solo vive en un comentario se rompe el dia que
 * alguien tiene apuro.
 *
 * `Prisma.Decimal` es decimal.js: precision arbitraria en base 10. Es el mismo
 * objeto que devuelve el cliente de Prisma al leer una columna `numeric`, asi
 * que no hay conversion en el medio.
 *
 * Ver docs/PHASE3_MONEY_MIGRATION.md para la eleccion de precision y escala.
 */

import { Prisma } from '@prisma/client'
import { desdeCentavos, type Monto } from '@/lib/money'

export type Dinero = Prisma.Decimal

/** Escala de lo que se cobra. Un peso tiene centavos y nada mas. */
export const ESCALA_PESOS = 2

/**
 * Escala de un costo unitario.
 *
 * Cuatro decimales porque el costo se DERIVA de una division: una caja de 8 a
 * $12.345 da $1.543,125 por unidad. Con dos decimales, reconstruir la caja da
 * $12.345,04. Un numero que solo alimenta calculos puede guardarse con mas
 * resolucion que uno que se cobra.
 */
export const ESCALA_COSTO = 4

/**
 * Medio hacia arriba. Lo que hace una calculadora.
 *
 * No se usa "banker's rounding" (medio al par), que es mas neutral
 * estadisticamente pero da resultados que nadie sabe explicar en el mostrador:
 * 2,5 va a 2 y 3,5 va a 4.
 */
const MEDIO_ARRIBA = Prisma.Decimal.ROUND_HALF_UP

export const CERO_D: Dinero = new Prisma.Decimal(0)

/**
 * Construye un importe.
 *
 * Acepta cadena, numero, otro `Decimal` o lo que devuelva Prisma. La cadena es
 * la forma preferida: un numero de JavaScript ya puede venir con el error que
 * este modulo existe para evitar.
 */
export function dinero(valor: Prisma.Decimal.Value): Dinero {
  return new Prisma.Decimal(valor)
}

export function sumar(...montos: Dinero[]): Dinero {
  return montos.reduce<Dinero>((total, m) => total.plus(m), CERO_D)
}

export function restar(a: Dinero, b: Dinero): Dinero {
  return a.minus(b)
}

export function multiplicar(a: Dinero, b: Prisma.Decimal.Value): Dinero {
  return a.times(b)
}

export function dividir(a: Dinero, b: Prisma.Decimal.Value): Dinero {
  const divisor = new Prisma.Decimal(b)
  if (divisor.isZero()) throw new Error('Division por cero al calcular un importe')
  return a.dividedBy(divisor)
}

export function comparar(a: Dinero, b: Dinero): -1 | 0 | 1 {
  return a.comparedTo(b) as -1 | 0 | 1
}

export function iguales(a: Dinero, b: Dinero): boolean {
  return a.equals(b)
}

export function esCero(d: Dinero): boolean {
  return d.isZero()
}

export function esNegativo(d: Dinero): boolean {
  return d.isNegative() && !d.isZero()
}

export function esPositivo(d: Dinero): boolean {
  return d.isPositive() && !d.isZero()
}

export function negar(d: Dinero): Dinero {
  return d.negated()
}

export function absoluto(d: Dinero): Dinero {
  return d.absoluteValue()
}

export function maximo(a: Dinero, b: Dinero): Dinero {
  return a.greaterThanOrEqualTo(b) ? a : b
}

export function minimo(a: Dinero, b: Dinero): Dinero {
  return a.lessThanOrEqualTo(b) ? a : b
}

/**
 * A dos decimales.
 *
 * Se aplica UNA vez, al pasar de un calculo interno a un importe cobrable.
 * Redondear en cada paso intermedio es lo que hacia que la suma de subtotales
 * y el total difirieran en un centavo.
 */
export function redondearPesos(d: Dinero): Dinero {
  return d.toDecimalPlaces(ESCALA_PESOS, MEDIO_ARRIBA)
}

/** A cuatro decimales. Para costos unitarios. */
export function redondearCosto(d: Dinero): Dinero {
  return d.toDecimalPlaces(ESCALA_COSTO, MEDIO_ARRIBA)
}

/**
 * Hacia la API: cadena con dos decimales exactos.
 *
 * `"6540.00"`, no `6540` ni `"6540"`. La escala fija evita que el cliente
 * tenga que adivinar cuantos decimales tenia el numero.
 */
export function aMonto(d: Dinero): Monto {
  return d.toDecimalPlaces(ESCALA_PESOS, MEDIO_ARRIBA).toFixed(ESCALA_PESOS)
}

/** Hacia la API, para costos: cadena con cuatro decimales exactos. */
export function aMontoCosto(d: Dinero): string {
  return d.toDecimalPlaces(ESCALA_COSTO, MEDIO_ARRIBA).toFixed(ESCALA_COSTO)
}

/** Hacia la API, admitiendo ausencia. */
export function aMontoOpcional(d: Dinero | null | undefined): Monto | null {
  return d === null || d === undefined ? null : aMonto(d)
}

export function aMontoCostoOpcional(d: Dinero | null | undefined): string | null {
  return d === null || d === undefined ? null : aMontoCosto(d)
}

/**
 * Suma de una agregacion de Prisma, que devuelve `null` cuando no hay filas.
 *
 * Existe para que ningun servicio escriba `?? 0` sobre un `Decimal` y termine
 * mezclando los dos tipos sin darse cuenta.
 */
export function sumaODefecto(suma: Dinero | null | undefined): Dinero {
  return suma ?? CERO_D
}

/**
 * Centavos enteros. Para comparar contra lo que calculo el navegador.
 *
 * Es la unica salida numerica de este modulo y esta acotada a dos decimales
 * por definicion, asi que no pierde nada. No sirve para operar: sirve para
 * comprobar que dos calculos independientes dieron lo mismo.
 */
export function aCentavosExactos(d: Dinero): number {
  return Number(d.toDecimalPlaces(ESCALA_PESOS, MEDIO_ARRIBA).times(100).toFixed(0))
}

/** El camino inverso, para reconstruir un importe desde centavos. */
export function desdeCentavosD(centavos: number): Dinero {
  return new Prisma.Decimal(desdeCentavos(centavos))
}
