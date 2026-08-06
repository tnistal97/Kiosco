// src/app/api/cash/balance/route.ts
import { handler } from '@/server/http/handler'
import { saldoActual } from '@/modules/cash/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Saldo en efectivo de la sucursal.
 *
 * Se devuelve tambien la suma de los movimientos en efectivo del dia, para
 * que la pantalla pueda mostrar si el saldo acumulado y los movimientos
 * coinciden. `currentCash` es un total corrido desde que se instalo el
 * sistema: no hay turno de caja todavia. Eso llega en la fase 2 con
 * CashSession, y es el cambio que vuelve confiable el arqueo.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'cash.view',
    audit: 'GET /api/cash/balance',
  },
  ({ session }) => saldoActual(session),
)
