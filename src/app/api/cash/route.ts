// src/app/api/cash/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { listarMovimientosQuerySchema, movimientoManualSchema } from '@/modules/cash/schemas'
import { listarMovimientos, registrarMovimientoManual } from '@/modules/cash/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Movimientos de caja de la sucursal, paginados. */
export const GET = handler(
  {
    auth: 'session',
    permission: 'cash.view',
    query: listarMovimientosQuerySchema,
    audit: 'GET /api/cash',
  },
  ({ session, query }) => listarMovimientos(session, query),
)

/** Movimiento manual de caja: ingreso, retiro o deposito. */
export const POST = handler(
  {
    auth: 'session',
    permission: 'cash.movement.create',
    body: movimientoManualSchema,
    audit: 'POST /api/cash',
  },
  async ({ session, body }) =>
    NextResponse.json(await registrarMovimientoManual(session, body), { status: 201 }),
)
