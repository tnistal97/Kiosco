// src/app/api/reports/ventas/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeVentas } from '@/modules/reports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ventas del rango: facturado, operaciones, ticket promedio, anuladas,
 * por cajero y por medio de pago. Ni un costo.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.sales.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/ventas',
  },
  ({ session, query }) => reporteDeVentas(session, query),
)
