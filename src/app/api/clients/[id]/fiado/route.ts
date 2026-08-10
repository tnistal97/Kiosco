// src/app/api/clients/[id]/fiado/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cambiarFiadoSchema } from '@/modules/clients/schemas'
import { cambiarFiado } from '@/modules/clients/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cortar o habilitar el fiado. Objetivo 16.
 *
 * Su propio endpoint y no un campo del PUT, por el mismo motivo que la baja:
 * cortarle el fiado a alguien tiene efecto inmediato --la proxima venta a
 * cuenta se rechaza-- y tiene que ser una decision, no una casilla que quedo
 * marcada de antes.
 *
 * NO da de baja al cliente: sigue comprando de contado. Son dos preguntas
 * distintas y tienen dos columnas distintas.
 */
export const PATCH = handler(
  {
    auth: 'session',
    permission: 'clients.manage',
    body: cambiarFiadoSchema,
    audit: 'PATCH /api/clients/:id/fiado',
  },
  ({ session, body, params }) =>
    cambiarFiado(
      session,
      parseWith(idSchema, params.id),
      body.isCreditEnabled,
      body.reason ?? null,
    ),
)
