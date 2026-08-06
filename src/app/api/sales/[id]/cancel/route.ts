// src/app/api/sales/[id]/cancel/route.ts
import { z } from 'zod'
import { handler } from '@/server/http/handler'
import { idSchema, shortText } from '@/server/http/validate'
import { cancelSale } from '@/server/services/sales'
import { parseWith } from '@/server/http/validate'

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
const anularSchema = z
  .object({
    reason: shortText(300),
  })
  .strict()

export const POST = handler(
  {
    auth: 'session',
    permission: 'sales.cancel',
    body: anularSchema,
    audit: 'POST /api/sales/:id/cancel',
  },
  async ({ session, body, params }) => {
    const saleId = parseWith(idSchema, params.id)
    return cancelSale(session, saleId, body.reason)
  },
)
