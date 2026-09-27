/**
 * La cuenta de un cambio masivo de precios. Fase P0-B.
 *
 * Sin Prisma: la usan el servidor, que es el que cobra, y la pantalla, que
 * describe el criterio con las mismas palabras. Toda la aritmetica es en
 * CENTAVOS ENTEROS con BigInt --un aumento del 12,5 % sobre $ 1.234,56 no pasa
 * nunca por un `double`-- y el redondeo final es uno solo.
 *
 * EL REDONDEO, en una regla: va en la DIRECCION DEL CAMBIO.
 *
 *   si el precio sube   se redondea para ARRIBA: el precio nuevo nunca queda
 *                       por debajo de lo calculado (no se pierde margen)
 *   si el precio baja   se redondea para ABAJO: una rebaja nunca termina mas
 *                       cara que antes por culpa del redondeo
 *
 * "Terminar en 90" es literal: $ 1.234 sube a $ 1.290; $ 1.290 baja a $ 1.190
 * si se esta bajando. Es lo que el comerciante ve en la vista previa antes de
 * confirmar, fila por fila.
 */

import { aCentavos, desdeCentavos, formatearMonto, type Monto } from '@/lib/money'
import { textoLocalDeNumero } from '@/lib/numero-local'

export const OPERACIONES = [
  'aumentar',
  'disminuir',
  'sumar',
  'restar',
  'fijar',
  'costo-mas',
] as const
export type Operacion = (typeof OPERACIONES)[number]

export const NOMBRE_DE_OPERACION: Record<Operacion, string> = {
  aumentar: 'Aumentar un porcentaje',
  disminuir: 'Bajar un porcentaje',
  sumar: 'Sumar un monto',
  restar: 'Restar un monto',
  fijar: 'Poner un precio fijo',
  'costo-mas': 'Costo más un porcentaje',
}

/** Si el valor de la operacion es un porcentaje o un importe. */
export function esPorcentaje(o: Operacion): boolean {
  return o === 'aumentar' || o === 'disminuir' || o === 'costo-mas'
}

export const REDONDEOS = [
  'ninguno',
  'entero',
  'termina-0',
  'termina-50',
  'termina-90',
  'termina-99',
] as const
export type Redondeo = (typeof REDONDEOS)[number]

export const NOMBRE_DE_REDONDEO: Record<Redondeo, string> = {
  ninguno: 'Sin redondeo (al centavo)',
  entero: 'A peso entero',
  'termina-0': 'Que termine en 0',
  'termina-50': 'Que termine en 50',
  'termina-90': 'Que termine en 90',
  'termina-99': 'Que termine en 99',
}

/**
 * Cada redondeo como (modulo, resto) en centavos: el precio queda con
 * `precio ≡ resto (mod modulo)`. "Termina en 90" es 9000 centavos de resto en
 * 10000 de modulo: $ 1.290, $ 1.390…
 */
const PASO: Record<Exclude<Redondeo, 'ninguno'>, { modulo: number; resto: number }> = {
  entero: { modulo: 100, resto: 0 },
  'termina-0': { modulo: 1_000, resto: 0 },
  'termina-50': { modulo: 10_000, resto: 5_000 },
  'termina-90': { modulo: 10_000, resto: 9_000 },
  'termina-99': { modulo: 10_000, resto: 9_900 },
}

export interface CriterioDePrecio {
  operacion: Operacion
  /**
   * Cadena canonica con hasta dos decimales: `"10.00"` es diez por ciento en
   * las de porcentaje y diez pesos en las de importe.
   */
  valor: string
  redondeo: Redondeo
}

export type ResultadoDePrecio = { ok: true; precio: Monto } | { ok: false; motivo: string }

/** Tope de precio, el mismo de `amountSchema`: 1e9 pesos. */
const TOPE_CENTAVOS = BigInt(100_000_000_000)

const CERO = BigInt(0)
const UNO = BigInt(1)
const DOS = BigInt(2)

/** Division entera redondeando medio hacia arriba, para numerador >= 0. */
function dividirRedondeando(n: bigint, d: bigint): bigint {
  return (DOS * n + d) / (DOS * d)
}

function dividirHaciaArriba(n: bigint, d: bigint): bigint {
  const q = n / d
  return q * d === n || n < CERO ? q : q + UNO
}

function dividirHaciaAbajo(n: bigint, d: bigint): bigint {
  const q = n / d
  return q * d === n || n >= CERO ? q : q - UNO
}

/** `"12.50"` → 1250. El valor ya viene validado por el esquema. */
function centesimas(valor: string): bigint {
  const [enteros = '0', decimales = ''] = valor.split('.')
  return BigInt(enteros + (decimales + '00').slice(0, 2))
}

/** Un costo con hasta cuatro decimales, en diezmilesimos: `"1543.125"` → 15431250. */
function diezmilesimos(costo: string): bigint {
  const [enteros = '0', decimales = ''] = costo.split('.')
  return BigInt(enteros + (decimales + '0000').slice(0, 4))
}

/**
 * El precio nuevo de UN producto.
 *
 * `costo` solo hace falta para "costo mas un porcentaje"; un producto sin
 * costo cargado no tiene precio nuevo en esa operacion, y lo dice.
 */
export function calcularPrecio(
  actual: Monto,
  costo: string | null,
  criterio: CriterioDePrecio,
): ResultadoDePrecio {
  const precio = BigInt(aCentavos(actual))
  const v = centesimas(criterio.valor)

  // El precio exacto, como fraccion `numerador / denominador` en centavos:
  // nada se redondea hasta el final.
  let numerador: bigint
  let denominador = UNO
  switch (criterio.operacion) {
    case 'aumentar':
      numerador = precio * (BigInt(10_000) + v)
      denominador = BigInt(10_000)
      break
    case 'disminuir':
      numerador = precio * (BigInt(10_000) - v)
      denominador = BigInt(10_000)
      break
    case 'sumar':
      numerador = precio + v
      break
    case 'restar':
      numerador = precio - v
      break
    case 'fijar':
      numerador = v
      break
    case 'costo-mas':
      if (costo === null) return { ok: false, motivo: 'No tiene costo cargado.' }
      // Costo en diezmilesimos de peso; el resultado, en centavos.
      numerador = diezmilesimos(costo) * (BigInt(10_000) + v)
      denominador = BigInt(1_000_000)
      break
  }

  let centavos: bigint
  if (criterio.operacion === 'fijar' || criterio.redondeo === 'ninguno') {
    if (numerador <= CERO) return { ok: false, motivo: 'Quedaría en cero o negativo.' }
    centavos = dividirRedondeando(numerador, denominador)
  } else {
    const { modulo, resto } = PASO[criterio.redondeo]
    const m = BigInt(modulo) * denominador
    const desplazado = numerador - BigInt(resto) * denominador
    // Para arriba si el precio sube --o si se calcula desde el costo, donde
    // bajar el precio seria bajar el margen que se pidio--; para abajo si baja.
    const sube = criterio.operacion === 'costo-mas' || numerador >= precio * denominador
    const vueltas = sube ? dividirHaciaArriba(desplazado, m) : dividirHaciaAbajo(desplazado, m)
    centavos = vueltas * BigInt(modulo) + BigInt(resto)
  }

  if (centavos <= CERO) return { ok: false, motivo: 'Quedaría en cero o negativo.' }
  if (centavos > TOPE_CENTAVOS) return { ok: false, motivo: 'Quedaría demasiado alto.' }
  return { ok: true, precio: desdeCentavos(Number(centavos)) }
}

/** Para mostrar: `"10.50"` → `"10,5"`. */
function porcentaje(valor: string): string {
  return textoLocalDeNumero(valor, { decimales: 2 })
}

/**
 * El criterio en castellano. Es el motivo que queda en la bitacora de cada
 * producto y el titulo del cambio en la pantalla, asi que las dos cosas dicen
 * exactamente lo mismo.
 */
export function describirCriterio(c: CriterioDePrecio): string {
  const valor = esPorcentaje(c.operacion) ? `${porcentaje(c.valor)} %` : formatearMonto(c.valor)
  const base: Record<Operacion, string> = {
    aumentar: `Aumento del ${valor}`,
    disminuir: `Baja del ${valor}`,
    sumar: `Suma de ${valor}`,
    restar: `Resta de ${valor}`,
    fijar: `Precio fijo de ${valor}`,
    'costo-mas': `Costo más ${valor}`,
  }
  if (c.operacion === 'fijar' || c.redondeo === 'ninguno') return base[c.operacion]
  return `${base[c.operacion]}, ${NOMBRE_DE_REDONDEO[c.redondeo].toLowerCase()}`
}

/**
 * Por que un criterio no se puede aplicar, o `null`.
 *
 * Los topes son los de sentido comun: bajar el 100 % deja todo en cero, y
 * subir mas del 1000 % es un cero de mas al tipear.
 */
export function motivoDeCriterioInvalido(c: CriterioDePrecio): string | null {
  const v = centesimas(c.valor)
  if (v <= CERO && c.operacion !== 'costo-mas') return 'El valor tiene que ser mayor que cero.'
  if (c.operacion === 'disminuir' && v >= BigInt(10_000)) {
    return 'Una baja tiene que ser menor que el 100 %.'
  }
  if (esPorcentaje(c.operacion) && v > BigInt(100_000)) {
    return 'El porcentaje no puede pasar del 1000 %.'
  }
  if (!esPorcentaje(c.operacion) && v > TOPE_CENTAVOS) return 'El importe es demasiado grande.'
  return null
}
