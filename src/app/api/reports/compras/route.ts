// src/app/api/reports/compras/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeCompras } from '@/modules/reports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Compras del rango, medidas por lo que LLEGO. Una orden que nunca se recibio
 * no es una compra.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.purchases.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/compras',
  },
  ({ session, query }) => reporteDeCompras(session, query),
)
