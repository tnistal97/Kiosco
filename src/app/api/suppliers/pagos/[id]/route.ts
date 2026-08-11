// src/app/api/suppliers/pagos/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { obtenerComprobanteDePago } from '@/modules/suppliers/service.pagos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Un comprobante de pago, para reimprimirlo.
 *
 * Que sea IDENTICO al original lo garantiza la inmutabilidad de
 * `SupplierPayment` --un disparador en PostgreSQL-- y no una convencion.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.view',
    audit: 'GET /api/suppliers/pagos/:id',
  },
  ({ session, params }) => obtenerComprobanteDePago(session, parseWith(idSchema, params.id)),
)
