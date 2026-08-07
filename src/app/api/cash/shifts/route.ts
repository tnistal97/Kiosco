import { handler } from '@/server/http/handler'
import { listarTurnosQuerySchema } from '@/modules/cash/schemas'
import { listarTurnos } from '@/modules/cash/service.turnos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Historial de turnos, paginado.
 *
 * Con `cash.view`, el mismo permiso que ver el saldo: quien puede ver cuanta
 * plata dice que hay puede ver los cierres que lo comprobaron.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'cash.view',
    query: listarTurnosQuerySchema,
    audit: 'GET /api/cash/shifts',
  },
  ({ session, query }) => listarTurnos(session, query),
)
