// src/app/api/inventarios/[id]/revision/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cerrarConteo } from '@/modules/inventory-counts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cierra el conteo: COUNTING pasa a REVIEW.
 *
 * NO toca el stock, y eso es lo que hace util al estado. Entre esto y la
 * aplicacion alguien mira las diferencias, y puede pasar un dia.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'inventoryCounts.review',
    audit: 'POST /api/inventarios/:id/revision',
  },
  ({ session, params }) => cerrarConteo(session, parseWith(idSchema, params.id)),
)
