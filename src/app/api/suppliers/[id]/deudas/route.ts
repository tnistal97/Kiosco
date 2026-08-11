// src/app/api/suppliers/[id]/deudas/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { listarDeudasQuerySchema } from '@/modules/suppliers/schemas.cuenta'
import { listarDeudas } from '@/modules/suppliers/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Las obligaciones abiertas de un proveedor.
 *
 * Por RECEPCION, nunca por orden: una orden con dos entregas son dos
 * obligaciones con dos vencimientos. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.view',
    query: listarDeudasQuerySchema,
    audit: 'GET /api/suppliers/:id/deudas',
  },
  ({ session, query, params }) => listarDeudas(session, parseWith(idSchema, params.id), query),
)
