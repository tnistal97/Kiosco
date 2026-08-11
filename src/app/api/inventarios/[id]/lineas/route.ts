// src/app/api/inventarios/[id]/lineas/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { lineasQuerySchema } from '@/modules/inventory-counts/schemas'
import { lineasDeInventario } from '@/modules/inventory-counts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Las lineas, paginadas y filtrables.
 *
 * Con conteo a ciegas y la sesion todavia contando, lo ESPERADO y la DIFERENCIA
 * no salen de aca. No es cosmetica: es la funcionalidad. Ver el objetivo 26.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'inventoryCounts.view',
    query: lineasQuerySchema,
    audit: 'GET /api/inventarios/:id/lineas',
  },
  ({ session, params, query }) =>
    lineasDeInventario(session, parseWith(idSchema, params.id), query),
)
