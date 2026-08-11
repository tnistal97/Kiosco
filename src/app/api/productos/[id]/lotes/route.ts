// src/app/api/productos/[id]/lotes/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cambiarPoliticaSchema } from '@/modules/lots/schemas'
import { cambiarPolitica, stockPorLote } from '@/modules/lots/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** El desglose por partida de un producto, con lo que NO esta asignado. */
export const GET = handler(
  { auth: 'session', permission: 'lots.view', audit: 'GET /api/productos/:id/lotes' },
  ({ session, params }) => stockPorLote(session, parseWith(idSchema, params.id)),
)

/**
 * Cambia la politica de rastreo del producto.
 *
 * Las dos banderas juntas: la combinacion tiene que ser valida --un vencimiento
 * sin lote no tiene donde guardarse-- y comprobarla exige verlas a las dos.
 *
 * Exigir lotes con stock sin atribuir devuelve 409: activar la politica dejando
 * unidades sin explicacion convertiria la promesa de `REQUIRED` en una frase que
 * el sistema no cumple desde el primer dia.
 */
export const PUT = handler(
  {
    auth: 'session',
    permission: 'lots.manage',
    body: cambiarPoliticaSchema,
    audit: 'PUT /api/productos/:id/lotes',
  },
  ({ session, params, body }) => cambiarPolitica(session, parseWith(idSchema, params.id), body),
)
