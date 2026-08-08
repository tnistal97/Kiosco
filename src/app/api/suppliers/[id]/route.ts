// src/app/api/suppliers/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { editarProveedorSchema, estadoDeProveedorSchema } from '@/modules/suppliers/schemas'
import {
  cambiarEstadoDeProveedor,
  editarProveedor,
  eliminarProveedor,
  obtenerProveedor,
} from '@/modules/suppliers/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'suppliers.view',
    audit: 'GET /api/suppliers/:id',
  },
  ({ session, params }) => obtenerProveedor(session, parseWith(idSchema, params.id)),
)

export const PUT = handler(
  {
    auth: 'session',
    permission: 'suppliers.manage',
    body: editarProveedorSchema,
    audit: 'PUT /api/suppliers/:id',
  },
  ({ session, body, params }) => editarProveedor(session, parseWith(idSchema, params.id), body),
)

/**
 * Activar y desactivar, por su propio verbo.
 *
 * Separado del PUT a proposito: dar de baja a un proveedor tiene una
 * consecuencia --deja de poder elegirse para comprar-- y esconderla dentro de
 * "guardar cambios" haria que ocurra sin querer, con un clic en una casilla
 * que quedo marcada de antes.
 */
export const PATCH = handler(
  {
    auth: 'session',
    permission: 'suppliers.manage',
    body: estadoDeProveedorSchema,
    audit: 'PATCH /api/suppliers/:id',
  },
  ({ session, body, params }) =>
    cambiarEstadoDeProveedor(session, parseWith(idSchema, params.id), body.isActive),
)

/**
 * Borrado fisico. Solo un proveedor sin nada colgando.
 *
 * Con ordenes, productos asociados o cambios de costo responde 409
 * `SUPPLIER_HAS_HISTORY` nombrando que lo retiene. El caso para el que sirve
 * es el unico que queda: alguien tipeo mal el nombre y quiere que desaparezca
 * en vez de convivir con un proveedor dado de baja para siempre.
 */
export const DELETE = handler(
  {
    auth: 'session',
    permission: 'suppliers.manage',
    audit: 'DELETE /api/suppliers/:id',
  },
  ({ session, params }) => eliminarProveedor(session, parseWith(idSchema, params.id)),
)
