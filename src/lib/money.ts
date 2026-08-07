/**
 * Dinero, del lado del navegador y en el cable.
 *
 * Un importe viaja por la API como CADENA decimal --`"1234.56"`-- y no como
 * numero. Un numero de JSON es un `double` de IEEE 754: mandarlo asi lo
 * devolveria al tipo del que lo estamos sacando en esta misma fase. Ver
 * docs/PHASE3_MONEY_MIGRATION.md.
 *
 * El navegador tambien necesita hacer cuentas: el vuelto mientras se escribe,
 * el restante de un pago combinado. Hacerlas en punto flotante mostraria
 * "restan $0,00" cuando en realidad falta un centavo.
 *
 * No se agrego una biblioteca decimal al paquete del cliente. Para dos
 * decimales alcanza con trabajar en CENTAVOS ENTEROS: la aritmetica de enteros
 * en JavaScript es exacta hasta 2^53, o sea unos noventa billones de pesos, y
 * no pesa un byte.
 *
 * Reparto de responsabilidades, y no es negociable:
 *
 *   el navegador calcula para MOSTRAR;
 *   el servidor calcula para COBRAR.
 *
 * Lo que se ve mientras se escribe es una previsualizacion. El total, el
 * vuelto y el reparto de pagos que quedan guardados los recalcula el servidor
 * contra la base.
 */

/**
 * Importe con dos decimales, como cadena. `"1234.56"`, `"-90.00"`, `"0.00"`.
 *
 * Es un alias de `string` y no una clase: tiene que poder viajar en JSON tal
 * cual, sin serializador de por medio. Lo que garantiza la forma son las
 * funciones de este modulo, que son el unico lugar donde se construye uno.
 */
export type Monto = string

export const CERO: Monto = '0.00'

/** Ocho dias de facturacion de un almacen no llegan; un desborde, si. */
const MAX_CENTAVOS = Number.MAX_SAFE_INTEGER

const FORMA = /^[+-]?\d+(\.\d+)?$/

/**
 * Centavos exactos de un importe.
 *
 * El parseo es POR CADENA, no `Number(m) * 100`. Eso ultimo da
 * `114.99999999999999` para `"1.15"`, que es precisamente el problema que este
 * modulo existe para no tener.
 *
 * Si vienen mas de dos decimales --un costo unitario, que se guarda con
 * cuatro-- se redondea medio hacia arriba. Es lo que hace una calculadora.
 */
export function aCentavos(monto: Monto): number {
  const texto = monto.trim()
  if (!FORMA.test(texto)) {
    throw new Error(`No es un importe: ${JSON.stringify(monto)}`)
  }

  const negativo = texto.startsWith('-')
  const sinSigno = texto.replace(/^[+-]/, '')
  const [enteros = '0', decimales = ''] = sinSigno.split('.')

  const dosPrimeros = (decimales + '00').slice(0, 2)
  const siguiente = decimales.charAt(2)

  let centavos = Number(enteros) * 100 + Number(dosPrimeros)
  // Medio hacia arriba sobre el valor ABSOLUTO: -1.005 va a -1.01, igual que
  // 1.005 va a 1.01. Redondear el negativo "hacia arriba" en la recta lo
  // llevaria a -1.00 y dos importes simetricos dejarian de serlo.
  if (siguiente !== '' && Number(siguiente) >= 5) centavos += 1

  if (!Number.isSafeInteger(centavos)) {
    throw new Error(`Importe fuera de rango: ${monto}`)
  }
  return negativo ? -centavos : centavos
}

/** Importe a partir de centavos enteros. */
export function desdeCentavos(centavos: number): Monto {
  if (!Number.isInteger(centavos)) {
    throw new Error(`Los centavos tienen que ser enteros: ${centavos}`)
  }
  if (Math.abs(centavos) > MAX_CENTAVOS) {
    throw new Error(`Importe fuera de rango: ${centavos} centavos`)
  }

  const signo = centavos < 0 ? '-' : ''
  const absoluto = Math.abs(centavos)
  const enteros = Math.trunc(absoluto / 100)
  const resto = absoluto % 100
  return `${signo}${enteros}.${String(resto).padStart(2, '0')}`
}

/**
 * Lleva a la forma canonica lo que llegue.
 *
 * Acepta cadena o numero para no romper a nadie en el borde de entrada. Un
 * numero es mejor esfuerzo: si ya venia con error de punto flotante, ese error
 * ya ocurrio antes de llegar aca y esto no lo puede inventar de vuelta.
 */
export function monto(valor: string | number): Monto {
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error(`No es un importe: ${valor}`)
    // `toFixed` redondea sobre la representacion decimal del double, que es
    // lo mas fiel que se puede ser con lo que ya llego roto.
    return desdeCentavos(aCentavos(valor.toFixed(4)))
  }
  return desdeCentavos(aCentavos(valor))
}

/** Lo mismo, pero devuelve `null` en vez de lanzar. Para parsear respuestas. */
export function montoOpcional(valor: unknown): Monto | null {
  if (valor === null || valor === undefined) return null
  if (typeof valor !== 'string' && typeof valor !== 'number') return null
  try {
    return monto(valor)
  } catch {
    return null
  }
}

/** Lo mismo, con valor por omision. Para parsear respuestas. */
export function montoODefecto(valor: unknown, porOmision: Monto = CERO): Monto {
  return montoOpcional(valor) ?? porOmision
}

/**
 * Lo que alguien escribe en un campo, convertido a importe.
 *
 * Acepta las dos formas que se tipean de verdad en un mostrador:
 *
 *   "1234,56"   coma decimal, que es lo que dice el teclado en castellano
 *   "1234.56"   punto decimal, que es lo que sale del teclado numerico
 *   "1.234,56"  con separador de miles, que es como se lee en pantalla
 *
 * Devuelve `null` --y no un cero-- cuando no es un importe. Un cero silencioso
 * en un arqueo significa "conte cero pesos", que es una afirmacion muy
 * distinta de "todavia no escribi nada".
 *
 * Rechaza mas de dos decimales por la misma razon que el servidor: no se puede
 * cobrar medio centavo, y aceptarlo en el campo obligaria a explicar despues
 * por que el numero cambio solo.
 */
export function montoDesdeTexto(entrada: string): Monto | null {
  const limpio = entrada.trim()
  if (limpio === '') return null

  // Con los dos separadores presentes, el punto es de miles y la coma es
  // decimal: "1.234,56". Es el unico caso sin ambiguedad.
  const normalizado =
    limpio.includes(',') && limpio.includes('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(',', '.')

  if (!/^[+-]?\d+(\.\d{1,2})?$/.test(normalizado)) return null

  try {
    return desdeCentavos(aCentavos(normalizado))
  } catch {
    return null
  }
}

export function sumarMontos(...montos: Monto[]): Monto {
  return desdeCentavos(montos.reduce((total, m) => total + aCentavos(m), 0))
}

export function restarMontos(a: Monto, b: Monto): Monto {
  return desdeCentavos(aCentavos(a) - aCentavos(b))
}

/**
 * Importe por una cantidad.
 *
 * La cantidad puede ser fraccionaria --0,425 kg de queso-- asi que el producto
 * se hace en centavos y se redondea medio hacia arriba UNA sola vez, al final.
 * Redondear antes seria cobrar el error.
 */
export function multiplicarMonto(m: Monto, cantidad: number): Monto {
  if (!Number.isFinite(cantidad)) throw new Error(`Cantidad invalida: ${cantidad}`)
  const exacto = aCentavos(m) * cantidad
  return desdeCentavos(Math.sign(exacto) * Math.round(Math.abs(exacto)))
}

export function compararMontos(a: Monto, b: Monto): -1 | 0 | 1 {
  const ca = aCentavos(a)
  const cb = aCentavos(b)
  if (ca < cb) return -1
  if (ca > cb) return 1
  return 0
}

export function esCero(m: Monto): boolean {
  return aCentavos(m) === 0
}

export function esNegativo(m: Monto): boolean {
  return aCentavos(m) < 0
}

export function esPositivo(m: Monto): boolean {
  return aCentavos(m) > 0
}

export function negarMonto(m: Monto): Monto {
  return desdeCentavos(-aCentavos(m))
}

export function absMonto(m: Monto): Monto {
  return desdeCentavos(Math.abs(aCentavos(m)))
}

export function maxMonto(a: Monto, b: Monto): Monto {
  return compararMontos(a, b) >= 0 ? a : b
}

export function minMonto(a: Monto, b: Monto): Monto {
  return compararMontos(a, b) <= 0 ? a : b
}

/**
 * Para mostrar. `"$ 1.234,56"`.
 *
 * Se divide por 100 aca y no antes: la division introduce el error del double,
 * pero `Intl` con dos decimales lo vuelve a redondear al mismo valor. Es el
 * ultimo paso y lo unico que sale de el es texto.
 */
const FORMATO = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatearMonto(m: Monto): string {
  return FORMATO.format(aCentavos(m) / 100)
}

/**
 * Numero, y solo para lo que NO es dinero.
 *
 * Existe para porcentajes y para graficos: un margen del 37,5 % no es un
 * importe. Nunca para sumar, restar ni comparar plata.
 */
export function aNumeroParaMostrar(m: Monto): number {
  return aCentavos(m) / 100
}
