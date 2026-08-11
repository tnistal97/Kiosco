// src/app/api/lotes/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { crearLoteSchema, listarLotesQuerySchema } from '@/modules/lots/schemas'
import { crearLote, listarLotes } from '@/modules/lots/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'lots.view',
    query: listarLotesQuerySchema,
    audit: 'GET /api/lotes',
  },
  ({ session, query }) => listarLotes(session, query),
)

/**
 * Da de alta una partida.
 *
 * `lots.manage`: crear una partida es administrar el catalogo de lotes, y es lo
 * mismo que hace quien recibe mercaderia de un producto que los exige.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'lots.manage',
    body: crearLoteSchema,
    audit: 'POST /api/lotes',
  },
  async ({ session, body }) => NextResponse.json(await crearLote(session, body), { status: 201 }),
)
