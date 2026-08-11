// src/app/api/devoluciones/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { editarDevolucionSchema } from '@/modules/purchases/schemas.returns'
import { editarDevolucion, obtenerDevolucion } from '@/modules/purchases/service.returns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'purchaseReturns.view',
    audit: 'GET /api/devoluciones/:id',
  },
  ({ session, params }) => obtenerDevolucion(session, parseWith(idSchema, params.id)),
)

/**
 * Reemplaza renglones y motivo de un BORRADOR.
 *
 * Una devolucion confirmada devuelve 409 `RETURN_NOT_EDITABLE`, y aunque no lo
 * hiciera el disparador de la base la rechazaria: movio stock y genero un
 * credito, y corregirla es registrar otra operacion, no editar esta.
 */
export const PATCH = handler(
  {
    auth: 'session',
    permission: 'purchaseReturns.create',
    body: editarDevolucionSchema,
    audit: 'PATCH /api/devoluciones/:id',
  },
  ({ session, body, params }) => editarDevolucion(session, parseWith(idSchema, params.id), body),
)
