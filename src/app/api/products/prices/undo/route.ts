// src/app/api/products/prices/undo/route.ts
import { handler } from '@/server/http/handler'
import { deshacerPreciosSchema } from '@/modules/products/schemas'
import { deshacerCambioMasivo } from '@/modules/products/precios-masivos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Deshace el ULTIMO cambio masivo de precios. Fase P0-B.
 *
 * Solo toca los productos que siguen con el precio que les puso ese cambio: si
 * alguien cambio uno despues, se respeta y se informa.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'products.price.update',
    body: deshacerPreciosSchema,
    audit: 'POST /api/products/prices/undo',
  },
  ({ session, body }) => deshacerCambioMasivo(session, body.operacion),
)
