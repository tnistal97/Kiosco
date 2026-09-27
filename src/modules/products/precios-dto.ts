/**
 * El cambio masivo de precios, tal como viaja. Fase P0-B.
 *
 * Los tipos los arma el servidor (`precios-masivos.ts`) y los lee la pantalla
 * con los `parse*` de aca. Este modulo NO importa Prisma.
 */

import { booleano, esObjeto, lista, numero, texto, textoOpcional } from '@/lib/api-client'
import { montoODefecto, montoOpcional, type Monto } from '@/lib/money'

/** Que le pasa a cada producto de la seleccion. */
export type EstadoDePrecio = 'cambia' | 'igual' | 'no-aplica'

export interface ItemDePrecio {
  id: number
  nombre: string
  codigo: string | null
  categoria: string
  activo: boolean
  antes: Monto
  /** Null cuando no se puede calcular: el motivo lo dice. */
  despues: Monto | null
  /** Solo para quien puede ver costos. */
  costo: string | null
  estado: EstadoDePrecio
  motivo: string | null
  /** El precio nuevo queda por debajo del costo. Solo si se ve el costo. */
  bajoCosto: boolean
}

export interface ResumenDePrecios {
  /** Productos que entraron en la seleccion. */
  productos: number
  cambian: number
  iguales: number
  noAplican: number
  /** El precio nuevo mas bajo y el mas alto, entre los que cambian. */
  minimo: Monto | null
  maximo: Monto | null
  /** Cuanto varia el total de los que cambian, en porcentaje: `"10.25"`. */
  variacion: string | null
}

export interface VistaDePrecios {
  descripcion: string
  huella: string
  resumen: ResumenDePrecios
  items: ItemDePrecio[]
}

export interface ResultadoDePrecios {
  operacion: string
  cambiados: number
  descripcion: string
}

export interface UltimoCambioMasivo {
  operacion: string
  fecha: string
  usuario: string
  descripcion: string
  productos: number
  /** Solo el ultimo cambio masivo, y solo si no se deshizo ya. */
  deshacible: boolean
}

export interface ResultadoDeDeshacer {
  restaurados: number
  /** Los que no se tocaron porque alguien los cambio despues. Hasta 50. */
  saltados: Array<{ nombre: string; motivo: string }>
  totalSaltados: number
}

function parseEstado(raw: unknown): EstadoDePrecio {
  return raw === 'cambia' || raw === 'igual' ? raw : 'no-aplica'
}

function parseItem(raw: unknown): ItemDePrecio {
  if (!esObjeto(raw)) throw new Error('El producto no tiene la forma esperada')
  return {
    id: numero(raw.id),
    nombre: texto(raw.nombre),
    codigo: textoOpcional(raw.codigo),
    categoria: texto(raw.categoria),
    activo: booleano(raw.activo, true),
    antes: montoODefecto(raw.antes),
    despues: montoOpcional(raw.despues),
    costo: textoOpcional(raw.costo),
    estado: parseEstado(raw.estado),
    motivo: textoOpcional(raw.motivo),
    bajoCosto: booleano(raw.bajoCosto),
  }
}

export function parseVistaDePrecios(raw: unknown): VistaDePrecios {
  if (!esObjeto(raw) || !esObjeto(raw.resumen)) {
    throw new Error('La respuesta no tiene la forma de una vista previa de precios')
  }
  const r = raw.resumen
  return {
    descripcion: texto(raw.descripcion),
    huella: texto(raw.huella),
    resumen: {
      productos: numero(r.productos),
      cambian: numero(r.cambian),
      iguales: numero(r.iguales),
      noAplican: numero(r.noAplican),
      minimo: montoOpcional(r.minimo),
      maximo: montoOpcional(r.maximo),
      variacion: textoOpcional(r.variacion),
    },
    items: lista(raw.items, parseItem),
  }
}

export function parseResultadoDePrecios(raw: unknown): ResultadoDePrecios {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  return {
    operacion: texto(raw.operacion),
    cambiados: numero(raw.cambiados),
    descripcion: texto(raw.descripcion),
  }
}

export function parseUltimoCambioMasivo(raw: unknown): UltimoCambioMasivo | null {
  if (!esObjeto(raw) || !esObjeto(raw.ultimo)) return null
  const u = raw.ultimo
  return {
    operacion: texto(u.operacion),
    fecha: texto(u.fecha),
    usuario: texto(u.usuario),
    descripcion: texto(u.descripcion),
    productos: numero(u.productos),
    deshacible: booleano(u.deshacible),
  }
}

export function parseResultadoDeDeshacer(raw: unknown): ResultadoDeDeshacer {
  if (!esObjeto(raw)) throw new Error('La respuesta no tiene la forma esperada')
  return {
    restaurados: numero(raw.restaurados),
    saltados: lista(raw.saltados, (s) => {
      if (!esObjeto(s)) throw new Error('La respuesta no tiene la forma esperada')
      return { nombre: texto(s.nombre), motivo: texto(s.motivo) }
    }),
    totalSaltados: numero(raw.totalSaltados),
  }
}
