// src/app/api/inventarios/[id]/aplicar/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { aplicarInventario } from '@/modules/inventory-counts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Convierte las diferencias en movimientos de stock. TODO O NADA.
 *
 * Se aplica el DELTA, no el numero contado: si despues de contar 7 se vendio una
 * unidad mas, el stock esta en 6 y hay que dejarlo en 6.
 *
 * `inventoryCounts.apply` y no `count`: si contar y aplicar fueran el mismo
 * permiso, cualquiera podria hacer desaparecer mercaderia escribiendo un numero
 * mas chico y aplicandolo.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'inventoryCounts.apply',
    audit: 'POST /api/inventarios/:id/aplicar',
  },
  ({ session, params }) => aplicarInventario(session, parseWith(idSchema, params.id)),
)
