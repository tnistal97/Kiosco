/**
 * Unidades de medida y regla de fraccionamiento.
 *
 * UNA sola definicion para las dos puntas: el servidor valida con esto y el
 * navegador arma el campo numerico con esto. Poner la regla solo en React
 * significaria que `1.235 UNIT` entra por `curl`; ponerla solo en el servidor
 * significaria que el cajero se entera de que no puede despues de tipear.
 *
 * Este modulo NO importa Prisma: lo usan los componentes del punto de venta.
 * Ver docs/PHASE3_QUANTITY_MIGRATION.md.
 */

import { aMilesimas, type TextoCantidad } from '@/lib/cantidad'

/**
 * Unidades en las que se puede VENDER.
 *
 * Cinco, y ninguna mas por ahora. `PACK` y `BOX` no estan aca a proposito: un
 * six-pack que se vende entero es un producto que se vende por unidad, y esa
 * unidad es el six-pack. No hay ninguna cuenta que distinga `PACK` de `UNIT`
 * en una venta.
 */
export const UNIDADES_DE_VENTA = ['UNIT', 'KG', 'G', 'L', 'ML'] as const
export type UnidadDeVenta = (typeof UNIDADES_DE_VENTA)[number]

/**
 * Unidades en las que se puede COMPRAR.
 *
 * Las cinco de venta mas `PACK` y `BOX`, que aca si hacen falta: son el unico
 * modo de que `unitsPerPurchaseUnit` se pueda leer. "Compro una caja de 8 y
 * vendo 8 unidades" escrito con `purchaseUnit = UNIT` diria "una unidad
 * contiene ocho unidades".
 *
 * La compra en si es Fase 3C. Estos dos campos existen desde ahora para que la
 * ficha del producto quede completa y no haya que migrar el catalogo dos veces.
 */
export const UNIDADES_DE_COMPRA = ['UNIT', 'KG', 'G', 'L', 'ML', 'PACK', 'BOX'] as const
export type UnidadDeCompra = (typeof UNIDADES_DE_COMPRA)[number]

/** Unidad por omision. Es la que reciben todos los productos existentes. */
export const UNIDAD_POR_OMISION: UnidadDeVenta = 'UNIT'

export interface PoliticaDeUnidad {
  /** Lo que va pegado al numero: "kg", "u.". */
  simbolo: string
  /** Nombre completo, para el selector del formulario. */
  nombre: string
  /** Decimales que acepta. Cero o tres; no hay valor intermedio. */
  decimales: 0 | 3
  /** Menor incremento representable. */
  paso: TextoCantidad
  /** Menor cantidad vendible. Hoy coincide con el paso en las cinco. */
  minimo: TextoCantidad
}

/**
 * La regla, unidad por unidad.
 *
 * `G` y `ML` tienen paso 1 y no 0,001, y esa es una decision con motivo: medio
 * gramo no lo pesa ninguna balanza de mostrador y nadie lo vende. Aceptarlo
 * seria ofrecer una precision que no existe fuera del sistema.
 *
 * La consecuencia practica es la que importa: las UNICAS unidades fraccionables
 * son `KG` y `L`. `UNIT`, `G` y `ML` se comportan igual entre si para toda la
 * validacion, y el dialogo de peso del punto de venta se abre exactamente para
 * dos casos, no para cinco.
 */
export const POLITICA_DE_UNIDAD: Record<UnidadDeVenta, PoliticaDeUnidad> = {
  UNIT: { simbolo: 'u.', nombre: 'Unidad', decimales: 0, paso: '1.000', minimo: '1.000' },
  KG: { simbolo: 'kg', nombre: 'Kilogramo', decimales: 3, paso: '0.001', minimo: '0.001' },
  G: { simbolo: 'g', nombre: 'Gramo', decimales: 0, paso: '1.000', minimo: '1.000' },
  L: { simbolo: 'L', nombre: 'Litro', decimales: 3, paso: '0.001', minimo: '0.001' },
  ML: { simbolo: 'ml', nombre: 'Mililitro', decimales: 0, paso: '1.000', minimo: '1.000' },
}

/** Nombre de una unidad de compra, incluidas las que no se venden. */
export const NOMBRE_DE_UNIDAD_DE_COMPRA: Record<UnidadDeCompra, string> = {
  UNIT: 'Unidad',
  KG: 'Kilogramo',
  G: 'Gramo',
  L: 'Litro',
  ML: 'Mililitro',
  PACK: 'Pack',
  BOX: 'Caja',
}

export function esUnidadDeVenta(u: string): u is UnidadDeVenta {
  return (UNIDADES_DE_VENTA as readonly string[]).includes(u)
}

export function esUnidadDeCompra(u: string): u is UnidadDeCompra {
  return (UNIDADES_DE_COMPRA as readonly string[]).includes(u)
}

/** Unidad valida o la de omision. Para parsear lo que llega del servidor. */
export function unidadDeVentaODefecto(u: unknown): UnidadDeVenta {
  return typeof u === 'string' && esUnidadDeVenta(u) ? u : UNIDAD_POR_OMISION
}

export function unidadDeCompraODefecto(u: unknown): UnidadDeCompra {
  return typeof u === 'string' && esUnidadDeCompra(u) ? u : UNIDAD_POR_OMISION
}

export function politicaDe(unidad: UnidadDeVenta): PoliticaDeUnidad {
  return POLITICA_DE_UNIDAD[unidad]
}

/**
 * Si la unidad admite fracciones.
 *
 * Es la pregunta que decide si el escaneo agrega una unidad sola o abre el
 * dialogo de peso.
 */
export function esFraccionable(unidad: UnidadDeVenta): boolean {
  return POLITICA_DE_UNIDAD[unidad].decimales > 0
}

/**
 * Comprueba una cantidad contra la politica de su unidad.
 *
 * Devuelve el motivo del rechazo o `null` si esta bien. Un mensaje y no un
 * booleano porque el mensaje es lo unico que le sirve a quien lo tipeo: "la
 * cantidad debe ser un numero entero" y "no puede ser menor que 0,001 kg" son
 * dos problemas distintos con dos soluciones distintas.
 */
export function motivoDeCantidadInvalida(
  unidad: UnidadDeVenta,
  cantidad: TextoCantidad,
): string | null {
  const politica = POLITICA_DE_UNIDAD[unidad]

  let milesimas: number
  try {
    milesimas = aMilesimas(cantidad)
  } catch {
    return 'La cantidad no es un número válido'
  }

  if (milesimas <= 0) return 'La cantidad debe ser mayor que cero'

  const paso = aMilesimas(politica.paso)
  if (milesimas % paso !== 0) {
    return politica.decimales === 0
      ? `${politica.nombre.toLowerCase()}: la cantidad debe ser un número entero`
      : `La cantidad debe ser múltiplo de ${politica.paso} ${politica.simbolo}`
  }

  if (milesimas < aMilesimas(politica.minimo)) {
    return `La cantidad mínima es ${formatearCantidad(politica.minimo, unidad)}`
  }

  return null
}

export function esCantidadValida(unidad: UnidadDeVenta, cantidad: TextoCantidad): boolean {
  return motivoDeCantidadInvalida(unidad, cantidad) === null
}

const FORMATOS: Record<0 | 3, Intl.NumberFormat> = {
  0: new Intl.NumberFormat('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }),
  3: new Intl.NumberFormat('es-AR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }),
}

/**
 * La cantidad sola, con los decimales que le corresponden a su unidad.
 *
 * `"3.000"` en `UNIT` se muestra `3`, no `3,000`. Tres decimales sobre algo que
 * se cuenta con los dedos hace que la pantalla se lea como una balanza.
 */
export function formatearCantidad(c: TextoCantidad, unidad: UnidadDeVenta): string {
  const politica = POLITICA_DE_UNIDAD[unidad]
  return FORMATOS[politica.decimales].format(aMilesimas(c) / 1000)
}

/** La cantidad con su unidad: `"0,425 kg"`, `"3 u."`. */
export function formatearCantidadConUnidad(c: TextoCantidad, unidad: UnidadDeVenta): string {
  return `${formatearCantidad(c, unidad)} ${POLITICA_DE_UNIDAD[unidad].simbolo}`
}

/**
 * Denominador del precio: `"/ kg"`.
 *
 * En `UNIT` devuelve cadena vacia. "$1.200 / u." no le dice nada a nadie que no
 * lo supiera ya; "$9.800 / kg" es la mitad de la informacion.
 */
export function denominadorDePrecio(unidad: UnidadDeVenta): string {
  return unidad === 'UNIT' ? '' : `/ ${POLITICA_DE_UNIDAD[unidad].simbolo}`
}
