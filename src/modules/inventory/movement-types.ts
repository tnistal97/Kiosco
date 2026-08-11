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
   * Entrada de mercaderia. Lo emite la recepcion de una orden de compra, y
   * NADA MAS: no figura entre los tipos de ajuste manual, para que nadie
   * pueda inventar una entrada sin la compra que la respalda.
   *
   * Su referencia apunta a la RECEPCION, no a la orden: una orden puede tener
   * varias entregas. Ver docs/PURCHASE_RECEIVING.md.
   */
  'PURCHASE_RECEIPT',
  /**
   * Mercaderia que vuelve al proveedor. Lo emite la confirmacion de una
   * devolucion, y NADA MAS: tampoco figura entre los tipos de ajuste manual.
   *
   * Tiene tipo propio en vez de ser un ajuste porque un ajuste diria que faltan
   * ocho unidades, y esto dice que ocho unidades volvieron al proveedor. Esa
   * diferencia es el unico dato que despues permite preguntar cuanto se devolvio
   * en el trimestre y separarlo de lo que se perdio --el mismo motivo por el que
   * `LOSS` y `BREAKAGE` no son el mismo tipo--.
   *
   * Su referencia apunta a la DEVOLUCION. Ver docs/PURCHASE_RETURN_FLOW.md.
   */
  'PURCHASE_RETURN',
  /**
   * La diferencia de un inventario fisico. Lo emite la APLICACION de una sesion
   * de conteo, y NADA MAS: tampoco figura entre los tipos de ajuste manual.
   *
   * Su signo es 'ambos' porque una diferencia puede ir para los dos lados, y esa
   * es exactamente la razon de no llamarlo `LOSS`: un sobrante contado no es una
   * perdida negativa, es un sobrante, y el reporte de mermas mentiria si los
   * mezclara. Ver el objetivo 50.
   *
   * Es distinto de `MANUAL_ADJUSTMENT` --que tambien nace de un recuento-- porque
   * este viene de un recorrido con conteo a ciegas, revision y aplicacion en
   * bloque, y se puede rastrear hasta su sesion. Su referencia apunta a la SESION.
   * Ver docs/PHYSICAL_INVENTORY.md.
   */
  'INVENTORY_COUNT',
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
  PURCHASE_RETURN: 'sale',
  INVENTORY_COUNT: 'ambos',
}

/**
 * Tipos que un ajuste manual puede declarar.
 *
 * Subconjunto a proposito: `SALE` y `SALE_CANCEL` los emite la venta,
 * `INITIAL` la migracion, `PURCHASE_RECEIPT` la recepcion de una compra,
 * `PURCHASE_RETURN` la confirmacion de una devolucion e `INVENTORY_COUNT` la
 * aplicacion de un inventario fisico. Si esta lista aceptara cualquier tipo,
 * cualquiera podria escribir una venta falsa --o una entrada de mercaderia sin
 * compra, o una salida sin devolucion, o la diferencia de un inventario que
 * nadie conto-- desde la pantalla de ajustes.
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
  PURCHASE_RETURN: 'Devolución a proveedor',
  INVENTORY_COUNT: 'Inventario físico',
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
