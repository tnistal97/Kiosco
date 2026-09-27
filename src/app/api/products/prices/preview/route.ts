// src/app/api/products/prices/preview/route.ts
import { handler } from '@/server/http/handler'
import { vistaDePreciosSchema } from '@/modules/products/schemas'
import { previsualizarPrecios } from '@/modules/products/precios-masivos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Vista previa de un cambio masivo de precios: "precio actual → precio
 * nuevo" de cada producto de la seleccion. No escribe nada. Fase P0-B.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'products.price.update',
    body: vistaDePreciosSchema,
    audit: 'POST /api/products/prices/preview',
  },
  ({ session, body }) => previsualizarPrecios(session, body),
)
