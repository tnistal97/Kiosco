/**
 * Registro de auditoria.
 *
 * Antes cada ruta armaba su propio `prisma.auditLog.create` con un `origin`
 * distinto y un formato de `changes` distinto, y existia un endpoint publico
 * (`POST /api/logs`) que permitia inventar entradas a nombre de otro usuario.
 * Ese endpoint ya no existe: la auditoria se genera SOLO desde el servidor,
 * por esta funcion, con el userId tomado de la sesion verificada.
 */

import type { Prisma, PrismaClient } from '@prisma/client'

/** Acepta el cliente normal o el de una transaccion. */
export type DbClient = PrismaClient | Prisma.TransactionClient

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'cancel'
  | 'login'
  | 'login_failed'
  | 'logout'

export interface AuditEntry {
  /** Siempre de la sesion verificada. Nunca del cuerpo de la peticion. */
  userId: number
  table: string
  recordId?: number | null
  action: AuditAction
  before?: unknown
  after?: unknown
  /** Ruta u operacion que origino el cambio, p. ej. "POST /api/sales". */
  origin: string
}

/**
 * Limite de tamano del snapshot. Sin esto una sola venta con muchos items
 * puede dejar 20 kB de JSON por fila, y la bitacora crece mas rapido que las
 * ventas. Si se pasa, se guarda un resumen en lugar del objeto completo.
 */
const MAX_SNAPSHOT_BYTES = 4_000

function trimSnapshot(value: unknown): Prisma.InputJsonValue | null {
  if (value === undefined || value === null) return null

  const json = JSON.parse(JSON.stringify(value, jsonSafeReplacer)) as Prisma.InputJsonValue
  const size = JSON.stringify(json).length
  if (size <= MAX_SNAPSHOT_BYTES) return json

  return {
    _truncated: true,
    _originalBytes: size,
    _preview: JSON.stringify(json).slice(0, 500),
  }
}

/** Las fechas y los Decimal de Prisma no son JSON validos por si solos. */
function jsonSafeReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  return value
}

export async function audit(db: DbClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId,
      tableName: entry.table,
      recordId: entry.recordId ?? null,
      actionType: entry.action,
      changes: {
        before: trimSnapshot(entry.before),
        after: trimSnapshot(entry.after),
      },
      origin: entry.origin,
    },
  })
}
