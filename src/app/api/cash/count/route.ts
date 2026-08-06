// src/app/api/cash/count/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { arqueoSchema } from '@/modules/cash/schemas'
import { registrarArqueo } from '@/modules/cash/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Arqueo de caja: cuanto dinero hay fisicamente en el cajon.
 *
 * Se guarda ademas el saldo que el sistema esperaba y la diferencia. Antes se
 * registraba solo el importe contado y nadie lo comparaba con nada, asi que
 * un faltante no se detectaba nunca.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'cash.count.create',
    body: arqueoSchema,
    audit: 'POST /api/cash/count',
  },
  async ({ session, body }) =>
    NextResponse.json(
      { ok: true, cashCount: await registrarArqueo(session, body) },
      { status: 201 },
    ),
)
