/**
 * Decide si un producto de una tienda es el MISMO que uno del catalogo, por
 * el nombre. Lo usa `scripts/buscar-imagenes.ts` cuando no hay codigo de
 * barras con que preguntar, o cuando el codigo no lo tiene ninguna tienda.
 *
 * La regla es prudente a proposito: una foto equivocada en la caja es peor que
 * no tener foto, porque alguien la mira para saber que esta vendiendo. Por eso
 * hay tres respuestas y no dos:
 *
 *   encontrada  misma marca, misma medida y todas las palabras que distinguen
 *               --sabor, variedad, "sin azucar"-- presentes;
 *   dudosa      se parece, pero falta algo de eso; queda para revisar a mano;
 *   null        no se parece.
 *
 * Todo es puro: recibe textos y devuelve un veredicto. Las pruebas estan en
 * tests/unit/coincidencia-de-productos.test.ts.
 */

export type Veredicto = 'encontrada' | 'dudosa'

export interface Candidato {
  nombre: string
  marca: string
}

export interface Comparacion {
  veredicto: Veredicto | null
  /** Que fraccion de las palabras que distinguen aparecen en el candidato. */
  cobertura: number
  /** Por que no es `encontrada`, en palabras. Vacio si lo es. */
  motivos: string[]
}

/** Minusculas, sin tildes, sin signos. `ñ` queda como `n`: "Mañanita" y "Mananita". */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/&/g, ' y ')
    .replace(/'/g, '')
    .replace(/[^a-z0-9.,/%]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * "bulto x6", "(bulto x4)": como se COMPRA, no que producto es. La foto es la
 * de la unidad, y la tienda la vende suelta.
 */
export function sinBulto(nombre: string): string {
  return nombre
    .replace(/\(?\s*bulto\s*x\s*\d+\s*\)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const UNIDADES: Record<string, { base: 'g' | 'ml' | 'm'; factor: number }> = {
  kg: { base: 'g', factor: 1000 },
  kgs: { base: 'g', factor: 1000 },
  kilo: { base: 'g', factor: 1000 },
  kilos: { base: 'g', factor: 1000 },
  g: { base: 'g', factor: 1 },
  gr: { base: 'g', factor: 1 },
  grs: { base: 'g', factor: 1 },
  gramos: { base: 'g', factor: 1 },
  l: { base: 'ml', factor: 1000 },
  lt: { base: 'ml', factor: 1000 },
  lts: { base: 'ml', factor: 1000 },
  litro: { base: 'ml', factor: 1000 },
  litros: { base: 'ml', factor: 1000 },
  ml: { base: 'ml', factor: 1 },
  cc: { base: 'ml', factor: 1 },
  cm3: { base: 'ml', factor: 1 },
  m: { base: 'm', factor: 1 },
  mts: { base: 'm', factor: 1 },
  metros: { base: 'm', factor: 1 },
}

const MEDIDA = new RegExp(
  `(\\d+(?:[.,]\\d+)?)\\s*(?:/\\s*(\\d+(?:[.,]\\d+)?)\\s*)?(${Object.keys(UNIDADES).join('|')})(?![a-z])`,
  'g',
)

function numero(texto: string): number {
  return Number(texto.replace(',', '.'))
}

/**
 * Las medidas de peso, volumen y largo, llevadas a g, ml y m: "1 kg" y
 * "1000 g" son la misma; "500 cc" y "500 ml" tambien. "330/355cc" da las dos.
 */
export function medidas(nombre: string): Set<string> {
  const salida = new Set<string>()
  for (const m of normalizar(nombre).matchAll(MEDIDA)) {
    const unidad = UNIDADES[m[3] ?? '']
    if (!unidad) continue
    for (const valor of [m[1], m[2]]) {
      if (valor === undefined) continue
      const n = Math.round(numero(valor) * unidad.factor * 1000) / 1000
      salida.add(`${String(n)}${unidad.base}`)
    }
  }
  return salida
}

/**
 * Palabras que dicen QUE CLASE de producto es, o en que envase viene. Las
 * tiendas las ponen o no ("Dulce de leche La Serenisima 400 g" y "La
 * Serenisima Dulce de Leche Clasico 400 Gr" son el mismo), asi que no se
 * exigen. Las que distinguen --el sabor, la variedad-- si.
 */
const GENERICAS = new Set([
  'aceitunas',
  'aerosol',
  'agua',
  'bidon',
  'bolsa',
  'bolsas',
  'botella',
  'brick',
  'caja',
  'caramelos',
  'cereal',
  'cerveza',
  'chupetines',
  'clasico',
  'clasica',
  'comida',
  'cocina',
  'descartable',
  'detergente',
  'doypack',
  'dulce',
  'edulcorante',
  'esponja',
  'estuche',
  'frasco',
  'fritas',
  'galletitas',
  'gaseosa',
  'gelatina',
  'insecticida',
  'jabon',
  'jugo',
  'lata',
  'leche',
  'liquido',
  'lista',
  'mermelada',
  'mineral',
  'original',
  'pack',
  'pano',
  'papas',
  'piso',
  'polvo',
  'porron',
  'premezcla',
  'regular',
  'relleno',
  'residuos',
  'rollo',
  'rollos',
  'salsa',
  'snack',
  'snacks',
  'sobre',
  'suavizante',
  'tradicional',
  'trapo',
  'uat',
  'vino',
  'vodka',
  'lavarropas',
  'quitamanchas',
  'mayonesa',
  'mostaza',
  'ketchup',
  'vinagre',
  'pan',
  'unidad',
  'unidades',
  'un',
  'u',
  'paquete',
  'nachos',
  'palitos',
  'tostado',
  'tostados',
  'bebida',
])

/** Palabras que no dicen nada. */
const VACIAS = new Set([
  'de',
  'del',
  'el',
  'la',
  'las',
  'los',
  'en',
  'y',
  'a',
  'al',
  'x',
  'para',
  'por',
  'e',
])

/**
 * Los porcentajes: "Leche descremada 1%" no es la "parcialmente descremada 2%",
 * aunque las dos sean de un litro. Van aparte de las medidas porque se
 * comparan aparte: coincidir en el litro no alcanza.
 */
export function porcentajes(nombre: string): Set<string> {
  const salida = new Set<string>()
  for (const m of normalizar(nombre).matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)) {
    salida.add(`${String(numero(m[1] ?? ''))}%`)
  }
  return salida
}

/** Las palabras que quedan cuando se sacan las medidas y las vacias. */
export function palabras(nombre: string): string[] {
  const sinMedidas = normalizar(nombre).replace(MEDIDA, ' ')
  return sinMedidas
    .split(/[\s.,/%]+/)
    .filter((p) => p.length > 0 && !VACIAS.has(p) && !/^\d+$/.test(p) && !/^x\d+$/.test(p))
}

/** Si la marca del candidato aparece en el nombre del catalogo. */
export function tieneLaMarca(nombre: string, marca: string): boolean {
  const delNombre = new Set(palabras(nombre))
  const deLaMarca = palabras(marca)
  return deLaMarca.length > 0 && deLaMarca.every((p) => delNombre.has(p))
}

export function comparar(nombreDelCatalogo: string, candidato: Candidato): Comparacion {
  const nombre = sinBulto(nombreDelCatalogo)
  const motivos: string[] = []

  const enCandidato = new Set([...palabras(candidato.nombre), ...palabras(candidato.marca)])
  const distinguen = palabras(nombre).filter((p) => !GENERICAS.has(p))
  const presentes = distinguen.filter((p) => enCandidato.has(p))
  const cobertura = distinguen.length === 0 ? 0 : presentes.length / distinguen.length

  const marca = tieneLaMarca(nombre, candidato.marca)
  if (!marca) motivos.push(`la marca "${candidato.marca}" no está en el nombre`)

  const faltan = distinguen.filter((p) => !enCandidato.has(p))
  if (faltan.length > 0) motivos.push(`faltan: ${faltan.join(', ')}`)

  const propias = medidas(nombre)
  const ajenas = medidas(candidato.nombre)
  let medidaDistinta = false
  if (propias.size > 0) {
    if (ajenas.size === 0) {
      motivos.push('la tienda no dice la medida')
    } else if (![...ajenas].some((m) => propias.has(m))) {
      medidaDistinta = true
      motivos.push(`otra medida: ${[...ajenas].join(', ')}`)
    }
  }

  const porcientoPropio = porcentajes(nombre)
  const porcientoAjeno = porcentajes(candidato.nombre)
  if (porcientoPropio.size > 0) {
    if (porcientoAjeno.size === 0) {
      motivos.push('la tienda no dice el porcentaje')
    } else if (![...porcientoAjeno].some((p) => porcientoPropio.has(p))) {
      medidaDistinta = true
      motivos.push(`otro porcentaje: ${[...porcientoAjeno].join(', ')}`)
    }
  }

  // Otra medida es otro producto: 500 g no es 1 kg, y la foto engañaria.
  if (medidaDistinta || cobertura < 0.5) return { veredicto: null, cobertura, motivos }
  if (motivos.length === 0) return { veredicto: 'encontrada', cobertura, motivos }
  return { veredicto: 'dudosa', cobertura, motivos }
}

/** El digito verificador de un GTIN-8, 12, 13 o 14. */
export function digitoVerificadorValido(codigo: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(codigo)) return false
  const digitos = [...codigo].map(Number)
  const control = digitos.pop() ?? -1
  const suma = digitos.reverse().reduce((total, d, i) => total + d * (i % 2 === 0 ? 3 : 1), 0)
  return (10 - (suma % 10)) % 10 === control
}

/**
 * El codigo de la UNIDAD dentro de un codigo de bulto (DUN-14): se saca el
 * primer digito --el que indica el empaque-- y se recalcula el verificador:
 * "37790036000320" es el bulto de "7790036000329". Null si no es un DUN-14
 * valido.
 */
export function codigoDeUnidad(codigo: string): string | null {
  if (!/^[1-8]\d{13}$/.test(codigo) || !digitoVerificadorValido(codigo)) return null
  const base = codigo.slice(1, 13)
  const suma = [...base]
    .map(Number)
    .reverse()
    .reduce((total, d, i) => total + d * (i % 2 === 0 ? 3 : 1), 0)
  return `${base}${String((10 - (suma % 10)) % 10)}`
}
