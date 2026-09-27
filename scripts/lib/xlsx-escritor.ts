/**
 * Un .xlsx minimo, escrito a mano. Para la plantilla y para las pruebas.
 *
 * NO es parte de la aplicacion: la aplicacion solo LEE planillas, y lo hace en
 * el navegador (`src/modules/importacion/`). Esto existe para dos cosas:
 *
 *   · generar `public/productos-ejemplo.xlsx`, la plantilla que se descarga
 *     desde Productos → Importar (ver `scripts/generar-plantilla-productos.ts`);
 *   · armar en las pruebas los archivos que un Excel de verdad produciria
 *     --textos compartidos, textos en linea, formulas con su ultimo valor,
 *     prefijos de espacio de nombres, hojas ocultas-- sin depender de tener
 *     Excel instalado.
 *
 * Escribe exactamente lo necesario para que Excel y LibreOffice lo abran sin
 * quejarse: tipos de contenido, relaciones, libro, estilos y una hoja por
 * pestaña. Solo Node: usa `zlib` para comprimir.
 */

import { deflateRawSync } from 'node:zlib'
import { crc32 } from '@/modules/importacion/zip'

/**
 * Una celda al escribir.
 *
 *   string   texto
 *   number   numero
 *   null     vacia
 *   objeto   cualquier cosa rara que una prueba necesite escribir tal cual
 */
export type CeldaAEscribir =
  string | number | null | { xml: string } | { formula: string; valor: number | string }

export interface HojaAEscribir {
  nombre: string
  filas: CeldaAEscribir[][]
  oculta?: boolean
  /** Ancho de cada columna en caracteres, para que la plantilla se lea bien. */
  anchos?: number[]
  /** Columnas (desde 0) con formato Texto: los codigos de barras. */
  columnasDeTexto?: number[]
  /** Primera fila en negrita. */
  encabezadoEnNegrita?: boolean
}

export interface OpcionesXlsx {
  /** Deflate, como Excel. Sin esto las partes van guardadas tal cual. */
  comprimir?: boolean
  /** Textos en la celda (`inlineStr`) en vez de en `sharedStrings.xml`. */
  textosEnLinea?: boolean
  /** Prefijo de espacio de nombres en la hoja, como escriben algunas bibliotecas. */
  prefijo?: string
  /** Sin atributo `r` en filas y celdas: tambien es XML valido. */
  sinReferencias?: boolean
  /** Partes extra, tal cual: para las pruebas de macros y de archivos raros. */
  partesExtra?: Record<string, string | Uint8Array>
  /** Tipo de contenido del libro. Las pruebas de macros lo cambian. */
  tipoDelLibro?: string
}

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships'
const TIPO_LIBRO = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'
const DECLARACION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'

export function escaparXml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function letra(indice: number): string {
  let n = indice + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Arma el .xlsx completo. */
export function escribirXlsx(hojas: HojaAEscribir[], opciones: OpcionesXlsx = {}): Uint8Array {
  const compartidos: string[] = []
  const indiceCompartido = new Map<string, number>()
  const px = opciones.prefijo ? `${opciones.prefijo}:` : ''

  function celdaXml(valor: CeldaAEscribir, ref: string, estilo: number): string {
    const r = opciones.sinReferencias ? '' : ` r="${ref}"`
    const s = estilo > 0 ? ` s="${estilo}"` : ''
    if (valor === null) return ''
    if (typeof valor === 'object' && 'xml' in valor) return valor.xml
    if (typeof valor === 'object') {
      const esTexto = typeof valor.valor === 'string'
      const t = esTexto ? ' t="str"' : ''
      return `<${px}c${r}${s}${t}><${px}f>${escaparXml(valor.formula)}</${px}f><${px}v>${escaparXml(String(valor.valor))}</${px}v></${px}c>`
    }
    if (typeof valor === 'number')
      return `<${px}c${r}${s}><${px}v>${String(valor)}</${px}v></${px}c>`
    if (opciones.textosEnLinea) {
      return `<${px}c${r}${s} t="inlineStr"><${px}is><${px}t xml:space="preserve">${escaparXml(valor)}</${px}t></${px}is></${px}c>`
    }
    let i = indiceCompartido.get(valor)
    if (i === undefined) {
      i = compartidos.length
      compartidos.push(valor)
      indiceCompartido.set(valor, i)
    }
    return `<${px}c${r}${s} t="s"><${px}v>${i}</${px}v></${px}c>`
  }

  const partes: Record<string, string | Uint8Array> = {}

  hojas.forEach((hoja, h) => {
    const texto = new Set(hoja.columnasDeTexto ?? [])
    const filas = hoja.filas
      .map((fila, f) => {
        const celdas = fila
          .map((valor, c) => {
            const estilo = f === 0 && hoja.encabezadoEnNegrita ? 1 : texto.has(c) ? 2 : 0
            return celdaXml(valor, `${letra(c)}${f + 1}`, estilo)
          })
          .join('')
        const r = opciones.sinReferencias ? '' : ` r="${f + 1}"`
        return `<${px}row${r}>${celdas}</${px}row>`
      })
      .join('')
    const columnas =
      hoja.anchos && hoja.anchos.length > 0
        ? `<${px}cols>${hoja.anchos
            .map((w, i) => {
              const estilo = texto.has(i) ? ' style="2"' : ''
              return `<${px}col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"${estilo}/>`
            })
            .join('')}</${px}cols>`
        : ''
    const ns = opciones.prefijo ? `xmlns:${opciones.prefijo}="${NS_MAIN}"` : `xmlns="${NS_MAIN}"`
    partes[`xl/worksheets/sheet${h + 1}.xml`] =
      `${DECLARACION}<${px}worksheet ${ns} xmlns:r="${NS_REL}">${columnas}<${px}sheetData>${filas}</${px}sheetData></${px}worksheet>`
  })

  const hojasXml = hojas
    .map(
      (hoja, h) =>
        `<sheet name="${escaparXml(hoja.nombre)}" sheetId="${h + 1}"${hoja.oculta ? ' state="hidden"' : ''} r:id="rId${h + 1}"/>`,
    )
    .join('')
  partes['xl/workbook.xml'] =
    `${DECLARACION}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><sheets>${hojasXml}</sheets></workbook>`

  const relaciones = hojas
    .map(
      (_, h) =>
        `<Relationship Id="rId${h + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${h + 1}.xml"/>`,
    )
    .join('')
  const n = hojas.length
  partes['xl/_rels/workbook.xml.rels'] =
    `${DECLARACION}<Relationships xmlns="${NS_PKG}">${relaciones}` +
    `<Relationship Id="rId${n + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/>` +
    `</Relationships>`

  partes['xl/styles.xml'] =
    `${DECLARACION}<styleSheet xmlns="${NS_MAIN}">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="3">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`

  partes['xl/sharedStrings.xml'] =
    `${DECLARACION}<sst xmlns="${NS_MAIN}" count="${compartidos.length}" uniqueCount="${compartidos.length}">` +
    compartidos.map((t) => `<si><t xml:space="preserve">${escaparXml(t)}</t></si>`).join('') +
    `</sst>`

  const hojasTipos = hojas
    .map(
      (_, h) =>
        `<Override PartName="/xl/worksheets/sheet${h + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('')
  partes['[Content_Types].xml'] =
    `${DECLARACION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="${opciones.tipoDelLibro ?? TIPO_LIBRO}"/>` +
    hojasTipos +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>` +
    `</Types>`

  partes['_rels/.rels'] =
    `${DECLARACION}<Relationships xmlns="${NS_PKG}">` +
    `<Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`

  Object.assign(partes, opciones.partesExtra ?? {})

  // El orden de Excel: primero los tipos de contenido.
  const orden = [
    '[Content_Types].xml',
    ...Object.keys(partes).filter((k) => k !== '[Content_Types].xml'),
  ]
  return empaquetarZip(
    orden.map((nombre) => {
      const contenido = partes[nombre] ?? ''
      return {
        nombre,
        datos: typeof contenido === 'string' ? new TextEncoder().encode(contenido) : contenido,
      }
    }),
    opciones.comprimir === true,
  )
}

/**
 * Un .zip con estas partes. Fecha fija --1 de enero de 1980, la minima del
 * formato-- para que el mismo contenido produzca siempre el mismo archivo.
 */
export function empaquetarZip(
  partes: Array<{ nombre: string; datos: Uint8Array }>,
  comprimir: boolean,
): Uint8Array {
  const locales: Uint8Array[] = []
  const centrales: Uint8Array[] = []
  let offset = 0

  for (const { nombre, datos } of partes) {
    const nombreBytes = new TextEncoder().encode(nombre)
    const comprimido = comprimir ? new Uint8Array(deflateRawSync(datos)) : datos
    const metodo = comprimir ? 8 : 0
    const crc = crc32(datos)

    const local = new Uint8Array(30 + nombreBytes.length)
    const vl = new DataView(local.buffer)
    vl.setUint32(0, 0x04034b50, true)
    vl.setUint16(4, 20, true)
    vl.setUint16(6, 0x0800, true) // nombres en UTF-8
    vl.setUint16(8, metodo, true)
    vl.setUint16(10, 0, true)
    vl.setUint16(12, 0x21, true) // 1980-01-01
    vl.setUint32(14, crc, true)
    vl.setUint32(18, comprimido.length, true)
    vl.setUint32(22, datos.length, true)
    vl.setUint16(26, nombreBytes.length, true)
    vl.setUint16(28, 0, true)
    local.set(nombreBytes, 30)

    const central = new Uint8Array(46 + nombreBytes.length)
    const vc = new DataView(central.buffer)
    vc.setUint32(0, 0x02014b50, true)
    vc.setUint16(4, 20, true)
    vc.setUint16(6, 20, true)
    vc.setUint16(8, 0x0800, true)
    vc.setUint16(10, metodo, true)
    vc.setUint16(12, 0, true)
    vc.setUint16(14, 0x21, true)
    vc.setUint32(16, crc, true)
    vc.setUint32(20, comprimido.length, true)
    vc.setUint32(24, datos.length, true)
    vc.setUint16(28, nombreBytes.length, true)
    vc.setUint32(42, offset, true)
    central.set(nombreBytes, 46)

    locales.push(local, comprimido)
    centrales.push(central)
    offset += local.length + comprimido.length
  }

  const tamanoCentral = centrales.reduce((s, c) => s + c.length, 0)
  const fin = new Uint8Array(22)
  const vf = new DataView(fin.buffer)
  vf.setUint32(0, 0x06054b50, true)
  vf.setUint16(8, partes.length, true)
  vf.setUint16(10, partes.length, true)
  vf.setUint32(12, tamanoCentral, true)
  vf.setUint32(16, offset, true)

  const total = offset + tamanoCentral + fin.length
  const salida = new Uint8Array(total)
  let p = 0
  for (const b of [...locales, ...centrales, fin]) {
    salida.set(b, p)
    p += b.length
  }
  return salida
}
