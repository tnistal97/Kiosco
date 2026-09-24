/**
 * Datos de la instancia que se leen al atender, no al construir.
 *
 * MOTIVO: el nombre del comercio salia de `NEXT_PUBLIC_COMMERCE_NAME`, leida
 * en paginas de cliente. Next reemplaza esas lecturas por el valor en el
 * momento del `next build`, asi que cambiar el nombre --o dar de alta un
 * comercio nuevo con el mismo codigo-- pedia recompilar, aunque la pantalla
 * dijera que alcanzaba con reiniciar.
 *
 * Ahora lo lee el servidor en cada peticion (el layout raiz es dinamico) y lo
 * baja al navegador con la sesion. Cambiarlo es editar el archivo de entorno y
 * reiniciar el servicio.
 *
 * La sucursal y su zona horaria ya se leian de la base en cada peticion; no
 * cambian.
 */

import type { Entorno } from '@/server/env'

export const NOMBRE_POR_DEFECTO = 'Almacén'

/** Tope razonable para un encabezado y la pestania del navegador. */
export const NOMBRE_MAX = 60

/**
 * El nombre del comercio de esta instancia.
 *
 * `COMMERCE_NAME` manda. `NEXT_PUBLIC_COMMERCE_NAME` se sigue aceptando como
 * respaldo para no dejar sin nombre a una instalacion que ya la tiene en su
 * archivo de entorno; como aca se lee del objeto y no como
 * `process.env.NEXT_PUBLIC_...` literal, tambien se lee al atender.
 */
export function nombreDelComercio(env: Entorno = process.env): string {
  const crudo = env.COMMERCE_NAME ?? env.NEXT_PUBLIC_COMMERCE_NAME ?? ''
  const limpio = crudo.replace(/\s+/g, ' ').trim().slice(0, NOMBRE_MAX).trim()
  return limpio === '' ? NOMBRE_POR_DEFECTO : limpio
}
