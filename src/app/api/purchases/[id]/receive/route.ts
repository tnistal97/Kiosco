// src/app/api/purchases/[id]/receive/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { recibirSchema } from '@/modules/purchases/schemas'
import { recibirMercaderia } from '@/modules/purchases/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recibir mercaderia. LA operacion del modulo.
 *
 * Una transaccion y quince pasos: crea la recepcion, suma lo recibido sin
 * pasarse de lo pedido, mueve el stock por el libro, actualiza el costo, deja
 * historial y recalcula el estado. Si falla el septimo producto de diez, no
 * queda recibido ninguno.
 *
 * Recibir a un costo DISTINTO del pedido exige ademas `products.cost.update`.
 * No hay un `purchases.cost.override`: quien tiene `products.cost.update`
 * puede cambiar el costo desde la ficha de todos modos, asi que un tercer
 * permiso que solo sirve acompanado del segundo no impide nada.
 *
 * Ver docs/PURCHASE_RECEIVING.md.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'purchases.receive',
    body: recibirSchema,
    audit: 'POST /api/purchases/:id/receive',
  },
  ({ session, body, params }) => recibirMercaderia(session, parseWith(idSchema, params.id), body),
)
