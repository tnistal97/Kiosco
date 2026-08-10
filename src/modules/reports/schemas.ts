/**
 * Entrada de los reportes: un rango de dias, y nada mas.
 *
 * `YYYY-MM-DD` y no un instante. Es LA regla de fechas del sistema: el
 * navegador manda el dia, el servidor lo convierte con la zona de la sucursal.
 * Aceptar un instante seria dejar que el navegador decida donde empieza el
 * dia, que es el error que la Fase 3C encontro. Ver docs/TIMEZONE_POLICY.md.
 */

import { z } from 'zod'

const fechaSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va como AAAA-MM-DD')

export const rangoQuerySchema = z.object({
  desde: fechaSchema,
  hasta: fechaSchema,
})

export type RangoQuery = z.infer<typeof rangoQuerySchema>
