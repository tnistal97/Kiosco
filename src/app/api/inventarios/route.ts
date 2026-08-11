// src/app/api/inventarios/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { crearInventarioSchema, listarInventariosSchema } from '@/modules/inventory-counts/schemas'
import { crearInventario, listarInventarios } from '@/modules/inventory-counts/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'inventoryCounts.view',
    query: listarInventariosSchema,
    audit: 'GET /api/inventarios',
  },
  ({ session, query }) => listarInventarios(session, query),
)

/**
 * Arma la sesion y genera sus lineas. NO toca el stock.
 *
 * Entre esto y la aplicacion hay dos estados mas --contando y en revision-- y
 * esa distancia es el punto: contar y corregir no son el mismo acto.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'inventoryCounts.create',
    body: crearInventarioSchema,
    audit: 'POST /api/inventarios',
  },
  async ({ session, body }) =>
    NextResponse.json(await crearInventario(session, body), { status: 201 }),
)
