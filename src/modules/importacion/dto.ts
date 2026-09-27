/**
 * La vista previa y el resultado de una importacion, tal como viajan.
 *
 * Los tipos los arma el servidor (`service.ts`) y los lee la pantalla con los
 * `parse*` de aca, que es donde termina el `unknown` de `res.json()`.
 *
 * Este modulo NO importa Prisma.
 */

import { esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { unidadDeVentaODefecto, type UnidadDeVenta } from '@/modules/products/units'
import { CAMPOS, type Campo } from './columnas'

/** Que va a pasar con una fila. */
export const ACCIONES_DE_FILA = ['crear', 'actualizar', 'sin-cambios', 'omitir', 'error'] as const
export type AccionDeFila = (typeof ACCIONES_DE_FILA)[number]

/**
 * Un dato que cambia, en su forma canonica: `"1500.00"`, `"12.000"`.
 *
 * `antes` es null en un producto nuevo, y tambien en el costo cuando quien
 * importa no tiene permiso para ver costos: la vista previa no es una puerta
 * lateral para leerlos.
 */
export interface CambioDeFila {
  campo: Campo
  antes: string | null
  despues: string | null
}

export interface FilaDeVistaPrevia {
  /** Numero de fila de Excel. */
  fila: number
  accion: AccionDeFila
  /** El producto del catalogo con el que coincide, si coincide con alguno. */
  productoId: number | null
  nombre: string
  codigo: string | null
  unidad: UnidadDeVenta
  cambios: CambioDeFila[]
  /** Por que la fila no se importa. Vacio si se importa. */
  errores: string[]
  /** Se importa, pero hay algo que conviene mirar. */
  avisos: string[]
  /** Por que se omite una fila valida: "Ya está en el catálogo". */
  motivo: string | null
}

export interface TotalesDeVistaPrevia {
  filas: number
  conErrores: number
  crear: number
  actualizar: number
  sinCambios: number
  omitir: number
  /** Filas validas que coinciden con un producto del catalogo. */
  existentes: number
  /** Filas validas que no coinciden con ninguno. */
  nuevos: number
  /** Filas con el codigo o el nombre repetido en el mismo archivo. */
  repetidasEnArchivo: number
  /** Filas que van a mover stock. */
  conStock: number
}

export interface VistaPrevia {
  importacion: string
  huella: string
  totales: TotalesDeVistaPrevia
  /** Problemas que impiden importar, sea cual sea la fila. */
  bloqueos: string[]
  /** Categorias que no existen y se van a crear. */
  categoriasNuevas: string[]
  filas: FilaDeVistaPrevia[]
}

export interface ResultadoDeImportacion {
  importacion: string
  creados: number
  actualizados: number
  sinCambios: number
  omitidos: number
  conErrores: number
  categoriasCreadas: string[]
  movimientosDeStock: number
  milisegundos: number
}

function textos(raw: unknown): string[] {
  return lista(raw, (t) => texto(t))
}

function parseCampo(raw: unknown): Campo {
  const t = texto(raw)
  if (!(CAMPOS as readonly string[]).includes(t)) throw new Error(`Campo desconocido: ${t}`)
  return t as Campo
}

function parseAccion(raw: unknown): AccionDeFila {
  const t = texto(raw)
  if (!(ACCIONES_DE_FILA as readonly string[]).includes(t)) {
    throw new Error(`Acción desconocida: ${t}`)
  }
  return t as AccionDeFila
}

function parseFila(raw: unknown): FilaDeVistaPrevia {
  if (!esObjeto(raw)) throw new Error('La fila no tiene la forma esperada')
  return {
    fila: numero(raw.fila),
    accion: parseAccion(raw.accion),
    productoId: raw.productoId === null ? null : numero(raw.productoId),
    nombre: texto(raw.nombre),
    codigo: textoOpcional(raw.codigo),
    unidad: unidadDeVentaODefecto(raw.unidad),
    cambios: lista(raw.cambios, (c) => {
      if (!esObjeto(c)) throw new Error('El cambio no tiene la forma esperada')
      return {
        campo: parseCampo(c.campo),
        antes: textoOpcional(c.antes),
        despues: textoOpcional(c.despues),
      }
    }),
    errores: textos(raw.errores),
    avisos: textos(raw.avisos),
    motivo: textoOpcional(raw.motivo),
  }
}

export function parseVistaPrevia(raw: unknown): VistaPrevia {
  if (!esObjeto(raw) || !esObjeto(raw.totales)) {
    throw new Error('La respuesta no tiene la forma de una vista previa')
  }
  const t = raw.totales
  return {
    importacion: texto(raw.importacion),
    huella: texto(raw.huella),
    totales: {
      filas: numero(t.filas),
      conErrores: numero(t.conErrores),
      crear: numero(t.crear),
      actualizar: numero(t.actualizar),
      sinCambios: numero(t.sinCambios),
      omitir: numero(t.omitir),
      existentes: numero(t.existentes),
      nuevos: numero(t.nuevos),
      repetidasEnArchivo: numero(t.repetidasEnArchivo),
      conStock: numero(t.conStock),
    },
    bloqueos: textos(raw.bloqueos),
    categoriasNuevas: textos(raw.categoriasNuevas),
    filas: lista(raw.filas, parseFila),
  }
}

export function parseResultadoDeImportacion(raw: unknown): ResultadoDeImportacion {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma de un resultado')
  return {
    importacion: texto(raw.importacion),
    creados: numero(raw.creados),
    actualizados: numero(raw.actualizados),
    sinCambios: numero(raw.sinCambios),
    omitidos: numero(raw.omitidos),
    conErrores: numero(raw.conErrores),
    categoriasCreadas: textos(raw.categoriasCreadas),
    movimientosDeStock: numero(raw.movimientosDeStock),
    milisegundos: numero(raw.milisegundos),
  }
}
