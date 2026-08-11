// src/app/api/inventarios/[id]/lineas/[lineId]/resolver/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { resolverLineaSchema } from '@/modules/inventory-counts/schemas'
import { resolverLinea } from '@/modules/inventory-counts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Dice de que partida son las unidades que aparecieron sin identificar.
 *
 * Es el objetivo 31: las unidades ESTAN --alguien las conto con la mano-- y lo
 * que falta es decir de que partida. NO se inventa un codigo: hasta que alguien
 * conteste, la sesion no se puede aplicar.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'inventoryCounts.count',
    body: resolverLineaSchema,
    audit: 'POST /api/inventarios/:id/lineas/:lineId/resolver',
  },
  ({ session, params, body }) =>
    resolverLinea(
      session,
      parseWith(idSchema, params.id),
      parseWith(idSchema, params.lineId),
      body,
    ),
)
