// src/app/api/suppliers/[id]/devoluciones/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { devolucionesDeProveedor } from '@/modules/purchases/service.returns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Lo que se le devolvio a un proveedor. La seccion del objetivo 21.
 *
 * Exige `purchaseReturns.view` y no `supplierAccounts.view`: es informacion de
 * mercaderia, no de cuenta corriente. Quien puede ver lo que se le debe a un
 * proveedor no necesariamente tiene por que ver que le devolvimos, y al reves
 * tampoco.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'purchaseReturns.view',
    query: paginationQuerySchema,
    audit: 'GET /api/suppliers/:id/devoluciones',
  },
  ({ query, params }) => devolucionesDeProveedor(parseWith(idSchema, params.id), query),
)
