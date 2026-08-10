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
 *
 * El permiso es `sales.view` --el historial de ventas-- y no el de reportes.
 * Hasta la Fase 3D pedia `reports.view`, que el cajero no tiene: la entrada
 * "Ventas" del menu, que si esta gobernada por `sales.view`, lo llevaba a una
 * pantalla que le respondia 403. Un enlace roto para el rol mas comun del
 * local.
 *
 * La RECAUDACION del rango es otra cosa y sigue protegida: sale solo para
 * quien tenga `reports.sales.view`. Ver docs/PERMISSIONS_MATRIX.md.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'sales.view',
    query: reporteVentasQuerySchema,
    audit: 'GET /api/admin/sales',
  },
  ({ session, query }) => reporteDeVentas(session, query),
)
