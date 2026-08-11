// src/app/api/suppliers/[id]/anticipos/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { pagosSinImputar } from '@/modules/suppliers/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Los pagos con saldo sin imputar. La lista del objetivo 5.
 *
 * "Anticipos" es el nombre corriente, pero la lista no distingue: un pago que
 * se hizo como anticipo y uno que sobro despues de cubrir todo lo pendiente son
 * la misma cosa --plata entregada sin aplicar-- y se imputan igual.
 *
 * Solo lectura: `supplierAccounts.view` alcanza. Aplicarlos es otra ruta y otro
 * permiso.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.view',
    query: paginationQuerySchema,
    audit: 'GET /api/suppliers/:id/anticipos',
  },
  ({ query, params }) => pagosSinImputar(parseWith(idSchema, params.id), query),
)
