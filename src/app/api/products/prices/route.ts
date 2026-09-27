// src/app/api/products/prices/route.ts
import { handler } from '@/server/http/handler'
import { aplicarPreciosSchema } from '@/modules/products/schemas'
import { aplicarPrecios } from '@/modules/products/precios-masivos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Aplica un cambio masivo de precios, todo junto o nada. Fase P0-B.
 *
 * Recalcula con las filas bloqueadas y se niega si el resultado no es el de la
 * vista previa (`huella`). Cada producto deja su entrada en la bitacora, que es
 * el historial de precios de la ficha. Ver src/modules/products/precios-masivos.ts.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'products.price.update',
    body: aplicarPreciosSchema,
    audit: 'POST /api/products/prices',
  },
  ({ session, body }) => aplicarPrecios(session, body),
)
