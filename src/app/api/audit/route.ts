// src/app/api/audit/route.ts
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { paginado, paginationQuerySchema, toSkipTake } from '@/server/http/pagination'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Bitacora de auditoria de la sucursal.
 *
 * Tres cambios respecto de la version anterior:
 *
 *  - Exige el permiso audit.view. Antes bastaba con tener sesion, asi que un
 *    cajero podia leer toda la actividad administrativa.
 *  - Pagina. Antes devolvia la tabla entera; con un ano de operacion son
 *    cientos de miles de filas y varios MB por peticion.
 *  - Recorta el campo `changes`. Los snapshots completos de una venta ocupan
 *    kilobytes cada uno y no aportan nada en el listado; para el detalle
 *    completo se consulta una entrada puntual.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'audit.view',
    query: paginationQuerySchema,
    audit: 'GET /api/audit',
  },
  async ({ session, query }) => {
    const where = { user: { branchId: session.branchId } }

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
          user: { select: { id: true, name: true } },
        },
      }),
    ])

    return paginado(entradas, total, query)
  },
)
