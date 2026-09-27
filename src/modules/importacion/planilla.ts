/**
 * Una planilla de productos, leida en el navegador.
 *
 * El archivo NO viaja al servidor. Se lee aca, se muestra, se mapea, y al
 * servidor van solo las celdas de las columnas elegidas. Tres consecuencias
 * buscadas:
 *
 *   · el servidor nunca guarda ni abre un archivo ajeno: no hay carpeta de
 *     subidas que limpiar, ni un .xlsx malicioso descomprimiendose en el
 *     proceso que atiende la caja;
 *   · lo que el servidor recibe es JSON con forma fija, que valida con el
 *     mismo cuidado que cualquier otra entrada;
 *   · volver a pedir la vista previa no obliga a subir el archivo otra vez.
 *
 * Que la lectura sea del navegador NO es confiar en el navegador: el servidor
 * vuelve a validar cada valor, cada fila y cada permiso. Ver `service.ts`.
 *
 * Este modulo NO importa Prisma.
 */

import { ErrorDePlanilla } from './errores'
import { decodificar, detectarSeparador, leerCsv, type Codificacion, type Separador } from './csv'
import { leerXlsx } from './xlsx'

/** Tope del archivo. Un catalogo de 10.000 productos en .xlsx pesa menos de 1 MB. */
export const TAMANO_MAXIMO = 10 * 1024 * 1024

/** Tope de productos por archivo. El pedido era 2.000 a 5.000: el doble, con margen. */
export const PRODUCTOS_MAXIMOS = 10_000

/**
 * Filas que se leen como mucho: los productos mas unas cuantas de titulo y de
 * encabezado. Pasado esto se corta la lectura sin terminar de recorrer.
 */
const FILAS_MAXIMAS = PRODUCTOS_MAXIMOS + 50

/**
 * Un numero guardado como NUMERO en el .xlsx, con la forma exacta que escribio
 * Excel: `"1500.5"`, `"7.790001234567E12"`.
 *
 * Viaja aparte del texto porque significa otra cosa. `1.5` guardado como
 * numero es uno y medio sin discusion; `"1.500"` escrito como texto es mil
 * quinientos pesos o un kilo y medio segun la columna. Ver `valores.ts`.
 */
export interface NumeroDeCelda {
  n: string
}

/** Texto tal cual, `''` si esta vacia, o un numero de Excel. */
export type Celda = string | NumeroDeCelda

export interface FilaDePlanilla {
  /** El numero de fila que muestra Excel. Es el que se cita en los errores. */
  numero: number
  celdas: Celda[]
}

export interface Planilla {
  tipo: 'xlsx' | 'csv'
  /** La hoja que se leyo. Null en un .csv. */
  hoja: string | null
  /** Las demas hojas del libro, para avisar que no se leyeron. */
  otrasHojas: string[]
  separador: Separador | null
  codificacion: Codificacion | null
  filas: FilaDePlanilla[]
}

export function esNumeroDeCelda(c: Celda | undefined): c is NumeroDeCelda {
  return typeof c === 'object'
}

/** Para mostrar en pantalla: un numero de Excel se muestra con coma decimal. */
export function textoDeCelda(c: Celda | undefined): string {
  if (c === undefined) return ''
  if (typeof c === 'string') return c
  return c.n.includes('E') || c.n.includes('e') ? c.n : c.n.replace('.', ',')
}

type Firma = 'zip' | 'ole' | 'binario' | 'texto'

/**
 * Que clase de archivo es, por sus primeros bytes y no por su extension.
 *
 * La extension la elige quien guarda el archivo; los primeros bytes, el
 * programa que lo escribio. Un ejecutable renombrado a .csv tiene "MZ" al
 * principio igual.
 */
function firmaDe(b: Uint8Array): Firma {
  const empieza = (...bytes: number[]) => bytes.every((x, i) => b[i] === x)

  if (empieza(0x50, 0x4b, 0x03, 0x04)) return 'zip'
  if (empieza(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'ole'
  if (
    empieza(0x4d, 0x5a) || // MZ: ejecutable de Windows
    empieza(0x7f, 0x45, 0x4c, 0x46) || // ELF
    empieza(0x25, 0x50, 0x44, 0x46) || // %PDF
    empieza(0x89, 0x50, 0x4e, 0x47) || // PNG
    empieza(0xff, 0xd8, 0xff) || // JPEG
    empieza(0x47, 0x49, 0x46, 0x38) || // GIF
    empieza(0x1f, 0x8b) || // gzip
    empieza(0x52, 0x61, 0x72, 0x21) || // RAR
    empieza(0x37, 0x7a, 0xbc, 0xaf) // 7z
  ) {
    return 'binario'
  }
  return 'texto'
}

/** Lee el archivo entero. Lanza `ErrorDePlanilla` con el motivo si no puede. */
export async function leerPlanilla(nombre: string, bytes: Uint8Array): Promise<Planilla> {
  if (bytes.length === 0) throw new ErrorDePlanilla('vacio')
  if (bytes.length > TAMANO_MAXIMO) throw new ErrorDePlanilla('demasiado-grande')

  const extension = nombre.toLowerCase().split('.').pop() ?? ''
  if (['xlsm', 'xltm', 'xlam', 'xlsb'].includes(extension)) throw new ErrorDePlanilla('macros')

  const firma = firmaDe(bytes)

  if (firma === 'ole') throw new ErrorDePlanilla('xls-antiguo')
  if (firma === 'binario') throw new ErrorDePlanilla('no-es-planilla')

  if (firma === 'zip') {
    // Un .ods tambien es un .zip; lo delata su primera parte, que se llama
    // "mimetype" y va sin comprimir.
    const cabecera = new TextDecoder('latin1').decode(bytes.subarray(30, 120))
    if (cabecera.includes('opendocument')) throw new ErrorDePlanilla('ods')

    const leida = await leerXlsx(bytes, FILAS_MAXIMAS)
    if (leida.filas.length === 0) throw new ErrorDePlanilla('sin-datos')
    return {
      tipo: 'xlsx',
      hoja: leida.hoja,
      otrasHojas: leida.otrasHojas,
      separador: null,
      codificacion: null,
      filas: leida.filas,
    }
  }

  const { texto, codificacion } = decodificar(bytes)
  // Un binario sin firma conocida casi siempre tiene bytes nulos: ningun texto
  // escrito por una persona los tiene.
  if (texto.includes('\u0000')) throw new ErrorDePlanilla('no-es-planilla')

  const separador = detectarSeparador(texto)
  const filas = leerCsv(texto, separador, FILAS_MAXIMAS)
  if (filas.length === 0) throw new ErrorDePlanilla('sin-datos')

  return { tipo: 'csv', hoja: null, otrasHojas: [], separador, codificacion, filas }
}
