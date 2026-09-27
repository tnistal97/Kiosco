/**
 * Que significa cada celda, campo por campo.
 *
 * La interpretacion de lo ESCRITO no se inventa aca: es la de
 * `@/lib/numero-local`, la misma que usan la caja y todos los formularios. Lo
 * que agrega este modulo es la tercera lectura que pedia la importacion. El
 * "1.500" no significa lo mismo en las tres columnas que lo pueden traer:
 *
 *   PRECIO / COSTO    mil quinientos pesos. Un importe no tiene tres
 *                     decimales, y "1.500,50" es como se escribe en pantalla.
 *   STOCK EN UNIDADES mil quinientas unidades. Media unidad no existe, asi que
 *                     el punto solo puede ser de miles.
 *   STOCK EN KG / L   uno y medio. Es lo que escribe una balanza, y es la regla
 *                     de cantidades de todo el sistema. Como aca puede
 *                     sorprender, la vista previa lo avisa en la fila.
 *
 * Un NUMERO guardado como numero en el .xlsx no pasa por esa lectura: no tiene
 * separadores, tiene el punto decimal de la maquina. Se toma con las quince
 * cifras con que lo muestra Excel y se lleva a la escala del campo.
 *
 * Una celda vacia es "no viene", nunca cero. Al actualizar un producto, lo que
 * no viene no se toca.
 *
 * Este modulo NO importa Prisma: lo usa el servidor para validar y sus pruebas
 * lo recorren sin base.
 */

import {
  REGLAS_DE_CANTIDAD,
  REGLAS_DE_COSTO,
  leerNumeroLocal,
  mensajeDeNumeroInvalido,
  type ReglasDeLectura,
} from '@/lib/numero-local'
import { compararMontos, monto, type Monto } from '@/lib/money'
import { CANTIDAD_MAX, aMilesimas, cantidad, type TextoCantidad } from '@/lib/cantidad'
import {
  esFraccionable,
  motivoDeCantidadInvalida,
  type UnidadDeVenta,
} from '@/modules/products/units'
import { motivoDeCodigoInvalido, normalizarCodigo } from '@/modules/products/barcode'
import type { ValorCrudo } from './columnas'

export type Lectura<T> =
  { ok: true; valor: T | null; aviso?: string } | { ok: false; error: string }

/** Tope de la columna `Product.name`, el mismo del formulario. */
export const NOMBRE_MAXIMO = 150

/** Tope del nombre de una categoria, el mismo de `crearCategoriaSchema`. */
export const CATEGORIA_MAXIMA = 80

/** El mismo tope de `amountSchema` y `costSchema`. */
const IMPORTE_MAXIMO: Monto = '1000000000.00'

const VACIO = { ok: true as const, valor: null }

function error(que: string, mensaje: string): { ok: false; error: string } {
  return { ok: false, error: `${que}: ${mensaje}` }
}

/** Los errores que Excel escribe en la celda en vez de un valor. */
const ERROR_DE_EXCEL =
  /^#(N\/A|DIV\/0!|REF!|VALUE!|NAME\?|NUM!|NULL!|SPILL!|CALC!|FIELD!|BLOCKED!|CONNECT!|BUSY!|UNKNOWN!|GETTING_DATA)$/i

function esVacio(v: ValorCrudo): boolean {
  return typeof v === 'string' && v.trim() === ''
}

function errorDeExcel(que: string, v: ValorCrudo): { ok: false; error: string } | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return ERROR_DE_EXCEL.test(t)
    ? error(que, `la celda tiene un error de Excel (${t}). Corregilo en la planilla.`)
    : null
}

// ---------------------------------------------------------------------------
// Numeros de Excel
// ---------------------------------------------------------------------------

/**
 * Un numero de Excel como decimal exacto: `"1815.6049999999998"` → `"1815.605"`.
 *
 * Excel guarda un `double` y MUESTRA quince cifras significativas. Esas quince
 * son las que el usuario vio en su planilla, y son las que se toman: el resto
 * es ruido del punto flotante que nadie escribio. Es el unico lugar donde un
 * numero pasa por `Number`, y es porque ya venia siendo un `double`.
 */
export function decimalDeExcel(n: string): string | null {
  const x = Number(n)
  if (!Number.isFinite(x)) return null
  return expandir(x.toPrecision(15))
}

/** `"1.23450000000000e+3"` → `"1234.5"`: sin exponente y sin ceros de relleno. */
function expandir(texto: string): string {
  const m = /^(-?)(\d+)(?:\.(\d+))?(?:e([+-]\d+))?$/i.exec(texto)
  if (!m) return texto
  const signo = m[1] ?? ''
  const enteros = m[2] ?? '0'
  let digitos = enteros + (m[3] ?? '')
  let punto = enteros.length + Number(m[4] ?? '0')

  if (punto <= 0) {
    digitos = '0'.repeat(1 - punto) + digitos
    punto = 1
  }
  if (punto > digitos.length) digitos += '0'.repeat(punto - digitos.length)

  const entera = digitos.slice(0, punto).replace(/^0+(?=\d)/, '')
  const fraccion = digitos.slice(punto).replace(/0+$/, '')
  const cuerpo = fraccion === '' ? entera : `${entera}.${fraccion}`
  return /^0(\.0*)?$/.test(cuerpo) ? '0' : signo + cuerpo
}

/**
 * Redondeo medio hacia arriba a `escala` decimales, por cadena.
 *
 * Es el de la calculadora y el del resto del sistema: `1815.605` a dos
 * decimales da `1815.61`.
 */
export function redondear(decimal: string, escala: number): string {
  const negativo = decimal.startsWith('-')
  const [enteros = '0', fraccion = ''] = decimal.replace(/^-/, '').split('.')
  if (fraccion.length <= escala) return decimal

  const base = BigInt(enteros + fraccion.slice(0, escala))
  const siguiente = fraccion.charCodeAt(escala) - 48
  const texto = (siguiente >= 5 ? base + BigInt(1) : base).toString().padStart(escala + 1, '0')
  const salida = escala === 0 ? texto : `${texto.slice(0, -escala)}.${texto.slice(-escala)}`
  return negativo && /[1-9]/.test(salida) ? `-${salida}` : salida
}

function decimalesDe(decimal: string): number {
  return decimal.split('.')[1]?.length ?? 0
}

/** Para los avisos: el decimal con coma, como lo lee una persona. */
function conComa(decimal: string): string {
  return decimal.replace('.', ',')
}

/**
 * El valor de una celda NUMERICA llevado a la escala del campo.
 *
 * Devuelve el aviso cuando hubo que redondear de verdad --un precio calculado
 * con una formula que dio `1815,605`--, no cuando solo se descarto ruido.
 */
function numeroDeExcel(
  que: string,
  n: string,
  escala: number,
): { ok: true; valor: string; aviso?: string } | { ok: false; error: string } {
  const exacto = decimalDeExcel(n)
  if (exacto === null) return error(que, 'no es un número')
  if (exacto.startsWith('-')) return error(que, 'no puede ser negativo')
  if (decimalesDe(exacto) <= escala) return { ok: true, valor: exacto }
  const redondeado = redondear(exacto, escala)
  return {
    ok: true,
    valor: redondeado,
    aviso: `${que}: ${conComa(exacto)} se redondeó a ${conComa(redondeado)}.`,
  }
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

/** Espacios de todo tipo, saltos de linea y caracteres de control, a un espacio. */
function limpiarTexto(t: string): string {
  // eslint-disable-next-line no-control-regex
  return t.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim()
}

function leerTexto(v: ValorCrudo, que: string, maximo: number): Lectura<string> {
  const crudo = typeof v === 'string' ? v : (decimalDeExcel(v.n) ?? v.n)
  const texto = limpiarTexto(crudo)
  if (texto === '') return VACIO
  const excel = errorDeExcel(que, texto)
  if (excel) return excel
  if (texto.length > maximo) return error(que, `tiene más de ${maximo} caracteres`)
  return { ok: true, valor: texto }
}

export function leerNombre(v: ValorCrudo): Lectura<string> {
  return leerTexto(v, 'Nombre', NOMBRE_MAXIMO)
}

export function leerCategoria(v: ValorCrudo): Lectura<string> {
  return leerTexto(v, 'Categoría', CATEGORIA_MAXIMA)
}

/**
 * Para comparar nombres de producto o de categoria: sin mayusculas, sin
 * acentos y sin espacios de mas. "Lácteos" y "LACTEOS" son la misma categoria.
 */
export function claveDeNombre(nombre: string): string {
  return nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

// ---------------------------------------------------------------------------
// Codigo de barras
// ---------------------------------------------------------------------------

/**
 * El codigo, con la regla de siempre (`@/modules/products/barcode`) y con los
 * tres estragos que Excel les hace a los codigos largos, explicados:
 *
 *   `7,79E+12`           notacion cientifica: el codigo se perdio al exportar
 *   `7.790.001.234.567`  separador de miles: la columna tiene formato numero
 *   mas de 15 cifras     Excel redondeo el numero al guardarlo
 *
 * Los tres tienen el mismo arreglo --formato Texto en la columna-- y decirlo
 * ahorra una tarde de buscar por que "no anda".
 */
export function leerCodigo(v: ValorCrudo): Lectura<string> {
  const que = 'Código'
  let codigo: string
  let aviso: string | undefined

  if (typeof v !== 'string') {
    const x = Number(v.n)
    if (!Number.isFinite(x) || x < 0) return error(que, 'no es un código válido')
    if (x >= 1e15) {
      return error(
        que,
        'tiene más de 15 cifras y Excel lo redondeó al guardarlo como número. ' +
          'Poné la columna en formato Texto y volvé a cargar los códigos.',
      )
    }
    const exacto = decimalDeExcel(v.n)
    if (exacto === null || !/^\d+$/.test(exacto)) return error(que, 'no es un código válido')
    codigo = exacto
    // Un EAN-13 que empezaba con 0 queda con 12 cifras.
    if (codigo.length === 11 || codigo.length === 12) {
      aviso =
        'Código: Excel lo guardó como número; si empezaba con 0, se lo sacó. ' +
        'Revisalo contra la etiqueta.'
    }
  } else {
    codigo = v.trim()
    if (codigo === '') return VACIO
    const excel = errorDeExcel(que, codigo)
    if (excel) return excel
    if (/^\d+([.,]\d+)?[eE]\+?\d+$/.test(codigo)) {
      return error(
        que,
        `quedó en notación científica (${codigo}) y se perdieron cifras. ` +
          'Poné la columna en formato Texto y volvé a exportar.',
      )
    }
    if (/^\d{1,3}([.,]\d{3})+$/.test(codigo)) {
      return error(
        que,
        `tiene separador de miles (${codigo}): la columna está en formato número. ` +
          'Poné la columna en formato Texto y volvé a exportar.',
      )
    }
  }

  const motivo = motivoDeCodigoInvalido(codigo)
  if (motivo !== null) return error(que, motivo.charAt(0).toLowerCase() + motivo.slice(1))
  const valor = normalizarCodigo(codigo)
  return aviso === undefined ? { ok: true, valor } : { ok: true, valor, aviso }
}

// ---------------------------------------------------------------------------
// Unidad
// ---------------------------------------------------------------------------

const NOMBRES_DE_UNIDAD: ReadonlyArray<readonly [UnidadDeVenta, readonly string[]]> = [
  [
    'UNIT',
    [
      'unit',
      'u',
      'un',
      'und',
      'unid',
      'unidad',
      'unidades',
      'c u',
      'cu',
      'x unidad',
      'por unidad',
      'pieza',
      'piezas',
    ],
  ],
  ['KG', ['kg', 'kgs', 'kilo', 'kilos', 'kilogramo', 'kilogramos', 'x kg', 'por kilo', 'por kg']],
  ['G', ['g', 'gr', 'grs', 'gramo', 'gramos']],
  ['L', ['l', 'lt', 'lts', 'litro', 'litros', 'x litro', 'por litro']],
  ['ML', ['ml', 'cc', 'mililitro', 'mililitros']],
]

export function leerUnidad(v: ValorCrudo): Lectura<UnidadDeVenta> {
  const que = 'Unidad'
  if (typeof v !== 'string') return error(que, 'tiene un número; se espera unidad, kg, g, l o ml')
  const texto = v.trim()
  if (texto === '') return VACIO
  const excel = errorDeExcel(que, texto)
  if (excel) return excel

  const clave = texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  for (const [unidad, nombres] of NOMBRES_DE_UNIDAD) {
    if (nombres.includes(clave)) return { ok: true, valor: unidad }
  }
  return error(que, `no se reconoce «${texto}». Usá unidad, kg, g, l o ml.`)
}

// ---------------------------------------------------------------------------
// Dinero
// ---------------------------------------------------------------------------

/** Precio: dos decimales, "1.500" son mil quinientos, nunca negativo. */
const REGLAS_DE_PRECIO: ReglasDeLectura = { decimales: 2, puntoEsMiles: true, negativos: false }

/**
 * "1,500" sin punto: en castellano es uno coma cinco --con un decimal de mas--
 * y en ingles es mil quinientos. No se adivina.
 */
function comaAmbigua(texto: string): boolean {
  return /^\$?\s*\d{1,3}(,\d{3})+$/.test(texto.trim())
}

function mensajeAmbiguo(texto: string): string {
  return (
    `«${texto.trim()}» se puede leer de dos formas. ` +
    'Escribí 1500 o 1.500 para mil quinientos, o 1,50 para uno con cincuenta.'
  )
}

export function leerPrecio(v: ValorCrudo): Lectura<Monto> {
  const que = 'Precio'
  if (esVacio(v)) return VACIO
  const excel = errorDeExcel(que, v)
  if (excel) return excel

  let canonico: string
  let aviso: string | undefined
  if (typeof v === 'string') {
    if (comaAmbigua(v)) return error(que, mensajeAmbiguo(v))
    const lectura = leerNumeroLocal(v, REGLAS_DE_PRECIO)
    if (lectura.estado === 'vacio') return VACIO
    if (lectura.estado === 'invalido') {
      return error(que, mensajeDeNumeroInvalido(lectura.motivo, 'importe'))
    }
    canonico = lectura.valor
  } else {
    const n = numeroDeExcel(que, v.n, 2)
    if (!n.ok) return n
    canonico = n.valor
    aviso = n.aviso
  }

  const valor = monto(canonico)
  if (compararMontos(valor, '0.00') <= 0) return error(que, 'tiene que ser mayor que cero')
  if (compararMontos(valor, IMPORTE_MAXIMO) > 0) return error(que, 'es demasiado grande')
  return aviso === undefined ? { ok: true, valor } : { ok: true, valor, aviso }
}

/**
 * El costo: como el precio pero con cuatro decimales --se deriva de dividir una
 * caja por sus unidades-- y admitiendo cero, que es "me lo regalaron" y no "no
 * se sabe". "No se sabe" es la celda vacia.
 */
export function leerCosto(v: ValorCrudo): Lectura<string> {
  const que = 'Costo'
  if (esVacio(v)) return VACIO
  const excel = errorDeExcel(que, v)
  if (excel) return excel

  let canonico: string
  let aviso: string | undefined
  if (typeof v === 'string') {
    if (comaAmbigua(v)) return error(que, mensajeAmbiguo(v))
    const lectura = leerNumeroLocal(v, REGLAS_DE_COSTO)
    if (lectura.estado === 'vacio') return VACIO
    if (lectura.estado === 'invalido') {
      return error(
        que,
        lectura.motivo === 'demasiados-decimales'
          ? 'va con cuatro decimales como máximo.'
          : mensajeDeNumeroInvalido(lectura.motivo, 'importe'),
      )
    }
    canonico = lectura.valor
  } else {
    const n = numeroDeExcel(que, v.n, 4)
    if (!n.ok) return n
    canonico = n.valor
    aviso = n.aviso
  }

  const [enteros = '0', fraccion = ''] = canonico.split('.')
  const valor = `${enteros.replace(/^0+(?=\d)/, '')}.${(fraccion + '0000').slice(0, 4)}`
  if (compararMontos(monto(redondear(valor, 2)), IMPORTE_MAXIMO) > 0) {
    return error(que, 'es demasiado grande')
  }
  return aviso === undefined ? { ok: true, valor } : { ok: true, valor, aviso }
}

// ---------------------------------------------------------------------------
// Cantidades
// ---------------------------------------------------------------------------

/**
 * Las reglas de lectura de una cantidad segun la unidad del producto.
 *
 * Unidades, gramos y mililitros no tienen fracciones: ahi el punto solo puede
 * ser de miles. Kilos y litros si: ahi manda la regla de todo el sistema.
 */
export function reglasDeCantidad(unidad: UnidadDeVenta): ReglasDeLectura {
  return esFraccionable(unidad)
    ? REGLAS_DE_CANTIDAD
    : { decimales: 3, puntoEsMiles: true, negativos: false }
}

export function leerCantidad(
  v: ValorCrudo,
  unidad: UnidadDeVenta,
  que: 'Stock' | 'Stock mínimo',
): Lectura<TextoCantidad> {
  if (esVacio(v)) return VACIO
  const excel = errorDeExcel(que, v)
  if (excel) return excel

  let canonico: string
  let aviso: string | undefined
  if (typeof v === 'string') {
    const lectura = leerNumeroLocal(v, reglasDeCantidad(unidad))
    if (lectura.estado === 'vacio') return VACIO
    if (lectura.estado === 'invalido') {
      return error(que, mensajeDeNumeroInvalido(lectura.motivo, 'cantidad'))
    }
    canonico = lectura.valor
    // El kilo y medio de la balanza: correcto por la regla del sistema, pero
    // en una planilla puede no ser lo que se quiso decir. Se avisa en la fila.
    if (esFraccionable(unidad) && /^\d{1,3}\.\d{3}$/.test(v.trim())) {
      const leido = cantidad(canonico)
        .replace(/\.?0+$/, '')
        .replace('.', ',')
      aviso =
        `${que}: «${v.trim()}» se leyó como ${leido} ${unidad === 'KG' ? 'kg' : 'L'}. ` +
        `Si eran ${v.trim().replace('.', '')}, escribilo sin el punto.`
    }
  } else {
    const n = numeroDeExcel(que, v.n, 3)
    if (!n.ok) return n
    canonico = n.valor
    aviso = n.aviso
  }

  const valor = cantidad(canonico)
  if (aMilesimas(valor) > CANTIDAD_MAX * 1000) return error(que, 'es demasiado grande')
  if (aMilesimas(valor) > 0) {
    const motivo = motivoDeCantidadInvalida(unidad, valor)
    if (motivo !== null) return error(que, motivo.charAt(0).toLowerCase() + motivo.slice(1))
  }
  return aviso === undefined ? { ok: true, valor } : { ok: true, valor, aviso }
}
