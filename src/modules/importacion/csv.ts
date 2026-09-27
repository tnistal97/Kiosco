/**
 * Lectura de un .csv tal como lo escribe Excel en una PC en castellano.
 *
 * Tres cosas que un lector de CSV "estandar" hace mal con un archivo de aca:
 *
 *   SEPARADOR    Excel en es-AR separa con punto y coma, porque la coma es el
 *                separador decimal. Se detecta mirando las primeras lineas: el
 *                que aparece la misma cantidad de veces en todas.
 *   CODIFICACION "CSV (delimitado por comas)" sale en Windows-1252, no en
 *                UTF-8: "Lácteos" llega como bytes que en UTF-8 no son validos.
 *                Se prueba UTF-8 estricto y, si falla, Windows-1252. La marca
 *                de orden de bytes, si esta, manda.
 *   COMILLAS     un nombre con punto y coma o con salto de linea adentro viene
 *                entre comillas, y dos comillas seguidas son una comilla.
 *
 * Una comilla que abre y nunca cierra se rechaza: tragaria el resto del
 * archivo en una sola celda y el error se veria recien en la vista previa,
 * como "falta el precio" en todas las filas.
 *
 * Este modulo NO importa Prisma: corre en el navegador.
 */

import { ErrorDePlanilla } from './errores'
import type { FilaDePlanilla } from './planilla'

export type Codificacion = 'utf-8' | 'utf-16le' | 'utf-16be' | 'windows-1252'
export type Separador = ';' | ',' | '\t' | '|'

/** Candidatos en orden de preferencia cuando empatan. */
const SEPARADORES: readonly Separador[] = [';', '\t', ',', '|']

export function decodificar(bytes: Uint8Array): { texto: string; codificacion: Codificacion } {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { texto: new TextDecoder('utf-8').decode(bytes.subarray(3)), codificacion: 'utf-8' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      texto: new TextDecoder('utf-16le').decode(bytes.subarray(2)),
      codificacion: 'utf-16le',
    }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      texto: new TextDecoder('utf-16be').decode(bytes.subarray(2)),
      codificacion: 'utf-16be',
    }
  }
  try {
    return { texto: new TextDecoder('utf-8', { fatal: true }).decode(bytes), codificacion: 'utf-8' }
  } catch {
    return { texto: new TextDecoder('windows-1252').decode(bytes), codificacion: 'windows-1252' }
  }
}

/** Cuantas veces aparece `sep` en la linea, sin contar lo que esta entre comillas. */
function contarFuera(linea: string, sep: string): number {
  let n = 0
  let enComillas = false
  for (const ch of linea) {
    if (ch === '"') enComillas = !enComillas
    else if (ch === sep && !enComillas) n++
  }
  return n
}

/**
 * El separador de columnas.
 *
 * Gana el que aparece en la primera linea y se repite la MISMA cantidad de
 * veces en la mayor parte de las siguientes. La coma de "1500,50" no gana en un
 * archivo separado por punto y coma: aparece en unas lineas si y en otras no.
 */
export function detectarSeparador(texto: string): Separador {
  const lineas = texto
    .split(/\r\n|\n|\r/)
    .filter((l) => l.trim() !== '')
    .slice(0, 20)
  const primera = lineas[0]
  if (primera === undefined) return ';'

  let mejor: Separador = ';'
  let mejorPuntaje = -1

  for (const sep of SEPARADORES) {
    const esperado = contarFuera(primera, sep)
    if (esperado === 0) continue
    const coinciden = lineas.filter((l) => contarFuera(l, sep) === esperado).length
    // Primero la consistencia, despues cuantas columnas arma.
    const puntaje = (coinciden / lineas.length) * 1000 + Math.min(esperado, 999)
    if (puntaje > mejorPuntaje) {
      mejor = sep
      mejorPuntaje = puntaje
    }
  }
  return mejor
}

/**
 * Las filas del archivo, numeradas como las numera Excel al abrirlo.
 *
 * Una fila con un salto de linea entre comillas sigue siendo UNA fila, y la
 * siguiente lleva el numero siguiente: es el que el usuario va a buscar cuando
 * la vista previa le diga "fila 57".
 */
export function leerCsv(
  texto: string,
  separador: Separador,
  limiteDeFilas: number,
): FilaDePlanilla[] {
  const filas: FilaDePlanilla[] = []
  let celdas: string[] = []
  let campo = ''
  let enComillas = false
  let numero = 1
  let abrioEn = 0

  const cerrarFila = () => {
    celdas.push(campo)
    campo = ''
    while (celdas.length > 0 && (celdas[celdas.length - 1] ?? '').trim() === '') celdas.pop()
    if (celdas.length > 0) {
      filas.push({ numero, celdas })
      if (filas.length > limiteDeFilas) throw new ErrorDePlanilla('demasiadas-filas')
    }
    celdas = []
    numero++
  }

  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i]

    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') {
          campo += '"'
          i++
        } else {
          enComillas = false
        }
      } else {
        campo += ch
      }
      continue
    }

    if (ch === '"' && campo.trim() === '') {
      campo = ''
      enComillas = true
      abrioEn = numero
    } else if (ch === separador) {
      celdas.push(campo)
      campo = ''
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && texto[i + 1] === '\n') i++
      cerrarFila()
    } else {
      campo += ch
    }
  }

  if (enComillas) {
    throw new ErrorDePlanilla(
      'corrupto',
      `Hay una comilla que abre en la fila ${abrioEn} y no cierra.`,
    )
  }
  if (campo !== '' || celdas.length > 0) cerrarFila()

  return filas
}
