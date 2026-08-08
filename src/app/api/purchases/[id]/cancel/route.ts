// src/app/api/purchases/[id]/cancel/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cancelarOrdenSchema } from '@/modules/purchases/schemas'
import { cancelarOrden } from '@/modules/purchases/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cancelar. Exige motivo.
 *
 * Una orden parcialmente recibida SI se puede cancelar: significa "el resto no
 * va a llegar", no "esto nunca paso". Lo ya recibido no se revierte --la
 * mercaderia esta en el deposito-- y las recepciones, el stock, los costos y
 * el historial quedan intactos.
 *
 * Su propio permiso: cancelar una compra confirmada no es editarla.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'purchases.cancel',
    body: cancelarOrdenSchema,
    audit: 'POST /api/purchases/:id/cancel',
  },
  ({ session, body, params }) => cancelarOrden(session, parseWith(idSchema, params.id), body),
)
