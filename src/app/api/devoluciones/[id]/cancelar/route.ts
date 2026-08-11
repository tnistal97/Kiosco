// src/app/api/devoluciones/[id]/cancelar/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cancelarDevolucionSchema } from '@/modules/purchases/schemas.returns'
import { cancelarDevolucion } from '@/modules/purchases/service.returns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Descarta un borrador. Solo antes de confirmar.
 *
 * Una devolucion confirmada NO se cancela: la mercaderia ya volvio al proveedor
 * y el credito ya esta en su cuenta. Si el proveedor la devuelve, eso es una
 * entrega nueva --con su recepcion, su costo y su cargo-- y no un boton que
 * borra la anterior.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'purchaseReturns.create',
    body: cancelarDevolucionSchema,
    audit: 'POST /api/devoluciones/:id/cancelar',
  },
  ({ session, body, params }) => cancelarDevolucion(session, parseWith(idSchema, params.id), body),
)
