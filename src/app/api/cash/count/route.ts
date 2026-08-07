// src/app/api/cash/count/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { arqueoSchema, listarArqueosQuerySchema } from '@/modules/cash/schemas'
import { listarArqueos, registrarArqueo } from '@/modules/cash/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ultimos arqueos de la sucursal.
 *
 * Con `cash.view`, el mismo permiso que ver el saldo: quien puede ver cuanta
 * plata dice que hay puede ver los recuentos que lo comprobaron.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'cash.view',
    query: listarArqueosQuerySchema,
    audit: 'GET /api/cash/count',
  },
  ({ session, query }) => listarArqueos(session, query.limite),
)

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
