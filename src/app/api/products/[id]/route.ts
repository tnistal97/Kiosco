// src/app/api/products/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { editarProductoSchema } from '@/modules/products/schemas'
import { editarProducto, eliminarProducto, obtenerProducto } from '@/modules/products/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'products.view',
    audit: 'GET /api/products/:id',
  },
  ({ session, params }) => obtenerProducto(session, parseWith(idSchema, params.id)),
)

export const PUT = handler(
  {
    auth: 'session',
    permission: 'products.update',
    body: editarProductoSchema,
    audit: 'PUT /api/products/:id',
  },
  ({ session, body, params }) => editarProducto(session, parseWith(idSchema, params.id), body),
)

export const DELETE = handler(
  {
    auth: 'session',
    permission: 'products.delete',
    audit: 'DELETE /api/products/:id',
  },
  ({ session, params }) => eliminarProducto(session, parseWith(idSchema, params.id)),
)
