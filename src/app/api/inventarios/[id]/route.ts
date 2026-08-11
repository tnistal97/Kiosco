// src/app/api/inventarios/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { obtenerInventario } from '@/modules/inventory-counts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  { auth: 'session', permission: 'inventoryCounts.view', audit: 'GET /api/inventarios/:id' },
  ({ session, params }) => obtenerInventario(session, parseWith(idSchema, params.id)),
)
