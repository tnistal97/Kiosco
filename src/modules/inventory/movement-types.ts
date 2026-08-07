/**
 * Vocabulario del libro de inventario.
 *
 * Un unico catalogo de tipos para el servidor, el navegador y la base. Los
 * tres tienen que decir lo mismo: la restriccion CHECK de PostgreSQL replica
 * exactamente la tabla de signos de este archivo, y hay una prueba que
 * comprueba que no se separen.
 *
 * Este modulo NO importa Prisma: lo usa la pantalla de movimientos.
 * Ver docs/INVENTORY_LEDGER.md.
 */

export const TIPOS_MOVIMIENTO = [
  /** Saldo de partida. Lo emite la migracion y el alta con stock inicial. */
  'INITIAL',
  'SALE',
  'SALE_CANCEL',
  'MANUAL_ADJUSTMENT',
  'LOSS',
  'BREAKAGE',
  'INTERNAL_USE',
  /**
   * Reservado para la Fase 3C. Figura en el catalogo y en la restriccion de la
   * base, pero NADA lo emite todavia: no hay compras ni recepcion. Esta aca
   * para que darle entrada a la mercaderia no obligue a alterar una
   * restriccion sobre una tabla que para entonces va a tener volumen.
   */
  'PURCHASE_RECEIPT',
] as const

export type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number]

/**
 * Signo obligatorio de cada tipo.
 *
 *   'entra'  el delta tiene que ser positivo
 *   'sale'   el delta tiene que ser negativo
 *   'ambos'  cualquiera menos cero
 *
 * Una venta que aumente el stock no es un error que haya que buscar: es una
 * fila que la base rechaza. Esta tabla es la version legible de esa
 * restriccion, y se comprueba antes de escribir para dar un mensaje util.
 *
 * `INITIAL` figura como 'entra'. La restriccion de la base es un punto mas
 * permisiva --acepta cero-- porque un saldo de partida de cero es
 * representable; el servicio no lo emite igual, porque un movimiento de cero
 * unidades ensucia el historial sin decir nada, y la invariante
 * suma(movimientos) == cantidad se cumple sola con la suma vacia.
 */
export const SIGNO_DE_TIPO: Record<TipoMovimiento, 'entra' | 'sale' | 'ambos'> = {
  INITIAL: 'entra',
  SALE: 'sale',
  SALE_CANCEL: 'entra',
  MANUAL_ADJUSTMENT: 'ambos',
  LOSS: 'sale',
  BREAKAGE: 'sale',
  INTERNAL_USE: 'sale',
  PURCHASE_RECEIPT: 'entra',
}

/**
 * Tipos que un ajuste manual puede declarar.
 *
 * Subconjunto a proposito: `SALE` y `SALE_CANCEL` los emite la venta, `INITIAL`
 * la migracion y `PURCHASE_RECEIPT` no existe todavia. Si esta lista aceptara
 * cualquier tipo, cualquiera podria escribir una venta falsa desde la pantalla
 * de ajustes.
 */
export const TIPOS_DE_AJUSTE = [
  'MANUAL_ADJUSTMENT',
  'LOSS',
  'BREAKAGE',
  'INTERNAL_USE',
] as const satisfies readonly TipoMovimiento[]

export type TipoDeAjuste = (typeof TIPOS_DE_AJUSTE)[number]

const ETIQUETAS: Record<TipoMovimiento, string> = {
  INITIAL: 'Saldo inicial',
  SALE: 'Venta',
  SALE_CANCEL: 'Anulación de venta',
  MANUAL_ADJUSTMENT: 'Ajuste',
  LOSS: 'Pérdida',
  BREAKAGE: 'Rotura',
  INTERNAL_USE: 'Consumo interno',
  PURCHASE_RECEIPT: 'Recepción de compra',
}

/**
 * Nombre para mostrar. Nunca se muestra el codigo crudo.
 *
 * Un tipo desconocido --uno de una version futura-- se muestra tal cual en vez
 * de desaparecer: que en pantalla diga `SOMETHING` es feo; que la fila quede
 * vacia hace que nadie se entere.
 */
export function etiquetaDeTipo(tipo: string): string {
  const conocido: string | undefined = esTipoValido(tipo) ? ETIQUETAS[tipo] : undefined
  return conocido ?? tipo
}

export function esTipoValido(tipo: string): tipo is TipoMovimiento {
  return (TIPOS_MOVIMIENTO as readonly string[]).includes(tipo)
}

export function esTipoDeAjuste(tipo: string): tipo is TipoDeAjuste {
  return (TIPOS_DE_AJUSTE as readonly string[]).includes(tipo)
}

/**
 * Descripciones para la pantalla de ajuste.
 *
 * El texto importa: es lo que decide si una botella rota se carga como
 * `BREAKAGE` o como un ajuste generico, y esa diferencia es el unico dato que
 * despues permite preguntar cuanto se rompio en el mes.
 */
export const AYUDA_DE_AJUSTE: Record<TipoDeAjuste, string> = {
  MANUAL_ADJUSTMENT: 'Recuento, corrección de carga, diferencia sin causa conocida',
  LOSS: 'Faltante, vencido, robo',
  BREAKAGE: 'Se rompió',
  INTERNAL_USE: 'Consumo del local, degustación, uso propio',
}
