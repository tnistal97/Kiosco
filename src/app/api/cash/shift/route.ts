import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { abrirTurnoSchema } from '@/modules/cash/schemas'
import { abrirTurno, politicaDeCaja, turnoActual } from '@/modules/cash/service.turnos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El turno abierto de la sucursal, con su saldo esperado, o `null`.
 *
 * Devuelve tambien la politica: la pantalla necesita saber si hace falta un
 * turno para vender antes de decidir que ofrecer.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'cash.view',
    audit: 'GET /api/cash/shift',
  },
  async ({ session }) => ({
    turno: await turnoActual(session),
    politica: await politicaDeCaja(session),
  }),
)

/**
 * Abre la caja.
 *
 * Una sola por sucursal: lo garantiza un indice unico parcial, no una
 * comprobacion previa. Ver docs/CASH_SHIFT_MODEL.md.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'cash.shift.open',
    body: abrirTurnoSchema,
    audit: 'POST /api/cash/shift',
  },
  async ({ session, body }) =>
    NextResponse.json({ ok: true, turno: await abrirTurno(session, body) }, { status: 201 }),
)
