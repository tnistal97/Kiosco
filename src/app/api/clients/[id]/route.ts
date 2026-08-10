// src/app/api/clients/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { cambiarEstadoClienteSchema, editarClienteSchema } from '@/modules/clients/schemas'
import {
  cambiarEstadoDeCliente,
  editarCliente,
  eliminarCliente,
  obtenerCliente,
} from '@/modules/clients/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'clients.view',
    audit: 'GET /api/clients/:id',
  },
  ({ session, params }) => obtenerCliente(session, parseWith(idSchema, params.id)),
)

export const PUT = handler(
  {
    auth: 'session',
    permission: 'clients.manage',
    body: editarClienteSchema,
    audit: 'PUT /api/clients/:id',
  },
  ({ session, body, params }) => editarCliente(session, parseWith(idSchema, params.id), body),
)

/**
 * Alta y baja, por su propio verbo.
 *
 * Separado del PUT por lo mismo que en proveedores: dar de baja tiene una
 * consecuencia --deja de poder elegirse en una venta-- y esconderla dentro de
 * "guardar cambios" haria que ocurra sin querer.
 */
export const PATCH = handler(
  {
    auth: 'session',
    permission: 'clients.manage',
    body: cambiarEstadoClienteSchema,
    audit: 'PATCH /api/clients/:id',
  },
  ({ session, body, params }) =>
    cambiarEstadoDeCliente(session, parseWith(idSchema, params.id), body.isActive),
)

/**
 * Borrado fisico. Solo un cliente sin nada colgando.
 *
 * Con ventas, movimientos de cuenta o pagos responde 409 `CLIENT_HAS_HISTORY`
 * nombrando que lo retiene. El caso para el que sirve es el del alta rapida:
 * alguien tipeo mal un nombre en medio de una venta y quiere que desaparezca.
 */
export const DELETE = handler(
  {
    auth: 'session',
    permission: 'clients.manage',
    audit: 'DELETE /api/clients/:id',
  },
  ({ session, params }) => eliminarCliente(session, parseWith(idSchema, params.id)),
)
