/**
 * Lectura de un .zip, lo justo para abrir un .xlsx.
 *
 * Un .xlsx es un .zip con XML adentro. No se agrego una biblioteca para esto:
 * la descompresion la hace `DecompressionStream`, que viene en el navegador y
 * en Node, y el indice del .zip son cincuenta lineas. Una dependencia de
 * planillas completa --que ademas sabe ESCRIBIR, calcular formulas y leer
 * formatos que aca no se aceptan-- era mucha superficie para lo que se usa.
 *
 * Tres defensas, porque el archivo lo elige cualquiera:
 *
 *   TAMANO   cada parte se descomprime contando bytes y se corta al pasar el
 *            tope, aunque el indice diga que es chica. Un .zip de 10 MB puede
 *            declarar 1 KB y expandirse a 10 GB: el tope se aplica a lo que
 *            SALE, no a lo que se declara.
 *   CRC      cada parte se comprueba contra su CRC-32. Un archivo cortado o
 *            dañado se rechaza en vez de leerse a medias.
 *   CIFRADO  una parte cifrada se rechaza: no hay contraseña que pedir.
 *
 * ZIP64 no se acepta. Existe para archivos de mas de 4 GB, y aca el tope es 10
 * MB. Este modulo NO importa Prisma: corre en el navegador.
 */

import { ErrorDePlanilla } from './errores'

const FIRMA_FIN = 0x06054b50
const FIRMA_CENTRAL = 0x02014b50
const FIRMA_LOCAL = 0x04034b50

/** Un .xlsx de verdad tiene una docena de partes. Mil ya no es una planilla. */
const MAXIMO_DE_ENTRADAS = 1_000

export interface EntradaZip {
  nombre: string
  /** 0 guardada tal cual, 8 comprimida con deflate. Ninguna otra se acepta. */
  metodo: number
  crc: number
  comprimido: number
  original: number
  /** Donde empieza su cabecera local dentro del archivo. */
  offset: number
}

function vistaDe(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/**
 * El indice del .zip: nombre de cada parte y donde esta.
 *
 * Se lee el directorio CENTRAL, al final del archivo, y no las cabeceras
 * locales: las locales pueden venir con los tamaños en cero cuando el programa
 * que armo el .zip no los sabia al escribir, y el central siempre los tiene.
 */
export function leerIndice(bytes: Uint8Array): Map<string, EntradaZip> {
  try {
    return leerIndiceSinCapturar(bytes)
  } catch (error) {
    if (error instanceof ErrorDePlanilla) throw error
    // Un RangeError de DataView es un indice que apunta fuera del archivo.
    throw new ErrorDePlanilla('corrupto')
  }
}

function leerIndiceSinCapturar(bytes: Uint8Array): Map<string, EntradaZip> {
  const vista = vistaDe(bytes)

  // El registro final mide 22 bytes mas un comentario de hasta 64 KB.
  let fin = -1
  const limite = Math.max(0, bytes.length - 22 - 0xffff)
  for (let i = bytes.length - 22; i >= limite; i--) {
    if (vista.getUint32(i, true) === FIRMA_FIN) {
      fin = i
      break
    }
  }
  if (fin < 0) throw new ErrorDePlanilla('corrupto')

  const total = vista.getUint16(fin + 10, true)
  const tamano = vista.getUint32(fin + 12, true)
  const inicio = vista.getUint32(fin + 16, true)

  if (total === 0xffff || tamano === 0xffffffff || inicio === 0xffffffff) {
    throw new ErrorDePlanilla('no-soportado')
  }
  if (total > MAXIMO_DE_ENTRADAS || inicio + tamano > fin) {
    throw new ErrorDePlanilla('corrupto')
  }

  const nombres = new TextDecoder('utf-8')
  const entradas = new Map<string, EntradaZip>()
  let p = inicio

  for (let k = 0; k < total; k++) {
    if (vista.getUint32(p, true) !== FIRMA_CENTRAL) throw new ErrorDePlanilla('corrupto')

    const banderas = vista.getUint16(p + 8, true)
    const largoNombre = vista.getUint16(p + 28, true)
    const largoExtra = vista.getUint16(p + 30, true)
    const largoComentario = vista.getUint16(p + 32, true)

    // Bit 0: la parte esta cifrada.
    if ((banderas & 1) === 1) throw new ErrorDePlanilla('protegido')

    const nombre = nombres
      .decode(bytes.subarray(p + 46, p + 46 + largoNombre))
      .replace(/\\/g, '/')
      .replace(/^\//, '')

    entradas.set(nombre, {
      nombre,
      metodo: vista.getUint16(p + 10, true),
      crc: vista.getUint32(p + 16, true),
      comprimido: vista.getUint32(p + 20, true),
      original: vista.getUint32(p + 24, true),
      offset: vista.getUint32(p + 42, true),
    })

    p += 46 + largoNombre + largoExtra + largoComentario
  }

  return entradas
}

/**
 * El contenido de una parte, descomprimido y comprobado.
 *
 * `limite` es el tope de bytes DESCOMPRIMIDOS. Se aplica dos veces: contra lo
 * que declara el indice, que es gratis, y contra lo que de verdad sale del
 * descompresor, que es lo que importa.
 */
export async function extraer(
  bytes: Uint8Array,
  entrada: EntradaZip,
  limite: number,
): Promise<Uint8Array> {
  if (entrada.original > limite) throw new ErrorDePlanilla('demasiado-grande')

  let datos: Uint8Array
  try {
    const vista = vistaDe(bytes)
    const p = entrada.offset
    if (vista.getUint32(p, true) !== FIRMA_LOCAL) throw new ErrorDePlanilla('corrupto')
    const desde = p + 30 + vista.getUint16(p + 26, true) + vista.getUint16(p + 28, true)
    datos = bytes.subarray(desde, desde + entrada.comprimido)
  } catch (error) {
    if (error instanceof ErrorDePlanilla) throw error
    throw new ErrorDePlanilla('corrupto')
  }
  if (datos.length !== entrada.comprimido) throw new ErrorDePlanilla('corrupto')

  let salida: Uint8Array
  if (entrada.metodo === 0) salida = datos
  else if (entrada.metodo === 8) salida = await inflar(datos, limite)
  else throw new ErrorDePlanilla('no-soportado')

  if (salida.length !== entrada.original || crc32(salida) !== entrada.crc) {
    throw new ErrorDePlanilla('corrupto')
  }
  return salida
}

/**
 * Deflate crudo, contando lo que sale y cortando al pasar el tope.
 *
 * La escritura NO se espera antes de leer. `write()` se resuelve cuando el
 * descompresor consumio el bloque, y el descompresor no consume mas si nadie
 * lee lo que ya produjo: esperar la escritura primero se traba para siempre
 * con cualquier parte que no entre en el bufer interno.
 */
async function inflar(datos: Uint8Array, limite: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ErrorDePlanilla('navegador')

  let descompresor: DecompressionStream
  try {
    descompresor = new DecompressionStream('deflate-raw')
  } catch {
    throw new ErrorDePlanilla('navegador')
  }

  const escritor = descompresor.writable.getWriter()
  // Una copia: `datos` es una vista sobre el archivo entero, y el tipo que
  // pide el descompresor no admite vistas sobre memoria compartida.
  escritor.write(new Uint8Array(datos)).catch(() => undefined)
  escritor.close().catch(() => undefined)

  const lector = descompresor.readable.getReader()
  const partes: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      total += value.byteLength
      if (total > limite) {
        await lector.cancel().catch(() => undefined)
        throw new ErrorDePlanilla('demasiado-grande')
      }
      partes.push(value)
    }
  } catch (error) {
    if (error instanceof ErrorDePlanilla) throw error
    throw new ErrorDePlanilla('corrupto')
  }

  const salida = new Uint8Array(total)
  let p = 0
  for (const parte of partes) {
    salida.set(parte, p)
    p += parte.byteLength
  }
  return salida
}

let tablaCrc: Uint32Array | null = null

function tabla(): Uint32Array {
  if (tablaCrc !== null) return tablaCrc
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  tablaCrc = t
  return t
}

/** CRC-32 del .zip (el mismo polinomio que gzip y PNG). */
export function crc32(datos: Uint8Array): number {
  const t = tabla()
  let crc = 0xffffffff
  for (const byte of datos) crc = (t[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
