// src/app/api/sales/[id]/cancel/route.ts
import { handler } from '@/server/http/handler'
import { idSchema } from '@/server/http/validate'
import { cancelSale } from '@/server/services/sales'
import { parseWith } from '@/server/http/validate'
import { anularVentaSchema } from '@/modules/sales/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Anulacion de una venta.
 *
 * Reemplaza a `DELETE /api/sales/:id`, que ademas de estar entero comentado
 * (devolvia 405) borraba fisicamente la venta, sus items y el movimiento de
 * caja. Es POST y no DELETE a proposito: no se borra nada, se registra un
 * hecho nuevo.
 */

export const POST = handler(
  {
    auth: 'session',
    permission: 'sales.cancel',
    body: anularVentaSchema,
    audit: 'POST /api/sales/:id/cancel',
  },
  async ({ session, body, params }) => {
    const saleId = parseWith(idSchema, params.id)
    return cancelSale(session, saleId, body.reason)
  },
)
