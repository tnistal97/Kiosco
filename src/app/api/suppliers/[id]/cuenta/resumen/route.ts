// src/app/api/suppliers/[id]/cuenta/resumen/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { resumenDeCuenta } from '@/modules/suppliers/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Saldo, vencido, proximo vencimiento, ultima compra y ultimo pago. */
export const GET = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.view',
    audit: 'GET /api/suppliers/:id/cuenta/resumen',
  },
  ({ session, params }) => resumenDeCuenta(session, parseWith(idSchema, params.id)),
)
