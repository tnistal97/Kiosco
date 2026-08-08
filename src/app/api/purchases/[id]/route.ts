// src/app/api/purchases/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { editarOrdenSchema } from '@/modules/purchases/schemas'
import { editarOrden, eliminarOrden, obtenerOrden } from '@/modules/purchases/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El detalle: cabecera, lineas y TODAS las recepciones con sus diferencias.
 *
 * Toda la trazabilidad en una pantalla: que se pidio, que llego, cuando, quien
 * lo recibio y a que costo.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'purchases.view',
    audit: 'GET /api/purchases/:id',
  },
  ({ session, params }) => obtenerOrden(session, parseWith(idSchema, params.id)),
)

/** Solo un borrador. Una orden confirmada responde 409 `ORDER_NOT_EDITABLE`. */
export const PUT = handler(
  {
    auth: 'session',
    permission: 'purchases.update',
    body: editarOrdenSchema,
    audit: 'PUT /api/purchases/:id',
  },
  ({ session, body, params }) => editarOrden(session, parseWith(idSchema, params.id), body),
)

/**
 * Borrado fisico. SOLO un borrador.
 *
 * Una orden confirmada se cancela: alguien la mando, y que no haya llegado
 * nada no significa que no haya existido.
 */
export const DELETE = handler(
  {
    auth: 'session',
    permission: 'purchases.update',
    audit: 'DELETE /api/purchases/:id',
  },
  ({ session, params }) => eliminarOrden(session, parseWith(idSchema, params.id)),
)
