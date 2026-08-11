// src/app/api/lotes/atribuir/route.ts
import { handler } from '@/server/http/handler'
import { atribuirStockSchema } from '@/modules/lots/schemas'
import { atribuirStock } from '@/modules/lots/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Atribuye stock EXISTENTE a partidas. NO mueve stock.
 *
 * Es el paso que hace posible activar `REQUIRED` sobre un producto que ya tiene
 * unidades: habia 20 y siguen habiendo 20, lo que cambia es de que partida son.
 * Ver docs/LOT_TRACKING_DESIGN.md.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'lots.manage',
    body: atribuirStockSchema,
    audit: 'POST /api/lotes/atribuir',
  },
  ({ session, body }) => atribuirStock(session, body),
)
