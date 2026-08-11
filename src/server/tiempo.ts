/**
 * El dia comercial, del lado del servidor.
 *
 * `src/lib/tiempo.ts` sabe convertir entre fechas y instantes DADA una zona.
 * Este modulo sabe de donde sale la zona: de la sucursal.
 *
 * Regla unica del sistema, y no tiene excepciones:
 *
 *   EL NAVEGADOR MANDA `YYYY-MM-DD`. EL SERVIDOR LO CONVIERTE CON LA ZONA DE
 *   LA SUCURSAL.
 *
 * Ni el navegador manda instantes UTC --no sabe donde queda el local--, ni el
 * servidor usa su propia zona --puede estar en otro pais--. La zona horaria
 * del sistema operativo, sea Windows o Linux, no decide nada en ningun camino.
 *
 * Ver docs/TIMEZONE_POLICY.md.
 */

import { prisma } from '@/lib/prisma'
import type { Prisma } from '@prisma/client'
import {
  ZONA_POR_DEFECTO,
  esZonaValida,
  hoyEn,
  rangoDeDias,
  type FechaLocal,
  type RangoDeDias,
  type ZonaHoraria,
} from '@/lib/tiempo'

export {
  ZONA_POR_DEFECTO,
  cantidadDeDias,
  diaDe,
  esFechaLocal,
  esZonaValida,
  finDelDia,
  hoyEn,
  inicioDelDia,
  rangoDeDias,
  sumarDias,
  type FechaLocal,
  type RangoDeDias,
  type ZonaHoraria,
} from '@/lib/tiempo'

type Cliente = Prisma.TransactionClient | typeof prisma

/**
 * La zona horaria de una sucursal.
 *
 * Un valor invalido en la base --alguien lo edito a mano, una restauracion
 * vieja-- NO hace fallar la consulta: cae a la zona por defecto. Un reporte
 * que no abre es peor que un reporte con la zona del pais, y la restriccion
 * `CHECK` de la migracion hace que este caso no deberia ocurrir.
 */
export async function zonaDeSucursal(cliente: Cliente, branchId: number): Promise<ZonaHoraria> {
  const sucursal = await cliente.branch.findUnique({
    where: { id: branchId },
    select: { timeZone: true },
  })
  const zona = sucursal?.timeZone ?? ZONA_POR_DEFECTO
  return esZonaValida(zona) ? zona : ZONA_POR_DEFECTO
}

/** Hoy en la sucursal. Es lo que el panel entiende por "hoy". */
export async function hoyEnSucursal(cliente: Cliente, branchId: number): Promise<FechaLocal> {
  return hoyEn(await zonaDeSucursal(cliente, branchId))
}

/**
 * El rango de instantes de un intervalo de dias, en la zona de la sucursal.
 *
 * Es la funcion que reemplaza a cada `new Date(\`${fecha}T00:00:00Z\`)` que
 * hubo en el sistema. Una sola consulta a `Branch` por llamada; quien la
 * necesite muchas veces seguidas resuelve la zona una vez con
 * `zonaDeSucursal` y usa `rangoDeDias` directamente.
 */
export async function rangoDeSucursal(
  cliente: Cliente,
  branchId: number,
  desde: FechaLocal,
  hasta: FechaLocal,
): Promise<RangoDeDias> {
  return rangoDeDias(desde, hasta, await zonaDeSucursal(cliente, branchId))
}

/**
 * Un instante como literal `timestamp` SIN zona, en UTC. `2026-08-11 00:08:36.972`.
 *
 * ES OBLIGATORIO PARA TODA COMPARACION DE FECHAS EN SQL CRUDO, y el motivo es
 * un error real que sobrevivio a la Fase 3D entera:
 *
 *   Las columnas de fecha son `timestamp(3)` SIN zona, y guardan UTC. Cuando
 *   una consulta compara una de esas columnas contra un `Date` de JavaScript,
 *   el conector lo manda como `timestamptz`, y PostgreSQL --para poder
 *   compararlos-- convierte LA COLUMNA usando la zona de la SESION, que sale
 *   del sistema operativo del servidor de base de datos.
 *
 *   Con la base corriendo en Argentina, una venta de las 21:08 --guardada como
 *   `2026-08-11 00:08` UTC-- se convierte a `2026-08-11 03:08` y queda FUERA
 *   del rango de su propio dia, que termina a las `02:59:59.999`.
 *
 *   Es exactamente la desaparicion de las ventas posteriores a las 21:00 que
 *   la Fase 3C encontro y la 3D creyo cerrar. La 3D arreglo el lado de
 *   JavaScript --el rango se calcula con la zona IANA de la sucursal, y eso
 *   sigue estando bien-- pero no este otro lado, y la suite no lo detecto
 *   porque corrio antes de las 21:00. Un error que solo aparece tres horas por
 *   dia es peor que uno permanente: parece intermitente.
 *
 * Pasando el borde como TEXTO y casteandolo a `::timestamp` en la consulta, no
 * hay ninguna conversion: los dos lados son `timestamp` sin zona y los dos
 * estan en UTC. La zona del sistema operativo deja de decidir, que es la regla
 * de todo el modulo.
 *
 * Ver docs/TIMEZONE_POLICY.md.
 */
export function comoTimestampUTC(instante: Date): string {
  return instante.toISOString().replace('T', ' ').replace('Z', '')
}
