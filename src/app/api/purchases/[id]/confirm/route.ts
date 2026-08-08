// src/app/api/purchases/[id]/confirm/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { confirmarOrden } from '@/modules/purchases/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El borrador pasa a ser un pedido.
 *
 * Camino de ida: a partir de aca la orden no se edita, se recibe o se cancela.
 * Por eso exige al menos una linea y comprueba que el proveedor siga activo:
 * entre armar el borrador y confirmarlo pueden pasar dias.
 *
 * Verbo propio y no un `PUT` con `status`: el estado lo decide el servidor
 * siempre, y aceptarlo en el cuerpo abriria la puerta a que el navegador
 * escribiera `RECEIVED` sin que llegue nada.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'purchases.update',
    audit: 'POST /api/purchases/:id/confirm',
  },
  ({ session, params }) => confirmarOrden(session, parseWith(idSchema, params.id)),
)
