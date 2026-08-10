// src/app/api/clients/[id]/pagos/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { registrarPagoSchema } from '@/modules/clients/schemas'
import { listarPagosDeCliente, registrarPago } from '@/modules/clients/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'accounts.view',
    query: paginationQuerySchema,
    audit: 'GET /api/clients/:id/pagos',
  },
  ({ session, query, params }) =>
    listarPagosDeCliente(session, parseWith(idSchema, params.id), query),
)

/**
 * Cobrar lo que el cliente debe.
 *
 * Tres cosas ocurren juntas o no ocurren: el comprobante, el movimiento del
 * libro y --solo si se cobro en efectivo-- el movimiento de caja. No existe
 * forma de crear un pago sin su movimiento de cuenta.
 *
 * Un cobro que dejaria saldo A FAVOR se rechaza con 409 `PAYMENT_LEAVES_CREDIT`
 * diciendo cuanto sobra. No es que el sobrepago este prohibido --pasa, el
 * cliente redondea para arriba-- sino que no puede ocurrir en silencio: se
 * repite con `aceptarSaldoAFavor` y queda constancia de que alguien lo vio.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'accounts.payment',
    body: registrarPagoSchema,
    audit: 'POST /api/clients/:id/pagos',
  },
  async ({ session, body, params }) =>
    NextResponse.json(await registrarPago(session, parseWith(idSchema, params.id), body), {
      status: 201,
    }),
)
