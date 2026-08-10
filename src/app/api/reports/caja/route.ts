// src/app/api/reports/caja/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeCaja } from '@/modules/reports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Turnos del rango y sus diferencias. Sobrantes y faltantes por separado: un
 * turno que sobro y otro que falto no son un cero.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.cash.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/caja',
  },
  ({ session, query }) => reporteDeCaja(session, query),
)
