// src/app/api/reports/mermas/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeMermas } from '@/modules/reports/service.lots'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Mermas del periodo, SEPARADAS por causa.
 *
 * La diferencia de inventario aparece con su propio nombre y NO suma al total:
 * un faltante contado puede ser robo, error de carga o una venta mal cobrada, y
 * llamarlo perdida es afirmar una causa que nadie averiguo. Ver el objetivo 50.
 *
 * La valorizacion viaja SOLO con `reports.costs.view`, y va al COSTO ACTUAL: un
 * ajuste de inventario no tiene costo historico guardado, y ponerle el de hoy
 * con nombre de costo historico seria un dato falso con formato de dato real.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.inventory.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/mermas',
  },
  ({ session, query }) => reporteDeMermas(session, query),
)
