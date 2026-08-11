// src/app/api/suppliers/[id]/ajuste/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { ajustarProveedorSchema } from '@/modules/suppliers/schemas.cuenta'
import { ajustarCuentaDeProveedor } from '@/modules/suppliers/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ajuste manual de la cuenta de un proveedor.
 *
 * Se declara el DELTA, no el saldo final. Es el camino previsto para cargar la
 * deuda ANTERIOR a esta fase, que la migracion no inventa. Exige motivo y queda
 * auditado. Ver docs/ACCOUNTS_PAYABLE_POLICY.md.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.adjust',
    body: ajustarProveedorSchema,
    audit: 'POST /api/suppliers/:id/ajuste',
  },
  async ({ session, body, params }) =>
    NextResponse.json(
      await ajustarCuentaDeProveedor(session, parseWith(idSchema, params.id), body),
      { status: 201 },
    ),
)
