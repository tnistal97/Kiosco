/**
 * Como se muestran los datos de una importacion. Sin React: se prueba solo.
 */

import { formatearMonto } from '@/lib/money'
import { textoLocalDeNumero } from '@/lib/numero-local'
import {
  POLITICA_DE_UNIDAD,
  esUnidadDeVenta,
  formatearCantidadConUnidad,
  type UnidadDeVenta,
} from '@/modules/products/units'
import { ETIQUETA_DE_CAMPO, type Campo } from '@/modules/importacion/columnas'
import type { AccionDeFila, CambioDeFila, VistaPrevia } from '@/modules/importacion/dto'
import { textoDeCelda, type Planilla } from '@/modules/importacion/planilla'

export const ETIQUETA_DE_ACCION: Record<
  AccionDeFila,
  { texto: string; tono: 'success' | 'primary' | 'neutral' | 'danger' }
> = {
  crear: { texto: 'Nuevo', tono: 'success' },
  actualizar: { texto: 'Se actualiza', tono: 'primary' },
  'sin-cambios': { texto: 'Sin cambios', tono: 'neutral' },
  omitir: { texto: 'Se omite', tono: 'neutral' },
  error: { texto: 'Con error', tono: 'danger' },
}

/** Un valor canonico, como lo lee una persona. */
export function valorVisible(campo: Campo, valor: string | null, unidad: UnidadDeVenta): string {
  if (valor === null) return '—'
  switch (campo) {
    case 'precio':
      return formatearMonto(valor)
    case 'costo':
      return `$ ${textoLocalDeNumero(valor, { decimales: 4, decimalesMinimos: 2 })}`
    case 'stock':
    case 'stockMinimo':
      return formatearCantidadConUnidad(valor, unidad)
    case 'unidad':
      return esUnidadDeVenta(valor) ? POLITICA_DE_UNIDAD[valor].nombre : valor
    default:
      return valor
  }
}

/** "Precio: $ 12.500,00 → $ 13.000,00", o "Precio: $ 1.500,00" en un alta. */
export function textoDeCambio(c: CambioDeFila, unidad: UnidadDeVenta): string {
  const etiqueta = ETIQUETA_DE_CAMPO[c.campo]
  const despues = valorVisible(c.campo, c.despues, unidad)
  if (c.antes === null) return `${etiqueta}: ${despues}`
  return `${etiqueta}: ${valorVisible(c.campo, c.antes, unidad)} → ${despues}`
}

/**
 * Una celda para un CSV que se va a abrir en Excel.
 *
 * Entre comillas si trae separador, comillas o saltos de linea. Y con un
 * apostrofo adelante si empieza con `=`, `+`, `-` o `@`: Excel ejecutaria eso
 * como formula al abrir el archivo, y el contenido lo escribio cualquiera.
 */
function celdaCsv(texto: string): string {
  const seguro = /^[=+\-@]/.test(texto) ? `'${texto}` : texto
  return /[;"\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro
}

/**
 * Las filas con error, con TODAS sus columnas originales y el motivo al final.
 *
 * Para corregirlas en la planilla y volver a importar solo esas. Punto y coma y
 * marca de UTF-8, que es lo que Excel en castellano abre sin preguntar.
 */
export function csvDeFilasConError(
  planilla: Planilla,
  columnas: readonly string[],
  encabezado: number,
  vista: VistaPrevia,
): string {
  const errores = new Map(
    vista.filas.filter((f) => f.accion === 'error').map((f) => [f.fila, f.errores.join(' | ')]),
  )
  const lineas = [['Fila', ...columnas, 'Error'].map(celdaCsv).join(';')]
  for (const fila of planilla.filas.slice(encabezado + 1)) {
    const error = errores.get(fila.numero)
    if (error === undefined) continue
    const celdas = columnas.map((_, i) => textoDeCelda(fila.celdas[i]))
    lineas.push([String(fila.numero), ...celdas, error].map(celdaCsv).join(';'))
  }
  // La marca de UTF-8 escrita como escape: el caracter crudo es invisible.
  return `\uFEFF${lineas.join('\r\n')}\r\n`
}
