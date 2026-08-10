// src/app/api/reports/productos/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeProductos } from '@/modules/reports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Que se vende y que no. Los rankings salen del mismo agregado.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.sales.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/productos',
  },
  ({ session, query }) => reporteDeProductos(session, query),
)
