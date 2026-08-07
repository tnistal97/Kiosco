/**
 * Registro de auditoria.
 *
 * Antes cada ruta armaba su propio `prisma.auditLog.create` con un `origin`
 * distinto y un formato de `changes` distinto, y existia un endpoint publico
 * (`POST /api/logs`) que permitia inventar entradas a nombre de otro usuario.
 * Ese endpoint ya no existe: la auditoria se genera SOLO desde el servidor,
 * por esta funcion, con el userId tomado de la sesion verificada.
 *
 * El requestId y la direccion de origen no se piden como parametro: se leen
 * del contexto de la peticion. Un servicio que ajusta stock no deberia tener
 * que recibirlos solo para reenviarlos.
 */

import type { Prisma, PrismaClient } from '@prisma/client'
import { currentIp, currentRequestId } from '@/server/http/requestContext'

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
  | 'deny'
  // Turnos de caja: abrir y cerrar no son "crear" y "actualizar". Un cierre
  // con diferencia es el evento que despues se busca en la bitacora, y
  // buscarlo como "update de CashShift" no lo distingue de nada.
  | 'open'
  | 'close'

export type AuditResult = 'success' | 'failure'

export interface AuditEntry {
  /** Siempre de la sesion verificada. Nunca del cuerpo de la peticion. */
  userId: number
  /** Sucursal donde ocurrio el hecho. Se copia, no se deduce del usuario. */
  branchId?: number | null
  table: string
  recordId?: number | null
  action: AuditAction
  before?: unknown
  after?: unknown
  /** Motivo declarado, cuando la operacion lo exige. */
  reason?: string | null
  /** Por defecto 'success'. Un intento rechazado tambien se audita. */
  result?: AuditResult
  /** Ruta u operacion que origino el cambio, p. ej. "POST /api/sales". */
  origin: string
}

/**
 * Limite de tamano del snapshot. Sin esto una sola venta con muchos items
 * puede dejar 20 kB de JSON por fila, y la bitacora crece mas rapido que las
 * ventas. Si se pasa, se guarda un resumen en lugar del objeto completo.
 */
const MAX_SNAPSHOT_BYTES = 4_000

/**
 * Claves que nunca se guardan, aunque vengan dentro de un objeto que se
 * pasa entero. Es la ultima red: los servicios ya arman el snapshot a mano,
 * pero alcanza con que alguien pase un `user` completo una vez para que un
 * hash quede escrito en una tabla que casi nadie mira.
 */
const CLAVES_PROHIBIDAS = new Set([
  'password',
  'passwordHash',
  'hash',
  'token',
  'accessToken',
  'refreshToken',
  'secret',
  'jwt',
  'cookie',
  'authorization',
  'sessionVersion',
])

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

/**
 * Normaliza para JSON y borra los campos sensibles.
 *
 * Las fechas y los bigint no son JSON validos por si solos.
 */
function jsonSafeReplacer(key: string, value: unknown): unknown {
  if (CLAVES_PROHIBIDAS.has(key)) return '[oculto]'
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'bigint') return value.toString()
  return value
}

export async function audit(db: DbClient, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.userId,
      branchId: entry.branchId ?? null,
      tableName: entry.table,
      recordId: entry.recordId ?? null,
      actionType: entry.action,
      changes: {
        before: trimSnapshot(entry.before),
        after: trimSnapshot(entry.after),
      },
      reason: entry.reason ?? null,
      result: entry.result ?? 'success',
      requestId: currentRequestId(),
      ip: currentIp(),
      origin: entry.origin,
    },
  })
}
