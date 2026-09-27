// src/app/api/products/import/route.ts
import { handler } from '@/server/http/handler'
import { importarSchema } from '@/modules/importacion/schemas'
import { importarProductos } from '@/modules/importacion/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Aplica una importacion de productos, todo o nada. Fase P0-B.
 *
 * Vuelve a armar el plan de la vista previa desde cero y lo aplica solo si es
 * el mismo que se mostro (`huella`) y si esa importacion no se aplico ya
 * (`importacion`). Las altas, los costos y el stock pasan por las puertas de
 * siempre. Ver src/modules/importacion/service.ts.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: ['products.create', 'products.update'],
    body: importarSchema,
    audit: 'POST /api/products/import',
  },
  ({ session, body }) => importarProductos(session, body),
)
