// src/app/api/suppliers/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { crearProveedorSchema, listarProveedoresSchema } from '@/modules/suppliers/schemas'
import { crearProveedor, listarProveedores } from '@/modules/suppliers/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Proveedores.
 *
 * Paginado desde la Fase 3C. Antes devolvia hasta 500 filas de una: con un
 * catalogo chico funciona, y el dia que no lo sea la pantalla intenta traerlos
 * todos. El contrato es el mismo `{ data, pagination }` que el resto.
 *
 * Los proveedores NO son de una sucursal --son del negocio-- asi que esta
 * consulta no filtra por `branchId`, a diferencia de casi todas las demas. Lo
 * que si es por sucursal es lo que se les compra.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'suppliers.view',
    query: listarProveedoresSchema,
    audit: 'GET /api/suppliers',
  },
  ({ query }) => listarProveedores(query),
)

export const POST = handler(
  {
    auth: 'session',
    permission: 'suppliers.manage',
    body: crearProveedorSchema,
    audit: 'POST /api/suppliers',
  },
  async ({ session, body }) =>
    NextResponse.json(await crearProveedor(session, body), { status: 201 }),
)
