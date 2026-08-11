// src/app/api/suppliers/[id]/nota-credito/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { notaDeCreditoSchema } from '@/modules/suppliers/schemas.cuenta'
import { registrarNotaDeCredito } from '@/modules/suppliers/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Nota de credito del proveedor.
 *
 * NO modifica ninguna recepcion historica: escribe un movimiento nuevo,
 * negativo, con su motivo obligatorio y con el numero del documento del
 * proveedor. Permiso propio (`supplierAccounts.credit`) porque baja la deuda
 * SIN que salga plata.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.credit',
    body: notaDeCreditoSchema,
    audit: 'POST /api/suppliers/:id/nota-credito',
  },
  async ({ session, body, params }) =>
    NextResponse.json(await registrarNotaDeCredito(session, parseWith(idSchema, params.id), body), {
      status: 201,
    }),
)
