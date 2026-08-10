/**
 * El informe de integridad completo.
 *
 * Corre todas las comprobaciones y junta el resultado. No escribe nada, ni
 * siquiera en la bitacora: leer no es un evento auditable, y una herramienta
 * de control que deja rastro en lo que controla es una mala herramienta.
 */

import { COMPROBACIONES } from './checks'
import { totalDeInconsistencias, type Informe } from './tipos'

/**
 * Corre las comprobaciones en serie, no en paralelo.
 *
 * Nueve consultas pesadas a la vez sobre la base del comercio dejarian la caja
 * esperando. Esto no es un camino caliente: se corre a mano o de madrugada, y
 * puede tardar.
 */
export async function comprobarIntegridad(): Promise<Informe> {
  const arranque = Date.now()

  const comprobaciones = []
  for (const correr of COMPROBACIONES) {
    comprobaciones.push(await correr())
  }

  const duracionMs = Date.now() - arranque

  return {
    comprobaciones,
    total: totalDeInconsistencias(comprobaciones),
    duracionMs,
  }
}
