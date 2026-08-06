// src/app/api/products/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { crearProductoSchema, listarProductosQuerySchema } from '@/modules/products/schemas'
import { crearProducto, listarProductos } from '@/modules/products/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Catalogo de la sucursal, paginado. */
export const GET = handler(
  {
    auth: 'session',
    permission: 'products.view',
    query: listarProductosQuerySchema,
    audit: 'GET /api/products',
  },
  ({ session, query }) => listarProductos(session, query),
)

export const POST = handler(
  {
    auth: 'session',
    permission: 'products.create',
    body: crearProductoSchema,
    audit: 'POST /api/products',
  },
  async ({ session, body }) =>
    NextResponse.json(await crearProducto(session, body), { status: 201 }),
)

/**
 * No existe DELETE en esta ruta.
 *
 * Habia un `DELETE /api/products` que borraba TODOS los productos de la
 * sucursal y todas sus filas de stock, sin comprobar rol y sin confirmacion.
 * Ninguna pantalla lo usaba. Para dar de baja un producto puntual esta
 * `DELETE /api/products/:id`, que exige el permiso products.delete y se niega
 * si el producto participa en alguna venta.
 */
