/**
 * Vocabulario de lotes y vencimientos.
 *
 * Un unico catalogo para el servidor, el navegador y la base: las restricciones
 * CHECK de PostgreSQL replican estas listas, y hay una prueba que comprueba que
 * no se separen.
 *
 * Este modulo NO importa Prisma: lo usan las pantallas.
 * Ver docs/LOT_EXPIRATION_POLICY.md.
 */

import { cantidadDeDias, type FechaLocal } from '@/lib/tiempo'

/**
 * Si un producto se sigue por lote.
 *
 *   NONE      no se rastrea. No se le pueden crear lotes.
 *   OPTIONAL  puede tener lotes y puede tener stock sin asignar a ninguno.
 *   REQUIRED  todo movimiento lleva lote, y el stock sin asignar es cero.
 */
export const POLITICAS_DE_LOTE = ['NONE', 'OPTIONAL', 'REQUIRED'] as const
export type PoliticaDeLote = (typeof POLITICAS_DE_LOTE)[number]

/**
 * Si se controla el vencimiento. Las mismas tres palabras y OTRA pregunta.
 *
 * Separada a proposito: una lavandina necesita numero de partida --para poder
 * retirarla si sale mal-- y no tiene vencimiento que valga la pena controlar.
 * Con una sola bandera, rastrearla obligaria a inventarle una fecha.
 */
export const POLITICAS_DE_VENCIMIENTO = ['NONE', 'OPTIONAL', 'REQUIRED'] as const
export type PoliticaDeVencimiento = (typeof POLITICAS_DE_VENCIMIENTO)[number]

const ETIQUETAS_DE_LOTE: Record<PoliticaDeLote, string> = {
  NONE: 'Sin lotes',
  OPTIONAL: 'Lotes opcionales',
  REQUIRED: 'Lotes obligatorios',
}

const ETIQUETAS_DE_VENCIMIENTO: Record<PoliticaDeVencimiento, string> = {
  NONE: 'Sin vencimiento',
  OPTIONAL: 'Vencimiento opcional',
  REQUIRED: 'Vencimiento obligatorio',
}

/** Lo que se explica al elegir la politica. El texto decide el uso. */
export const AYUDA_DE_LOTE: Record<PoliticaDeLote, string> = {
  NONE: 'Como hasta ahora. El stock es un solo numero.',
  OPTIONAL: 'Se pueden cargar partidas, y puede quedar stock sin asignar.',
  REQUIRED: 'Toda entrada y toda salida dicen de que partida son.',
}

export const AYUDA_DE_VENCIMIENTO: Record<PoliticaDeVencimiento, string> = {
  NONE: 'La partida no vence: sirve para identificarla, no para controlarla.',
  OPTIONAL: 'Se puede cargar la fecha cuando el envase la trae.',
  REQUIRED: 'Ninguna partida se carga sin su fecha de vencimiento.',
}

export function esPoliticaDeLote(valor: string): valor is PoliticaDeLote {
  return (POLITICAS_DE_LOTE as readonly string[]).includes(valor)
}

export function esPoliticaDeVencimiento(valor: string): valor is PoliticaDeVencimiento {
  return (POLITICAS_DE_VENCIMIENTO as readonly string[]).includes(valor)
}

export function politicaDeLoteODefecto(valor: string | null | undefined): PoliticaDeLote {
  return valor !== null && valor !== undefined && esPoliticaDeLote(valor) ? valor : 'NONE'
}

export function politicaDeVencimientoODefecto(
  valor: string | null | undefined,
): PoliticaDeVencimiento {
  return valor !== null && valor !== undefined && esPoliticaDeVencimiento(valor) ? valor : 'NONE'
}

export function etiquetaDePoliticaDeLote(valor: string): string {
  return esPoliticaDeLote(valor) ? ETIQUETAS_DE_LOTE[valor] : valor
}

export function etiquetaDePoliticaDeVencimiento(valor: string): string {
  return esPoliticaDeVencimiento(valor) ? ETIQUETAS_DE_VENCIMIENTO[valor] : valor
}

/**
 * La combinacion valida: un vencimiento sin lote no tiene donde escribirse.
 *
 * La misma regla que el CHECK de la base. Se comprueba tambien aca para poder
 * dar el mensaje antes de escribir.
 */
export function combinacionValida(lote: PoliticaDeLote, venc: PoliticaDeVencimiento): boolean {
  return venc === 'NONE' || lote !== 'NONE'
}

// ---------------------------------------------------------------------------
// Vencimiento
// ---------------------------------------------------------------------------

/**
 * Los estados de un lote frente a su vencimiento. TEXTO, no color.
 *
 * `SIN_FECHA` NO es `OK`, y por eso tiene su propia palabra: "OK" afirma que
 * falta mucho, y de un lote sin fecha no se sabe. Son dos cosas distintas y la
 * pantalla las dice distinto.
 *
 * `AGOTADO` no esta en esta lista porque no es un estado de vencimiento: es
 * `quantity = 0`, y se filtra aparte.
 */
export const ESTADOS_DE_VENCIMIENTO = [
  'VENCIDO',
  'VENCE_HOY',
  'SIETE_DIAS',
  'TREINTA_DIAS',
  'OK',
  'SIN_FECHA',
] as const

export type EstadoDeVencimiento = (typeof ESTADOS_DE_VENCIMIENTO)[number]

const ETIQUETAS_DE_ESTADO: Record<EstadoDeVencimiento, string> = {
  VENCIDO: 'VENCIDO',
  VENCE_HOY: 'VENCE HOY',
  SIETE_DIAS: '7 DÍAS',
  TREINTA_DIAS: '30 DÍAS',
  OK: 'OK',
  SIN_FECHA: 'SIN FECHA',
}

/**
 * El tono visual. ACOMPAÑA al texto, no lo reemplaza.
 *
 * La etiqueta ya dice "VENCIDO" en letras: quien no distingue el rojo del verde
 * --y quien mira la pantalla en un deposito con mala luz-- lee lo mismo.
 */
const TONOS: Record<EstadoDeVencimiento, 'danger' | 'warning' | 'neutral' | 'success'> = {
  VENCIDO: 'danger',
  VENCE_HOY: 'danger',
  SIETE_DIAS: 'warning',
  TREINTA_DIAS: 'warning',
  OK: 'success',
  SIN_FECHA: 'neutral',
}

export function etiquetaDeVencimiento(estado: EstadoDeVencimiento): string {
  return ETIQUETAS_DE_ESTADO[estado]
}

export function tonoDeVencimiento(
  estado: EstadoDeVencimiento,
): 'danger' | 'warning' | 'neutral' | 'success' {
  return TONOS[estado]
}

/**
 * Cuantos dias faltan para el vencimiento. Negativo si ya vencio, `null` si no
 * vence.
 *
 * Las DOS fechas son fechas de calendario --`YYYY-MM-DD`-- y `hoy` sale de la
 * zona horaria de LA SUCURSAL, nunca de la del servidor ni de la del navegador.
 * Ver docs/TIMEZONE_POLICY.md.
 *
 * `cantidadDeDias` cuenta los dos extremos, asi que el mismo dia da 1: de ahi
 * el menos uno. Vence hoy = 0, vencio ayer = -1.
 */
export function diasHastaVencer(hoy: FechaLocal, vence: FechaLocal | null): number | null {
  if (vence === null) return null
  return cantidadDeDias(hoy, vence) - 1
}

export function estadoDeVencimiento(dias: number | null): EstadoDeVencimiento {
  if (dias === null) return 'SIN_FECHA'
  if (dias < 0) return 'VENCIDO'
  if (dias === 0) return 'VENCE_HOY'
  if (dias <= 7) return 'SIETE_DIAS'
  if (dias <= 30) return 'TREINTA_DIAS'
  return 'OK'
}

/** Si el lote se puede vender. Un vencido NO, sin excepciones en esta fase. */
export function esVendible(estado: EstadoDeVencimiento): boolean {
  return estado !== 'VENCIDO'
}

/**
 * Como se normaliza el codigo de un lote.
 *
 * Mayusculas, sin espacios de los costados y con los internos colapsados:
 * `l-001 ` y `L-001` son la MISMA partida, y sin esto el sistema aceptaria las
 * dos y despues no sabria cual tiene el stock.
 *
 * La base guarda el resultado en su propia columna y tiene un CHECK que
 * comprueba que sea exactamente esta cuenta. No alcanza con que el servidor
 * "siempre la haga": una restauracion o un `psql` a mano la saltean.
 */
export function normalizarCodigoDeLote(codigo: string): string {
  return codigo.trim().replace(/\s+/g, ' ').toUpperCase()
}

/**
 * El juego de caracteres que admite un codigo de lote.
 *
 * Acotarlo NO es burocracia: es lo que hace que `upper()` de PostgreSQL y
 * `toUpperCase()` de JavaScript den siempre el mismo resultado, y por lo tanto
 * que el CHECK de normalizacion sea cumplible. Un codigo de lote es lo que esta
 * impreso en el envase, y eso es alfanumerico.
 */
export const CODIGO_DE_LOTE = /^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/
export const LARGO_MAXIMO_DE_CODIGO = 64

export function motivoDeCodigoInvalido(codigo: string): string | null {
  const limpio = codigo.trim()
  if (limpio === '') return 'El código del lote es obligatorio'
  if (limpio.length > LARGO_MAXIMO_DE_CODIGO) {
    return `El código del lote no puede tener más de ${String(LARGO_MAXIMO_DE_CODIGO)} caracteres`
  }
  if (!CODIGO_DE_LOTE.test(limpio)) {
    return 'El código del lote admite letras, números, espacios y los signos . _ / -'
  }
  return null
}
