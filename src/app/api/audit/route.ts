// src/app/api/audit/route.ts
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { paginado, toSkipTake } from '@/server/http/pagination'
import { consultarAuditoriaQuerySchema } from '@/modules/audit/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Bitacora de auditoria de la sucursal.
 *
 * Cambios respecto de la version anterior:
 *
 *  - Exige el permiso audit.view. Antes bastaba con tener sesion, asi que un
 *    cajero podia leer toda la actividad administrativa.
 *  - Pagina. Antes devolvia la tabla entera; con un ano de operacion son
 *    cientos de miles de filas y varios MB por peticion.
 *  - Filtra por tabla, accion, usuario, resultado, fecha y requestId, todos
 *    contra listas blancas.
 *
 * El filtro por sucursal usa la columna `branchId` de la propia entrada, no
 * la del usuario. Son cosas distintas: si a alguien lo trasladan de sucursal,
 * sus movimientos viejos siguieron ocurriendo donde ocurrieron.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'audit.view',
    query: consultarAuditoriaQuerySchema,
    audit: 'GET /api/audit',
  },
  async ({ session, query }) => {
    const where: Prisma.AuditLogWhereInput = {
      // Las entradas anteriores a esta version no tienen branchId; se
      // incluyen mirando la sucursal del usuario, como antes.
      OR: [
        { branchId: session.branchId },
        { branchId: null, user: { branchId: session.branchId } },
      ],
      ...(query.tabla ? { tableName: query.tabla } : {}),
      ...(query.accion ? { actionType: query.accion } : {}),
      ...(query.usuarioId ? { userId: query.usuarioId } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.resultado === 'todos' ? {} : { result: query.resultado }),
      ...(query.desde || query.hasta
        ? {
            timestamp: {
              ...(query.desde ? { gte: query.desde } : {}),
              ...(query.hasta ? { lte: query.hasta } : {}),
            },
          }
        : {}),
    }

    const [total, entradas] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        ...toSkipTake(query),
        select: {
          id: true,
          tableName: true,
          recordId: true,
          actionType: true,
          origin: true,
          timestamp: true,
          changes: true,
          branchId: true,
          requestId: true,
          reason: true,
          result: true,
          // `ip` no se devuelve: es un dato personal y no aporta nada en el
          // listado. Para investigar un incidente concreto se consulta la
          // base directamente.
          user: { select: { id: true, name: true } },
        },
      }),
    ])

    return paginado(entradas, total, query)
  },
)
