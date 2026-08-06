// src/app/api/admin/sales/route.ts
import { handler } from '@/server/http/handler'
import { reporteVentasQuerySchema } from '@/modules/sales/schemas'
import { reporteDeVentas } from '@/modules/sales/service.reporte'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ventas de un rango de fechas, para la pantalla administrativa.
 *
 * Pagina, y devuelve ademas los totales del rango completo. Las ventas
 * anuladas se incluyen con su estado: no desaparecen del historial, pero no
 * suman a la recaudacion.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.view',
    query: reporteVentasQuerySchema,
    audit: 'GET /api/admin/sales',
  },
  ({ session, query }) => reporteDeVentas(session, query),
)
