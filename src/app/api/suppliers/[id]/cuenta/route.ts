// src/app/api/suppliers/[id]/cuenta/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { listarMovimientosProveedorQuerySchema } from '@/modules/suppliers/schemas.cuenta'
import { listarMovimientosDeProveedor } from '@/modules/suppliers/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El extracto de la cuenta de un proveedor.
 *
 * Siempre paginado: no existe endpoint que devuelva el libro entero.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.view',
    query: listarMovimientosProveedorQuerySchema,
    audit: 'GET /api/suppliers/:id/cuenta',
  },
  ({ session, query, params }) =>
    listarMovimientosDeProveedor(session, parseWith(idSchema, params.id), query),
)
