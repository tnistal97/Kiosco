// src/app/api/users/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { crearUsuarioSchema, listarUsuariosQuerySchema } from '@/modules/users/schemas'
import { crearUsuario, listarUsuarios } from '@/modules/users/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'users.view',
    query: listarUsuariosQuerySchema,
    audit: 'GET /api/users',
  },
  ({ session, query }) => listarUsuarios(session, query),
)

export const POST = handler(
  {
    auth: 'session',
    permission: 'users.manage',
    body: crearUsuarioSchema,
    audit: 'POST /api/users',
  },
  async ({ session, body }) =>
    NextResponse.json(await crearUsuario(session, body), { status: 201 }),
)
