/**
 * Preferencias de impresion. V1 comercial.
 *
 * Viven en el navegador y no en la base A PROPOSITO: la impresora es de la
 * maquina, no del comercio. El mostrador tiene una termica de 58 mm y la
 * oficina una de 80, y cada una elige la suya una vez. El texto final va
 * junto porque es lo unico que hoy se configura del ticket, y una columna en
 * la base para una frase seria mas de lo que hace falta en esta tanda.
 */

export type AnchoDeTicket = '58' | '80'

export interface PreferenciasDeImpresion {
  ancho: AnchoDeTicket
  /** La ultima linea del ticket. Vacio, no se imprime. */
  textoFinal: string
}

export const CLAVE_PREFERENCIAS = 'kiosco:impresion'

export const PREFERENCIAS_POR_DEFECTO: PreferenciasDeImpresion = {
  ancho: '80',
  textoFinal: '¡Gracias por su compra!',
}

export const TEXTO_FINAL_MAX = 120

export function esAncho(v: unknown): v is AnchoDeTicket {
  return v === '58' || v === '80'
}

export function leerPreferencias(): PreferenciasDeImpresion {
  if (typeof window === 'undefined') return PREFERENCIAS_POR_DEFECTO
  try {
    const crudo = window.localStorage.getItem(CLAVE_PREFERENCIAS)
    if (crudo === null) return PREFERENCIAS_POR_DEFECTO
    const v: unknown = JSON.parse(crudo)
    if (typeof v !== 'object' || v === null) return PREFERENCIAS_POR_DEFECTO
    const o = v as Record<string, unknown>
    return {
      ancho: esAncho(o.ancho) ? o.ancho : PREFERENCIAS_POR_DEFECTO.ancho,
      textoFinal:
        typeof o.textoFinal === 'string'
          ? o.textoFinal.slice(0, TEXTO_FINAL_MAX)
          : PREFERENCIAS_POR_DEFECTO.textoFinal,
    }
  } catch {
    return PREFERENCIAS_POR_DEFECTO
  }
}

export function guardarPreferencias(p: PreferenciasDeImpresion): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      CLAVE_PREFERENCIAS,
      JSON.stringify({ ancho: p.ancho, textoFinal: p.textoFinal.slice(0, TEXTO_FINAL_MAX) }),
    )
  } catch {
    // Sin almacenamiento --modo privado, cuota llena-- se imprime con lo
    // que hay. No es un error para el usuario.
  }
}
