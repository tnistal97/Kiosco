// src/app/api/reports/inventario/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeInventario } from '@/modules/reports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Estado del inventario. La valorizacion viaja SOLO con `reports.costs.view`;
 * sin ese permiso el campo llega nulo y no oculto en la pantalla.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.inventory.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/inventario',
  },
  ({ session, query }) => reporteDeInventario(session, query),
)
