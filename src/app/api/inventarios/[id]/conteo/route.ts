// src/app/api/inventarios/[id]/conteo/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cargarConteoSchema } from '@/modules/inventory-counts/schemas'
import { cargarConteo } from '@/modules/inventory-counts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Carga conteos. Solo viaja LO CONTADO.
 *
 * Lo esperado lo lee el servidor EN ESTE INSTANTE, que es lo que permite contar
 * sin cerrar el local: si la sesion empezo con 10, se vendieron 2 y el operario
 * conto 8, la diferencia es cero. Ver docs/INVENTORY_COUNT_CONCURRENCY.md.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'inventoryCounts.count',
    body: cargarConteoSchema,
    audit: 'POST /api/inventarios/:id/conteo',
  },
  ({ session, params, body }) => cargarConteo(session, parseWith(idSchema, params.id), body),
)
