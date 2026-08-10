// src/app/api/reports/rentabilidad/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeRentabilidad } from '@/modules/reports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Rentabilidad del rango, calculada con el costo CONGELADO en cada venta.
 *
 * Nunca con `Product.cost`: la ganancia de marzo no cambia porque en abril
 * llego mercaderia mas cara.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.costs.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/rentabilidad',
  },
  ({ session, query }) => reporteDeRentabilidad(session, query),
)
