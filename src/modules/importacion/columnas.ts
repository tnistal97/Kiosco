/**
 * Que columna de la planilla es que dato del producto.
 *
 * Cada comercio exporta su lista con los nombres que le puso su sistema, su
 * proveedor o su sobrino: "Cód. Barras", "EAN", "Descripción", "P. Venta",
 * "Rubro". El mapeo automatico reconoce los habituales y el usuario corrige el
 * resto en pantalla; nada se importa sin que la vista previa muestre como quedo.
 *
 * Los campos son los que YA tiene el modelo. No hay taxonomia nueva: la
 * categoria es la categoria de siempre, buscada por nombre.
 *
 * Este modulo NO importa Prisma: corre en el navegador.
 */

import { esNumeroDeCelda, textoDeCelda, type Celda, type FilaDePlanilla } from './planilla'

export const CAMPOS = [
  'codigo',
  'nombre',
  'categoria',
  'precio',
  'costo',
  'stock',
  'stockMinimo',
  'unidad',
] as const

export type Campo = (typeof CAMPOS)[number]

export const ETIQUETA_DE_CAMPO: Record<Campo, string> = {
  codigo: 'Código de barras',
  nombre: 'Nombre',
  categoria: 'Categoría',
  precio: 'Precio de venta',
  costo: 'Costo',
  stock: 'Stock',
  stockMinimo: 'Stock mínimo',
  unidad: 'Unidad',
}

/**
 * Nombres de columna reconocidos, ya normalizados (ver `normalizarEncabezado`).
 *
 * El ORDEN importa: el primero es el mas especifico y gana si hay dos columnas
 * candidatas. Con "Producto" y "Descripción" en la misma planilla, el nombre
 * sale de "Producto".
 */
const SINONIMOS: Record<Campo, readonly string[]> = {
  codigo: [
    'codigo de barras',
    'codigo barras',
    'cod de barras',
    'cod barras',
    'codigo de barra',
    'codigo ean',
    'barcode',
    'bar code',
    'ean',
    'ean13',
    'ean 13',
    'upc',
    'gtin',
    'codigo',
    'cod',
  ],
  nombre: [
    'nombre',
    'producto',
    'nombre del producto',
    'nombre producto',
    'descripcion',
    'descripcion del producto',
    'articulo',
    'detalle',
    'item',
  ],
  categoria: ['categoria', 'rubro', 'familia', 'seccion', 'departamento', 'grupo'],
  precio: [
    'precio de venta',
    'precio venta',
    'precio',
    'pvp',
    'precio al publico',
    'precio publico',
    'precio final',
    'p venta',
    'venta',
    'precio unitario',
  ],
  costo: [
    'costo',
    'precio de costo',
    'precio costo',
    'costo unitario',
    'precio de compra',
    'precio compra',
    'p costo',
    'compra',
  ],
  stock: ['stock', 'stock actual', 'cantidad', 'existencia', 'existencias', 'cant', 'unidades'],
  stockMinimo: [
    'stock minimo',
    'stock min',
    'minimo',
    'min',
    'punto de pedido',
    'punto de reposicion',
    'reposicion',
  ],
  unidad: ['unidad', 'unidad de venta', 'unidad de medida', 'medida', 'um', 'u m'],
}

/**
 * Un encabezado sin lo que no distingue: mayusculas, acentos, puntuacion y
 * espacios de mas. "Cód. Barras ($)" y "cod barras" son el mismo.
 */
export function normalizarEncabezado(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Cuanto se parece un encabezado a un campo. Cero es "nada".
 *
 * Coincidencia exacta con un sinonimo pesa mas que "empieza con": "Precio c/IVA"
 * es un precio, pero si ademas hay una columna "Precio" a secas, gana esa.
 */
function puntaje(encabezado: string, campo: Campo): number {
  const h = normalizarEncabezado(encabezado)
  if (h === '') return 0
  const lista = SINONIMOS[campo]
  let mejor = 0
  lista.forEach((s, i) => {
    if (h === s) mejor = Math.max(mejor, 200 - i)
    else if (h.startsWith(`${s} `)) mejor = Math.max(mejor, 100 - i)
  })
  return mejor
}

/** Columna elegida para cada campo, o `null` si ese dato no se importa. */
export type Mapeo = Record<Campo, number | null>

export function mapeoVacio(): Mapeo {
  return {
    codigo: null,
    nombre: null,
    categoria: null,
    precio: null,
    costo: null,
    stock: null,
    stockMinimo: null,
    unidad: null,
  }
}

/**
 * El mapeo que se propone a partir de los encabezados.
 *
 * Reparto voraz por puntaje: primero el par (campo, columna) mas seguro, y
 * cada columna se usa una sola vez. Asi "Stock mínimo" no termina como stock
 * cuando tambien hay una columna "Stock".
 */
export function sugerirMapeo(encabezados: readonly string[]): Mapeo {
  const pares: Array<{ campo: Campo; columna: number; puntos: number }> = []
  encabezados.forEach((h, columna) => {
    for (const campo of CAMPOS) {
      const puntos = puntaje(h, campo)
      if (puntos > 0) pares.push({ campo, columna, puntos })
    }
  })
  pares.sort((a, b) => b.puntos - a.puntos || a.columna - b.columna)

  const mapeo = mapeoVacio()
  const usadas = new Set<number>()
  for (const p of pares) {
    if (mapeo[p.campo] !== null || usadas.has(p.columna)) continue
    mapeo[p.campo] = p.columna
    usadas.add(p.columna)
  }
  return mapeo
}

/** Cuantos campos distintos reconoce una fila leida como encabezado. */
function camposReconocidos(celdas: readonly Celda[]): number {
  const textos = celdas.map((c) => (esNumeroDeCelda(c) ? '' : textoDeCelda(c)))
  const mapeo = sugerirMapeo(textos)
  return CAMPOS.filter((c) => mapeo[c] !== null).length
}

/**
 * La fila de encabezados: entre las primeras veinte con contenido, la que mas
 * campos reconoce. Asi una lista que empieza con "Distribuidora Pepe - Lista
 * de precios septiembre" y una fila en blanco no toma el titulo por encabezado.
 *
 * Si ninguna reconoce nada, la primera con contenido: el usuario ve los
 * nombres tal cual y mapea a mano.
 *
 * Devuelve la POSICION en `filas`, no el numero de fila de Excel.
 */
export function detectarEncabezado(filas: readonly FilaDePlanilla[]): number {
  let mejor = -1
  let mejorPuntos = 0
  const hasta = Math.min(filas.length, 20)
  for (let i = 0; i < hasta; i++) {
    const puntos = camposReconocidos(filas[i]?.celdas ?? [])
    if (puntos > mejorPuntos) {
      mejor = i
      mejorPuntos = puntos
    }
  }
  return mejor >= 0 ? mejor : filas.length > 0 ? 0 : -1
}

/** Nombre de columna al estilo de Excel: 0 → A, 26 → AA. */
export function letraDeColumna(indice: number): string {
  let n = indice + 1
  let letras = ''
  while (n > 0) {
    const resto = (n - 1) % 26
    letras = String.fromCharCode(65 + resto) + letras
    n = Math.floor((n - 1) / 26)
  }
  return letras
}

/**
 * Los nombres de las columnas para el mapeo.
 *
 * Con `encabezado = -1` la planilla no tiene encabezados --la primera fila ya
 * es un producto-- y las columnas se llaman como en Excel: "Columna A".
 */
export function encabezadosDe(filas: readonly FilaDePlanilla[], encabezado: number): string[] {
  const ancho = Math.max(0, ...filas.slice(0, 200).map((f) => f.celdas.length))
  const titulos = encabezado >= 0 ? (filas[encabezado]?.celdas ?? []) : []
  return Array.from({ length: ancho }, (_, i) => {
    const t = textoDeCelda(titulos[i]).trim()
    return t === '' ? `Columna ${letraDeColumna(i)}` : t
  })
}

/** Lo que viaja al servidor por celda: el texto tal cual o el numero de Excel. */
export type ValorCrudo = string | { n: string }

export interface FilaAEnviar {
  /** Numero de fila de Excel. */
  f: number
  /** Un valor por campo, en el orden de `campos`. */
  v: ValorCrudo[]
}

export interface DatosAEnviar {
  campos: Campo[]
  filas: FilaAEnviar[]
}

/**
 * Las filas de productos, con solo las columnas mapeadas.
 *
 * Una fila en la que TODAS las columnas mapeadas estan vacias no es un producto
 * con errores: es un renglon en blanco, un subtotal o una linea de separacion.
 * No se manda y no cuenta.
 */
export function datosAEnviar(
  filas: readonly FilaDePlanilla[],
  encabezado: number,
  mapeo: Mapeo,
): DatosAEnviar {
  const campos = CAMPOS.filter((c) => mapeo[c] !== null)
  const salida: FilaAEnviar[] = []

  for (const fila of filas.slice(encabezado + 1)) {
    const v: ValorCrudo[] = campos.map((campo) => {
      const celda = fila.celdas[mapeo[campo] ?? -1]
      if (celda === undefined) return ''
      return esNumeroDeCelda(celda) ? { n: celda.n } : celda
    })
    const vacia = v.every((x) => typeof x === 'string' && x.trim() === '')
    if (!vacia) salida.push({ f: fila.numero, v })
  }

  return { campos, filas: salida }
}
