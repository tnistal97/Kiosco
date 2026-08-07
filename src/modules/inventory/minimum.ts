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

export type EstadoStock = 'OUT' | 'LOW' | 'OK'

/**
 * Umbral SUGERIDO al cargar un producto nuevo.
 *
 * Hasta la Fase 2 esto era EL umbral, igual para el agua mineral y para el
 * fernet, y por eso desaparecio como tal: ahora cada producto tiene el suyo en
 * `Product.minimumStock`. Se conserva unicamente como valor propuesto en el
 * formulario, que es donde una sugerencia tiene sentido.
 */
export const MINIMO_SUGERIDO = 10

/**
 * Estado de un producto segun su stock y su minimo.
 *
 *   OUT   no hay
 *   LOW   hay, pero llego al minimo
 *   OK    hay de sobra
 *
 * Con `minimumStock = 0` --sin minimo configurado, que es lo que la migracion
 * le pone a todo el catalogo existente-- LOW no se cumple nunca: `cantidad > 0`
 * y `cantidad <= 0` no pueden ser ciertas a la vez. Es intencional. El sistema
 * no sabe cuantos fideos quiere tener este almacen y no lo inventa.
 */
export function estadoDeStock(cantidad: number, minimo: number): EstadoStock {
  if (cantidad <= 0) return 'OUT'
  if (cantidad <= minimo) return 'LOW'
  return 'OK'
}

/** Si el producto tiene un minimo configurado. Cero es "sin configurar". */
export function tieneMinimo(minimo: number): boolean {
  return minimo > 0
}

const ETIQUETAS: Record<EstadoStock, string> = {
  OUT: 'Agotado',
  LOW: 'Bajo mínimo',
  OK: 'En stock',
}

export function etiquetaDeEstado(estado: EstadoStock): string {
  return ETIQUETAS[estado]
}
