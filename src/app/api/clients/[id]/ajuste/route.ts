// src/app/api/clients/[id]/ajuste/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { ajustarCuentaSchema } from '@/modules/clients/schemas'
import { ajustarCuenta } from '@/modules/clients/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ajuste manual de cuenta. Objetivo 26.
 *
 * `accounts.adjust`, que el cajero NO tiene. Es la separacion que da sentido a
 * todo el modulo: quien cobra no puede bajarle la deuda a nadie sin que se
 * note. Con este permiso se escribe un movimiento que no responde a ninguna
 * venta ni a ningun cobro, y por eso el motivo es obligatorio --lo exige el
 * esquema, el servicio Y una restriccion CHECK en la base--.
 *
 * Se declara el DELTA, no el saldo final. "Sumale 2.000 por deuda anterior a la
 * migracion" deja un movimiento que se entiende dentro de dos anios; "poneme el
 * saldo en 7.000" no dice de donde salieron los 2.000.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'accounts.adjust',
    body: ajustarCuentaSchema,
    audit: 'POST /api/clients/:id/ajuste',
  },
  async ({ session, body, params }) =>
    NextResponse.json(await ajustarCuenta(session, parseWith(idSchema, params.id), body), {
      status: 201,
    }),
)
