// src/app/api/reports/inventarios/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeInventarios } from '@/modules/reports/service.lots'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Las sesiones de inventario del periodo y lo que encontro cada una.
 *
 * Las diferencias positivas y negativas van SEPARADAS: un inventario que
 * encontro 20 de mas y 20 de menos no encontro cero, y netearlas borraria
 * exactamente lo que hace util al reporte.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.inventory.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/inventarios',
  },
  ({ session, query }) => reporteDeInventarios(session, query),
)
