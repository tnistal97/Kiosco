// src/app/api/purchases/recepciones/[id]/retornables/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { retornablesDeRecepcion } from '@/modules/purchases/service.returns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Que se puede devolver de una entrega, renglon por renglon.
 *
 * Devuelve LOS DOS TOPES --lo recibido no devuelto y el stock que hay hoy--
 * porque son dos motivos distintos de no poder devolver, y decir solo "no se
 * puede" obliga a quien opera a adivinar cual de los dos es.
 *
 * Tambien el costo original: es lo que el proveedor acredita, y verlo antes de
 * armar la devolucion es la mitad de la decision.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'purchaseReturns.view',
    audit: 'GET /api/purchases/recepciones/:id/retornables',
  },
  ({ session, params }) => retornablesDeRecepcion(session, parseWith(idSchema, params.id)),
)
