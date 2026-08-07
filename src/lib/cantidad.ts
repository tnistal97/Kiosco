/**
 * Cantidades, del lado del navegador y en el cable.
 *
 * Hermano exacto de `src/lib/money.ts`, con la escala que corresponde: el
 * dinero trabaja en CENTAVOS enteros y las cantidades en MILESIMAS enteras.
 *
 * Una cantidad viaja por la API como CADENA decimal --`"0.425"`-- y no como
 * numero, por el mismo motivo que un importe: un numero de JSON es un `double`
 * de IEEE 754, y mandarla asi la devolveria al tipo del que la estamos sacando
 * en esta misma fase. Ver docs/PHASE3_QUANTITY_MIGRATION.md.
 *
 * Por que hace falta aritmetica exacta tambien aca, y no solo en el dinero: el
 * libro de inventario tiene una restriccion en la base que dice
 *
 *   resultingQuantity = previousQuantity + quantity
 *
 * En punto flotante `0.1 + 0.2` da `0.30000000000000004`, y un ajuste de 100 g
 * sobre un saldo de 200 g escribiria una fila que PostgreSQL rechaza. La
 * restriccion no es un adorno: es lo que hace que el libro signifique algo.
 *
 * No entra ninguna biblioteca decimal al paquete del cliente. Con tres
 * decimales alcanza con enteros: la aritmetica de enteros en JavaScript es
 * exacta hasta 2^53, o sea nueve billones de kilos.
 *
 * El reparto de responsabilidades es el mismo que con el dinero, y tampoco es
 * negociable:
 *
 *   el navegador calcula para MOSTRAR;
 *   el servidor calcula para COBRAR.
 */

import { aCentavos, desdeCentavos, type Monto } from '@/lib/money'

/**
 * Cantidad con tres decimales, como cadena. `"0.425"`, `"12.000"`, `"-2.500"`.
 *
 * Alias de `string` y no una clase, por lo mismo que `Monto`: tiene que poder
 * viajar en JSON tal cual. Lo que garantiza la forma son las funciones de este
 * modulo, que son el unico lugar donde se construye una.
 */
export type TextoCantidad = string

/** Decimales de una cantidad. Un gramo dentro de un kilo. */
export const ESCALA_CANTIDAD = 3

/**
 * Tope de unidades por producto.
 *
 * Un almacen no tiene un millon de nada. El tope real de la columna es mucho
 * mayor --`numeric(14,3)` llega a once cifras enteras--; este es el limite de
 * la aplicacion, que es donde tiene que estar.
 *
 * Vive aca y no en `@/server/cantidad` porque lo necesitan los esquemas de
 * validacion, que llegan al navegador y no pueden arrastrar Prisma.
 */
export const CANTIDAD_MAX = 1_000_000

const MIL = 1000

export const CERO_CANTIDAD: TextoCantidad = '0.000'

const FORMA = /^[+-]?\d+(\.\d+)?$/

/**
 * Milesimas exactas de una cantidad.
 *
 * El parseo es POR CADENA, no `Number(c) * 1000`. Eso ultimo da
 * `424.99999999999994` para `"0.425"`, que es exactamente el problema que este
 * modulo existe para no tener.
 *
 * Con mas de tres decimales se redondea medio hacia arriba, igual que el
 * dinero. En la practica no llega ninguno: la validacion de la unidad los
 * rechaza antes.
 */
export function aMilesimas(cantidad: TextoCantidad): number {
  const texto = cantidad.trim()
  if (!FORMA.test(texto)) {
    throw new Error(`No es una cantidad: ${JSON.stringify(cantidad)}`)
  }

  const negativo = texto.startsWith('-')
  const sinSigno = texto.replace(/^[+-]/, '')
  const [enteros = '0', decimales = ''] = sinSigno.split('.')

  const tresPrimeros = (decimales + '000').slice(0, 3)
  const siguiente = decimales.charAt(3)

  let milesimas = Number(enteros) * MIL + Number(tresPrimeros)
  if (siguiente !== '' && Number(siguiente) >= 5) milesimas += 1

  if (!Number.isSafeInteger(milesimas)) {
    throw new Error(`Cantidad fuera de rango: ${cantidad}`)
  }
  return negativo ? -milesimas : milesimas
}

/** Cantidad a partir de milesimas enteras. */
export function desdeMilesimas(milesimas: number): TextoCantidad {
  if (!Number.isInteger(milesimas)) {
    throw new Error(`Las milesimas tienen que ser enteras: ${milesimas}`)
  }
  if (!Number.isSafeInteger(milesimas)) {
    throw new Error(`Cantidad fuera de rango: ${milesimas} milesimas`)
  }

  const signo = milesimas < 0 ? '-' : ''
  const absoluto = Math.abs(milesimas)
  const enteros = Math.trunc(absoluto / MIL)
  const resto = absoluto % MIL
  return `${signo}${enteros}.${String(resto).padStart(3, '0')}`
}

/**
 * Lleva a la forma canonica lo que llegue.
 *
 * Acepta cadena o numero para no romper a nadie en el borde de entrada. Un
 * numero es mejor esfuerzo: si ya venia con error de punto flotante, ese error
 * ocurrio antes de llegar aca y esto no lo puede inventar de vuelta.
 */
export function cantidad(valor: string | number): TextoCantidad {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error(`No es una cantidad: ${valor}`)
    return desdeMilesimas(aMilesimas(valor.toFixed(6)))
  }
  return desdeMilesimas(aMilesimas(valor))
}

/** Lo mismo, pero devuelve `null` en vez de lanzar. Para parsear respuestas. */
export function cantidadOpcional(valor: unknown): TextoCantidad | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor !== 'string' && typeof valor !== 'number') return null
  try {
    return cantidad(valor)
  } catch {
    return null
  }
}

/** Lo mismo, con valor por omision. Para parsear respuestas. */
export function cantidadODefecto(
  valor: unknown,
  porOmision: TextoCantidad = CERO_CANTIDAD,
): TextoCantidad {
  return cantidadOpcional(valor) ?? porOmision
}

/**
 * Lo que alguien escribe en un campo, convertido a cantidad.
 *
 * Acepta coma y punto decimal: la coma es lo que dice el teclado en castellano
 * y el punto es lo que sale del teclado numerico de una balanza o de un
 * telefono. Las dos formas se tipean de verdad en un mostrador.
 *
 * NO acepta separador de miles, a diferencia de `montoDesdeTexto`. Un peso
 * puede tener seis cifras y necesita el punto para leerse; nadie escribe
 * `1.500,250` kilos de queso, y aceptarlo haria ambiguo el `1.500` que en un
 * teclado numerico significa kilo y medio.
 *
 * Devuelve `null` --y no un cero-- cuando no es una cantidad. Un cero
 * silencioso significa "peso cero", que es una afirmacion muy distinta de
 * "todavia no escribi nada".
 */
export function cantidadDesdeTexto(entrada: string): TextoCantidad | null {
  const limpio = entrada.trim()
  if (limpio === '') return null

  const normalizado = limpio.replace(',', '.')
  if (!/^\d+(\.\d{1,3})?$/.test(normalizado)) return null

  try {
    return desdeMilesimas(aMilesimas(normalizado))
  } catch {
    return null
  }
}

export function sumarCantidades(...cantidades: TextoCantidad[]): TextoCantidad {
  return desdeMilesimas(cantidades.reduce((total, c) => total + aMilesimas(c), 0))
}

export function restarCantidades(a: TextoCantidad, b: TextoCantidad): TextoCantidad {
  return desdeMilesimas(aMilesimas(a) - aMilesimas(b))
}

export function compararCantidades(a: TextoCantidad, b: TextoCantidad): -1 | 0 | 1 {
  const ma = aMilesimas(a)
  const mb = aMilesimas(b)
  if (ma < mb) return -1
  if (ma > mb) return 1
  return 0
}

export function esCeroCantidad(c: TextoCantidad): boolean {
  return aMilesimas(c) === 0
}

export function esNegativaCantidad(c: TextoCantidad): boolean {
  return aMilesimas(c) < 0
}

export function esPositivaCantidad(c: TextoCantidad): boolean {
  return aMilesimas(c) > 0
}

export function negarCantidad(c: TextoCantidad): TextoCantidad {
  return desdeMilesimas(-aMilesimas(c))
}

export function minCantidad(a: TextoCantidad, b: TextoCantidad): TextoCantidad {
  return compararCantidades(a, b) <= 0 ? a : b
}

export function maxCantidad(a: TextoCantidad, b: TextoCantidad): TextoCantidad {
  return compararCantidades(a, b) >= 0 ? a : b
}

/**
 * Importe por una cantidad. LA cuenta de una linea del ticket.
 *
 *   $9.800,00 / kg  ×  0,425 kg  =  $4.165,00
 *
 * Toda la aritmetica es entera: centavos por milesimas da un entero exacto, y
 * la division final por mil se hace medio hacia arriba a mano. Sin esto,
 * `980000 * 0.425` en punto flotante da `416499.99999999994` y el subtotal
 * saldria un centavo abajo.
 *
 * Reemplaza a `multiplicarMonto` para las lineas de venta. Aquella sigue
 * existiendo para multiplicar por un factor que no es una cantidad de
 * mercaderia.
 */
export function precioPorCantidad(precio: Monto, cantidad: TextoCantidad): Monto {
  const centavos = aCentavos(precio)
  const milesimas = aMilesimas(cantidad)

  const producto = centavos * milesimas
  if (!Number.isSafeInteger(producto)) {
    throw new Error(`Subtotal fuera de rango: ${precio} × ${cantidad}`)
  }

  const signo = producto < 0 ? -1 : 1
  const absoluto = Math.abs(producto)
  const entero = Math.trunc(absoluto / MIL)
  const resto = absoluto % MIL

  return desdeCentavos(signo * (resto >= MIL / 2 ? entero + 1 : entero))
}

/**
 * Numero, y solo para lo que NO es una cantidad que se opera.
 *
 * Existe para el atributo `value` de un `<input type="number">` y para el
 * ancho de una barra de progreso. Nunca para sumar, restar ni comparar
 * mercaderia.
 */
export function aNumeroParaMostrar(c: TextoCantidad): number {
  return aMilesimas(c) / MIL
}
