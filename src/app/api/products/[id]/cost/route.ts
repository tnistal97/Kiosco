// src/app/api/products/[id]/cost/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cambiarCostoSchema } from '@/modules/products/schemas'
import { cambiarCosto } from '@/modules/products/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cambio de costo, por su propio camino y con su propio permiso.
 *
 * Separado de `PUT /api/products/:id` a proposito: cambiar el precio y cambiar
 * el costo NO comparten autorizacion. Son dos decisiones distintas --una la ve
 * el cliente en la gondola, la otra la negocia quien compra-- y quien puede una
 * no tiene por que poder la otra.
 *
 * Exige motivo siempre y deja una fila en `ProductCostHistory`, que es
 * inmutable: un costo mal cargado se corrige con otro cambio de costo.
 */
export const PUT = handler(
  {
    auth: 'session',
    permission: 'products.cost.update',
    body: cambiarCostoSchema,
    audit: 'PUT /api/products/:id/cost',
  },
  ({ session, body, params }) => cambiarCosto(session, parseWith(idSchema, params.id), body),
)
