/**
 * Lectura de un .xlsx: la primera hoja visible, celda por celda, SOLO VALORES.
 *
 * Lo que se lee y lo que no:
 *
 *   FORMULAS    no se calculan. De una celda con formula se toma el ultimo
 *               valor que guardo Excel, que es el que el usuario ve en
 *               pantalla. Nada de lo que diga la formula se ejecuta.
 *   MACROS      un archivo con macros se rechaza entero: no hay forma de
 *               "leer sin macros" algo que alguien armo para que las tenga.
 *   FORMATOS    se ignoran. Un numero es un numero aunque se muestre con
 *               signo peso o con separador de miles, y por eso viaja aparte
 *               del texto: `1.5` guardado como numero es uno y medio, y
 *               `"1.500"` escrito como texto es otra cosa (ver `valores.ts`).
 *
 * El XML se recorre con expresiones regulares y no con un parser completo a
 * proposito: lo unico que interesa son cuatro etiquetas, y un parser de XML
 * trae consigo entidades definidas por el documento, que son la puerta de las
 * "bombas" de XML. Aca solo se reconocen las cinco entidades predefinidas y las
 * numericas; cualquier otra queda como texto.
 *
 * Los prefijos de espacio de nombres (`<x:row>`, que escriben algunas
 * bibliotecas de .NET) se aceptan en todas las etiquetas.
 *
 * Este modulo NO importa Prisma: corre en el navegador.
 */

import { ErrorDePlanilla } from './errores'
import { extraer, leerIndice, type EntradaZip } from './zip'
import type { Celda, FilaDePlanilla } from './planilla'

/** Tope por parte descomprimida. Diez mil productos ocupan unos 5 MB de XML. */
const MAXIMO_POR_PARTE = 64 * 1024 * 1024

/** Columnas que se leen. Las de mas alla se ignoran: nadie mapea la columna 201. */
const MAXIMO_DE_COLUMNAS = 200

export interface HojaLeida {
  hoja: string
  otrasHojas: string[]
  filas: FilaDePlanilla[]
}

const PREFIJO = '(?:[\\w.-]+:)?'

function etiqueta(nombre: string, bandera = 'g'): RegExp {
  // `<nombre ...>contenido</nombre>` o `<nombre .../>`. El `\b` evita que
  // `<c` coincida con `<col` y `<t` con `<tabColor`.
  return new RegExp(
    `<${PREFIJO}${nombre}\\b([^>]*?)(?:\\/>|>([\\s\\S]*?)<\\/${PREFIJO}${nombre}>)`,
    bandera,
  )
}

const RE_FILA = etiqueta('row')
const RE_CELDA = etiqueta('c')
const RE_T = etiqueta('t')
const RE_SI = etiqueta('si')
const RE_HOJA = new RegExp(`<${PREFIJO}sheet\\b([^>]*?)\\/?>`, 'g')
const RE_RELACION = new RegExp(`<${PREFIJO}Relationship\\b([^>]*?)\\/?>`, 'g')
const RE_V = etiqueta('v', '')
const RE_IS = etiqueta('is', '')
const RE_DATOS = etiqueta('sheetData', '')
const RE_FONETICA = new RegExp(`<${PREFIJO}rPh\\b[\\s\\S]*?<\\/${PREFIJO}rPh>`, 'g')

/** Valor de un atributo, ya decodificado. Acepta prefijo (`r:id`). */
function atributo(atributos: string, nombre: string): string | null {
  const re = new RegExp(`(?:^|\\s)${PREFIJO}${nombre}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`)
  const m = re.exec(atributos)
  if (!m) return null
  return decodificarEntidades(m[1] ?? m[2] ?? '')
}

/** Las cinco entidades de XML y las numericas. Ninguna otra: ver la cabecera. */
export function decodificarEntidades(texto: string): string {
  if (!texto.includes('&')) return texto
  return texto.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (entera, e: string) => {
    switch (e) {
      case 'lt':
        return '<'
      case 'gt':
        return '>'
      case 'amp':
        return '&'
      case 'quot':
        return '"'
      case 'apos':
        return "'"
    }
    const codigo = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
    return codigo > 0 && codigo <= 0x10ffff ? String.fromCodePoint(codigo) : entera
  })
}

/**
 * Los escapes propios de Office: `_x000D_` es un retorno de carro.
 *
 * Excel los usa para guardar caracteres de control que el XML no admite. Sin
 * esto, un nombre con un salto de linea adentro llega como "Yerba_x000D_ 1kg".
 */
function desescaparOffice(texto: string): string {
  if (!texto.includes('_x')) return texto
  return texto.replace(/_x([0-9A-Fa-f]{4})_/g, (_, h: string) =>
    String.fromCharCode(parseInt(h, 16)),
  )
}

/** El texto de un nodo con corridas (`<r><t>`) y sin la lectura fonetica. */
function textoDeNodo(interior: string): string {
  const sinFonetica = interior.replace(RE_FONETICA, '')
  let texto = ''
  for (const t of sinFonetica.matchAll(RE_T)) texto += t[2] ?? ''
  return desescaparOffice(decodificarEntidades(texto))
}

/** `"AB"` → 27, contando desde cero. */
function indiceDeColumna(letras: string): number {
  let n = 0
  for (const letra of letras.toUpperCase()) n = n * 26 + (letra.charCodeAt(0) - 64)
  return n - 1
}

/**
 * La ruta de una parte a partir del destino de una relacion.
 *
 * Los destinos son relativos a la carpeta de quien los declara
 * (`worksheets/sheet1.xml` desde `xl/`) o absolutos desde la raiz
 * (`/xl/worksheets/sheet1.xml`). Se resuelven los `..` por las dudas.
 */
function resolver(base: string, destino: string): string {
  if (destino.startsWith('/')) return destino.slice(1)
  const partes = [...base.split('/').filter((p) => p !== ''), ...destino.split('/')]
  const salida: string[] = []
  for (const p of partes) {
    if (p === '..') salida.pop()
    else if (p !== '.' && p !== '') salida.push(p)
  }
  return salida.join('/')
}

function carpetaDe(ruta: string): string {
  const i = ruta.lastIndexOf('/')
  return i < 0 ? '' : ruta.slice(0, i)
}

function unir(carpeta: string, nombre: string): string {
  return carpeta === '' ? nombre : `${carpeta}/${nombre}`
}

function relacionesDe(xml: string): Map<string, { tipo: string; destino: string }> {
  const salida = new Map<string, { tipo: string; destino: string }>()
  for (const m of xml.matchAll(RE_RELACION)) {
    const atributos = m[1] ?? ''
    const id = atributo(atributos, 'Id')
    const destino = atributo(atributos, 'Target')
    if (id === null || destino === null) continue
    salida.set(id, { tipo: atributo(atributos, 'Type') ?? '', destino })
  }
  return salida
}

async function texto(
  bytes: Uint8Array,
  indice: Map<string, EntradaZip>,
  ruta: string,
): Promise<string | null> {
  const entrada = indice.get(ruta)
  if (!entrada) return null
  const contenido = await extraer(bytes, entrada, MAXIMO_POR_PARTE)
  return new TextDecoder('utf-8').decode(contenido)
}

/**
 * La primera hoja visible del libro, lista para mapear.
 *
 * `limiteDeFilas` corta la lectura: pasado ese numero de filas con contenido
 * se rechaza el archivo sin terminar de recorrerlo.
 */
export async function leerXlsx(bytes: Uint8Array, limiteDeFilas: number): Promise<HojaLeida> {
  const indice = leerIndice(bytes)

  // Macros: la parte que las contiene, o un tipo de contenido que las declara.
  if ([...indice.keys()].some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) {
    throw new ErrorDePlanilla('macros')
  }
  const tipos = await texto(bytes, indice, '[Content_Types].xml')
  if (tipos === null) throw new ErrorDePlanilla('no-es-planilla')
  if (/macroEnabled/i.test(tipos)) throw new ErrorDePlanilla('macros')

  // El libro: lo dice la relacion "officeDocument" de la raiz.
  const raiz = await texto(bytes, indice, '_rels/.rels')
  let rutaLibro = 'xl/workbook.xml'
  if (raiz !== null) {
    for (const r of relacionesDe(raiz).values()) {
      if (/\/officeDocument$/.test(r.tipo)) rutaLibro = resolver('', r.destino)
    }
  }
  const libro = await texto(bytes, indice, rutaLibro)
  if (libro === null) throw new ErrorDePlanilla('no-es-planilla')

  // Las relaciones del libro viven al lado: `xl/_rels/workbook.xml.rels`.
  const carpeta = carpetaDe(rutaLibro)
  const archivoLibro = rutaLibro.slice(carpeta === '' ? 0 : carpeta.length + 1)
  const rutaRels = unir(carpeta, `_rels/${archivoLibro}.rels`)
  const relacionesLibro = relacionesDe((await texto(bytes, indice, rutaRels)) ?? '')

  const hojas: Array<{ nombre: string; ruta: string; visible: boolean }> = []
  for (const m of libro.matchAll(RE_HOJA)) {
    const atributos = m[1] ?? ''
    const id = atributo(atributos, 'id')
    const relacion = id === null ? undefined : relacionesLibro.get(id)
    if (!relacion) continue
    hojas.push({
      nombre: atributo(atributos, 'name') ?? 'Hoja',
      ruta: resolver(carpeta, relacion.destino),
      visible: !/hidden/i.test(atributo(atributos, 'state') ?? ''),
    })
  }
  const elegida = hojas.find((h) => h.visible) ?? hojas[0]
  if (!elegida) throw new ErrorDePlanilla('sin-hojas')

  // Textos compartidos: la mayoria de las celdas de texto apuntan aca.
  let rutaCompartidos: string | null = null
  for (const r of relacionesLibro.values()) {
    if (/\/sharedStrings$/.test(r.tipo)) rutaCompartidos = resolver(carpeta, r.destino)
  }
  const compartidos: string[] = []
  const xmlCompartidos = await texto(
    bytes,
    indice,
    rutaCompartidos ?? unir(carpeta, 'sharedStrings.xml'),
  )
  if (xmlCompartidos !== null) {
    for (const m of xmlCompartidos.matchAll(RE_SI)) compartidos.push(textoDeNodo(m[2] ?? ''))
  }

  const xmlHoja = await texto(bytes, indice, elegida.ruta)
  if (xmlHoja === null) throw new ErrorDePlanilla('corrupto')

  return {
    hoja: elegida.nombre,
    otrasHojas: hojas.filter((h) => h !== elegida).map((h) => h.nombre),
    filas: leerFilas(xmlHoja, compartidos, limiteDeFilas),
  }
}

function leerFilas(xml: string, compartidos: string[], limiteDeFilas: number): FilaDePlanilla[] {
  const datos = RE_DATOS.exec(xml)?.[2] ?? ''
  const filas: FilaDePlanilla[] = []
  let numeroAnterior = 0

  for (const m of datos.matchAll(RE_FILA)) {
    const r = Number(atributo(m[1] ?? '', 'r'))
    const numero = Number.isInteger(r) && r > 0 ? r : numeroAnterior + 1
    numeroAnterior = numero

    const celdas: Celda[] = []
    let columnaAnterior = -1

    for (const c of (m[2] ?? '').matchAll(RE_CELDA)) {
      const atributos = c[1] ?? ''
      const referencia = /^([A-Za-z]{1,3})\d+$/.exec(atributo(atributos, 'r') ?? '')
      const columna = referencia ? indiceDeColumna(referencia[1] ?? 'A') : columnaAnterior + 1
      columnaAnterior = columna
      if (columna >= MAXIMO_DE_COLUMNAS) continue

      const valor = valorDeCelda(atributo(atributos, 't'), c[2] ?? '', compartidos)
      while (celdas.length < columna) celdas.push('')
      celdas[columna] = valor
    }

    while (celdas.length > 0 && celdas[celdas.length - 1] === '') celdas.pop()
    if (celdas.length === 0) continue

    filas.push({ numero, celdas })
    if (filas.length > limiteDeFilas) throw new ErrorDePlanilla('demasiadas-filas')
  }

  return filas
}

/**
 * El valor de una celda segun su tipo.
 *
 *   s          indice en los textos compartidos
 *   inlineStr  texto escrito en la misma celda
 *   str        resultado de texto de una formula
 *   e          error de Excel (#N/A, #DIV/0!): se conserva como texto y la
 *              validacion lo reconoce y lo explica
 *   b          verdadero o falso: texto, ningun campo lo espera
 *   n o nada   un NUMERO, que viaja marcado como tal
 */
function valorDeCelda(tipo: string | null, interior: string, compartidos: string[]): Celda {
  if (tipo === 'inlineStr') return textoDeNodo(RE_IS.exec(interior)?.[2] ?? '')

  const v = RE_V.exec(interior)?.[2]
  if (v === undefined) return ''
  const crudo = decodificarEntidades(v)

  switch (tipo) {
    case 's':
      return compartidos[Number(crudo)] ?? ''
    case 'str':
    case 'e':
    case 'd':
      return desescaparOffice(crudo)
    case 'b':
      return crudo === '1' ? 'VERDADERO' : 'FALSO'
    default: {
      const numero = crudo.trim()
      if (numero === '') return ''
      // Algo que no tiene forma de numero en una celda numerica es un archivo
      // raro; se conserva como texto y la validacion lo rechaza con su mensaje.
      return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(numero) ? { n: numero } : numero
    }
  }
}
