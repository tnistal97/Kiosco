// src/app/api/devoluciones/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import {
  crearDevolucionSchema,
  listarDevolucionesSchema,
} from '@/modules/purchases/schemas.returns'
import { crearDevolucion, listarDevoluciones } from '@/modules/purchases/service.returns'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'purchaseReturns.view',
    query: listarDevolucionesSchema,
    audit: 'GET /api/devoluciones',
  },
  ({ session, query }) => listarDevoluciones(session, query),
)

/**
 * Crea una devolucion EN BORRADOR.
 *
 * No mueve stock ni saldo: eso ocurre al confirmar. Lo que hace es congelar el
 * costo de cada renglon --el de la recepcion original, nunca el de hoy-- y dejar
 * el papel armado para que alguien lo revise antes de que la mercaderia salga.
 *
 * `purchaseReturns.create` y no `confirm`: son dos mitades que no siempre hace
 * la misma persona.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'purchaseReturns.create',
    body: crearDevolucionSchema,
    audit: 'POST /api/devoluciones',
  },
  async ({ session, body }) =>
    NextResponse.json(await crearDevolucion(session, body), { status: 201 }),
)
