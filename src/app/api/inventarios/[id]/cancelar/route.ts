// src/app/api/inventarios/[id]/cancelar/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cancelarInventarioSchema } from '@/modules/inventory-counts/schemas'
import { cancelarInventario } from '@/modules/inventory-counts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Cancela. Una sesion aplicada NO se cancela: ya movio stock. */
export const POST = handler(
  {
    auth: 'session',
    permission: 'inventoryCounts.review',
    body: cancelarInventarioSchema,
    audit: 'POST /api/inventarios/:id/cancelar',
  },
  ({ session, params, body }) => cancelarInventario(session, parseWith(idSchema, params.id), body),
)
