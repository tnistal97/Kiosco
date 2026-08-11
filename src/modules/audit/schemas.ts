/**
 * Validacion de entrada de la consulta de la bitacora.
 */

import { z } from 'zod'
import { fechaLocalSchema, idSchema } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'

/** Tablas sobre las que se registran eventos. Lista blanca para el filtro. */
export const TABLAS_AUDITADAS = [
  'User',
  'Product',
  'BranchStock',
  'StockMovement',
  'Sale',
  'CashRegisterMovement',
  'CashCount',
  'CashShift',
  'Branch',
  'Category',
  'Supplier',
  // Compras. Estaban auditadas desde la Fase 3C pero no figuraban aca, asi que
  // el filtro de la pantalla no las ofrecia: los eventos existian y no habia
  // forma de buscarlos.
  'PurchaseOrder',
  'PurchaseReceipt',
  'PurchaseReceiptItem',
  // Clientes y cuenta corriente. Fase 4A.
  //
  // `CustomerAccountMovement` figura por UN solo caso: el ajuste manual, que
  // es el unico movimiento del libro que no tiene una venta ni un cobro
  // detras. Los otros tres tipos NO se auditan por separado --la venta y el
  // cobro ya se auditan enteros, y emitir una entrada por cada movimiento
  // duplicaria en la bitacora lo que el libro ya guarda mejor--.
  //
  // Cada tabla tiene una responsabilidad distinta: `CustomerAccountMovement`
  // es la HISTORIA FINANCIERA --con sus saldos, su continuidad y su
  // inmutabilidad--; `AuditLog` es QUIEN hizo la accion.
  'Client',
  'CustomerAccountMovement',
  'CustomerPayment',
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
  // Abrir y cerrar un turno no son "crear" y "actualizar": un cierre con
  // diferencia es el evento que despues se busca, y buscarlo como "update de
  // CashShift" no lo distingue de nada.
  'open',
  'close',
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
  /**
   * Dias, no instantes. El servidor los convierte con la zona de la sucursal.
   *
   * Hasta la Fase 3D la pantalla mandaba `2026-08-10T00:00:00.000Z`, o sea
   * medianoche UTC: en Argentina, las 21:00 del dia anterior. La bitacora de
   * un dia empezaba tres horas antes de que ese dia existiera.
   * Ver docs/TIMEZONE_POLICY.md.
   */
  desde: fechaLocalSchema.optional(),
  hasta: fechaLocalSchema.optional(),
})

export type ConsultarAuditoriaQuery = z.infer<typeof consultarAuditoriaQuerySchema>
