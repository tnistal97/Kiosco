// src/app/api/devoluciones/[id]/confirmar/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { confirmarDevolucion } from '@/modules/purchases/service.returns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Confirma la devolucion: SACA la mercaderia y emite el credito.
 *
 * UNA transaccion y todo o nada. Los dos topes se hacen cumplir aca y no antes:
 *
 *   · lo recibido no devuelto, bajo bloqueo de las lineas de la recepcion;
 *   · el stock que hay hoy, por la condicion de `applyStockMovement`.
 *
 * El segundo es el del objetivo 13: entraron 10, se vendieron 8, quedan 2, y
 * devolver 5 se rechaza con 409 `INSUFFICIENT_STOCK` aunque historicamente
 * hayan entrado 10.
 *
 * Es un camino de ida: despues de esto la devolucion es inmutable.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'purchaseReturns.confirm',
    audit: 'POST /api/devoluciones/:id/confirmar',
  },
  ({ session, params }) => confirmarDevolucion(session, parseWith(idSchema, params.id)),
)
