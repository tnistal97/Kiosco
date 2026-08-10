// src/app/api/clients/rapido/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { altaRapidaSchema } from '@/modules/clients/schemas'
import { altaRapidaDeCliente } from '@/modules/clients/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Alta rapida desde el checkout. Nombre, telefono y documento.
 *
 * `clients.manage` NO alcanzaria: el cajero no lo tiene, y el caso que este
 * endpoint existe para resolver es justamente el suyo --el cliente esta
 * enfrente, quiere fiar, y no esta cargado--. Por eso pide `accounts.charge`:
 * quien puede fiar puede dar de alta a quien le fia.
 *
 * Lo que NO puede es ponerle un limite de credito ni notas administrativas: el
 * esquema solo acepta tres campos, y el resto se completa despues desde la
 * ficha, que es donde hay tiempo y donde hace falta `clients.manage`.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'accounts.charge',
    body: altaRapidaSchema,
    audit: 'POST /api/clients/rapido',
  },
  async ({ session, body }) =>
    NextResponse.json(await altaRapidaDeCliente(session, body), { status: 201 }),
)
