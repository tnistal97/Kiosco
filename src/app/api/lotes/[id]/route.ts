// src/app/api/lotes/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { editarLoteSchema } from '@/modules/lots/schemas'
import { editarLote, obtenerLote } from '@/modules/lots/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  { auth: 'session', permission: 'lots.view', audit: 'GET /api/lotes/:id' },
  ({ session, params }) => obtenerLote(session, parseWith(idSchema, params.id)),
)

/**
 * Corrige el vencimiento, la elaboracion o la nota. NUNCA el codigo.
 *
 * La asimetria es deliberada: el codigo es la IDENTIDAD de la partida y hay un
 * disparador en la base que lo congela en cuanto movio mercaderia. La fecha, en
 * cambio, es el error mas facil de cometer y el mas caro de dejar, porque decide
 * si la mercaderia se vende o se tira.
 */
export const PATCH = handler(
  {
    auth: 'session',
    permission: 'lots.manage',
    body: editarLoteSchema,
    audit: 'PATCH /api/lotes/:id',
  },
  ({ session, params, body }) => editarLote(session, parseWith(idSchema, params.id), body),
)
