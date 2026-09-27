// src/app/api/products/prices/last/route.ts
import { handler } from '@/server/http/handler'
import { ultimoCambioMasivo } from '@/modules/products/precios-masivos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** El ultimo cambio masivo de precios de la sucursal, y si se puede deshacer. */
export const GET = handler(
  {
    auth: 'session',
    permission: 'products.price.update',
    audit: 'GET /api/products/prices/last',
  },
  async ({ session }) => ({ ultimo: await ultimoCambioMasivo(session) }),
)
