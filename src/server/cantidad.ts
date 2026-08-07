/**
 * Cantidades en el servidor.
 *
 * Hermano exacto de `src/server/money.ts`, y con la misma regla, que tampoco
 * admite excepcion:
 *
 *   UNA CANTIDAD NO SE CONVIERTE A `number` PARA OPERAR.
 *
 * Sale de la base como `Decimal`, se opera como `Decimal` y sale hacia la API
 * como cadena. Hay una regla de ESLint que lo hace cumplir sobre
 * `src/modules` y `src/server`.
 *
 * Por que importa mas aca que en cualquier otro lado: el libro de inventario
 * tiene una restriccion en PostgreSQL que dice
 *
 *   resultingQuantity = previousQuantity + quantity
 *
 * Un `0.1 + 0.2` que da `0.30000000000000004` no produce un numero feo: produce
 * una fila que la base RECHAZA, y con ella una venta que no se puede registrar.
 *
 * Ver docs/PHASE3_QUANTITY_MIGRATION.md.
 */

import { Prisma } from '@prisma/client'
import { desdeMilesimas, ESCALA_CANTIDAD, type TextoCantidad } from '@/lib/cantidad'

export type Cantidad = Prisma.Decimal

/**
 * La escala y el tope viven en `@/lib/cantidad`, que no importa Prisma, porque
 * los necesitan los esquemas de validacion y esos llegan al navegador. Se
 * reexportan aca para que un servicio no tenga que importar de dos lados.
 */
export { CANTIDAD_MAX, ESCALA_CANTIDAD } from '@/lib/cantidad'

/** Medio hacia arriba, igual que el dinero. Lo que hace una calculadora. */
const MEDIO_ARRIBA = Prisma.Decimal.ROUND_HALF_UP

export const CERO_C: Cantidad = new Prisma.Decimal(0)

/**
 * Construye una cantidad.
 *
 * La cadena es la forma preferida: un numero de JavaScript ya puede venir con
 * el error que este modulo existe para evitar.
 */
export function cantidad(valor: Prisma.Decimal.Value): Cantidad {
  return new Prisma.Decimal(valor)
}

export function sumarCantidades(...cantidades: Cantidad[]): Cantidad {
  return cantidades.reduce<Cantidad>((total, c) => total.plus(c), CERO_C)
}

export function restarCantidades(a: Cantidad, b: Cantidad): Cantidad {
  return a.minus(b)
}

export function compararCantidades(a: Cantidad, b: Cantidad): -1 | 0 | 1 {
  return a.comparedTo(b) as -1 | 0 | 1
}

export function igualesCantidades(a: Cantidad, b: Cantidad): boolean {
  return a.equals(b)
}

export function esCeroCantidad(c: Cantidad): boolean {
  return c.isZero()
}

export function esNegativaCantidad(c: Cantidad): boolean {
  return c.isNegative() && !c.isZero()
}

export function esPositivaCantidad(c: Cantidad): boolean {
  return c.isPositive() && !c.isZero()
}

export function negarCantidad(c: Cantidad): Cantidad {
  return c.negated()
}

export function absolutoCantidad(c: Cantidad): Cantidad {
  return c.absoluteValue()
}

export function minCantidad(a: Cantidad, b: Cantidad): Cantidad {
  return a.lessThanOrEqualTo(b) ? a : b
}

export function maxCantidad(a: Cantidad, b: Cantidad): Cantidad {
  return a.greaterThanOrEqualTo(b) ? a : b
}

/** A tres decimales. Se aplica una sola vez, al entrar. */
export function redondearCantidad(c: Cantidad): Cantidad {
  return c.toDecimalPlaces(ESCALA_CANTIDAD, MEDIO_ARRIBA)
}

/**
 * Hacia la API: cadena con tres decimales exactos.
 *
 * `"0.425"`, no `0.425` ni `"0.42"`. La escala fija evita que el cliente tenga
 * que adivinar cuantos decimales tenia el numero.
 */
export function aTextoCantidad(c: Cantidad): TextoCantidad {
  return c.toDecimalPlaces(ESCALA_CANTIDAD, MEDIO_ARRIBA).toFixed(ESCALA_CANTIDAD)
}

export function aTextoCantidadOpcional(c: Cantidad | null | undefined): TextoCantidad | null {
  return c === null || c === undefined ? null : aTextoCantidad(c)
}

/**
 * Suma de una agregacion de Prisma, que devuelve `null` cuando no hay filas.
 *
 * Existe para que ningun servicio escriba `?? 0` sobre un `Decimal` y termine
 * mezclando los dos tipos sin darse cuenta.
 */
export function sumaCantidadODefecto(suma: Cantidad | null | undefined): Cantidad {
  return suma ?? CERO_C
}

/**
 * Milesimas enteras. Para comparar contra lo que calculo el navegador.
 *
 * Es la unica salida numerica de este modulo y esta acotada a tres decimales
 * por definicion, asi que no pierde nada. No sirve para operar: sirve para
 * comprobar que dos calculos independientes dieron lo mismo.
 */
export function aMilesimasExactas(c: Cantidad): number {
  return Number(c.toDecimalPlaces(ESCALA_CANTIDAD, MEDIO_ARRIBA).times(1000).toFixed(0))
}

/** El camino inverso, para reconstruir una cantidad desde milesimas. */
export function desdeMilesimasC(milesimas: number): Cantidad {
  return new Prisma.Decimal(desdeMilesimas(milesimas))
}
