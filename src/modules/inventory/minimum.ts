/**
 * Estado de reposicion de un producto.
 *
 * Se CALCULA, nunca se guarda. Un estado guardado se desincroniza en cuanto
 * alguien cambia el minimo sin recalcular, y entonces la pantalla avisa de
 * faltantes que no faltan y calla los que si.
 *
 * Vive aca, sin Prisma, porque lo necesitan las dos puntas: el servidor para
 * filtrar y el navegador para pintar la etiqueta.
 * Ver docs/INVENTORY_LEDGER.md, seccion 8.
 */

import { aMilesimas, type TextoCantidad } from '@/lib/cantidad'
import { esFraccionable, type UnidadDeVenta } from '@/modules/products/units'

export type EstadoStock = 'OUT' | 'LOW' | 'OK'

/**
 * Minimo SUGERIDO al cargar un producto nuevo, segun su unidad.
 *
 * Hasta la Fase 2 habia UN umbral, igual para el agua mineral y para el
 * fernet, y por eso desaparecio como tal: ahora cada producto tiene el suyo en
 * `Product.minimumStock`. Esto se conserva unicamente como valor propuesto en
 * el formulario, que es donde una sugerencia tiene sentido, y NO se aplica
 * solo: un producto con minimo cero sigue en OK.
 *
 * Un kilo para lo que se pesa y diez para lo que se cuenta. Diez kilos de
 * queso serian medio mostrador; diez unidades de algo son una fila del
 * estante.
 */
export function minimoSugerido(unidad: UnidadDeVenta): TextoCantidad {
  return esFraccionable(unidad) ? '1.000' : '10.000'
}

/**
 * Estado de un producto segun su stock y su minimo.
 *
 *   OUT   no hay
 *   LOW   hay, pero llego al minimo
 *   OK    hay de sobra
 *
 * Las dos cantidades vienen en la MISMA unidad --la de venta del producto--,
 * que es la unica forma de que la comparacion signifique algo. La aritmetica
 * es entera, en milesimas: comparar `0.1 <= 0.3` en punto flotante funciona
 * casi siempre, y "casi siempre" en un umbral de reposicion significa que un
 * producto no aparece en la lista de faltantes un dia de cada cien.
 *
 * Con `minimumStock = 0` --sin minimo configurado, que es lo que la migracion
 * le pone a todo el catalogo existente-- LOW no se cumple nunca: `cantidad > 0`
 * y `cantidad <= 0` no pueden ser ciertas a la vez. Es intencional. El sistema
 * no sabe cuantos fideos quiere tener este almacen y no lo inventa.
 */
export function estadoDeStock(cantidad: TextoCantidad, minimo: TextoCantidad): EstadoStock {
  const hay = aMilesimas(cantidad)
  if (hay <= 0) return 'OUT'
  if (hay <= aMilesimas(minimo)) return 'LOW'
  return 'OK'
}

/** Si el producto tiene un minimo configurado. Cero es "sin configurar". */
export function tieneMinimo(minimo: TextoCantidad): boolean {
  return aMilesimas(minimo) > 0
}

const ETIQUETAS: Record<EstadoStock, string> = {
  OUT: 'Agotado',
  LOW: 'Bajo mínimo',
  OK: 'En stock',
}

export function etiquetaDeEstado(estado: EstadoStock): string {
  return ETIQUETAS[estado]
}
