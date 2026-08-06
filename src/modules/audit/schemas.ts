/**
 * Validacion de entrada de la consulta de la bitacora.
 */

import { z } from 'zod'
import { idSchema } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'

/** Tablas sobre las que se registran eventos. Lista blanca para el filtro. */
export const TABLAS_AUDITADAS = [
  'User',
  'Product',
  'BranchStock',
  'Sale',
  'CashRegisterMovement',
  'CashCount',
  'Branch',
  'Category',
  'Supplier',
  'Authorization',
] as const

export const ACCIONES_AUDITADAS = [
  'create',
  'update',
  'delete',
  'cancel',
  'login',
  'login_failed',
  'logout',
  'deny',
] as const

export const consultarAuditoriaQuerySchema = paginationQuerySchema.extend({
  tabla: z.enum(TABLAS_AUDITADAS).optional(),
  accion: z.enum(ACCIONES_AUDITADAS).optional(),
  usuarioId: idSchema.optional(),
  resultado: z.enum(['todos', 'success', 'failure']).default('todos'),
  /** Rastrea una peticion concreta a partir del codigo que vio el usuario. */
  requestId: z
    .string()
    .trim()
    .regex(/^[a-fA-F0-9-]{8,64}$/, 'Identificador de peticion invalido')
    .optional(),
  desde: z.coerce.date().optional(),
  hasta: z.coerce.date().optional(),
})

export type ConsultarAuditoriaQuery = z.infer<typeof consultarAuditoriaQuerySchema>
