// src/app/api/suppliers/[id]/pagos/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { pagarProveedorSchema } from '@/modules/suppliers/schemas.cuenta'
import { listarPagosDeProveedor, registrarPagoAProveedor } from '@/modules/suppliers/service.pagos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.view',
    query: paginationQuerySchema,
    audit: 'GET /api/suppliers/:id/pagos',
  },
  ({ query, params }) => listarPagosDeProveedor(parseWith(idSchema, params.id), query),
)

/**
 * Pagarle a un proveedor.
 *
 * Cinco cosas ocurren juntas o no ocurre ninguna: el turno (si sale efectivo),
 * el comprobante, el movimiento del libro, las imputaciones y el egreso de
 * caja. No existe forma de crear un pago sin su movimiento de cuenta.
 *
 * Un pago que dejaria saldo A FAVOR NUESTRO se rechaza con 409
 * `SUPPLIER_PAYMENT_LEAVES_CREDIT` diciendo cuanto sobra, y repetirlo con
 * `acceptCredit` ademas exige el permiso `supplierAccounts.overpay`. Es mas
 * estricto que el sobrepago del cliente a proposito: alla la plata ya esta
 * sobre el mostrador; aca somos nosotros los que entregamos de mas.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'supplierAccounts.payment',
    body: pagarProveedorSchema,
    audit: 'POST /api/suppliers/:id/pagos',
  },
  async ({ session, body, params }) =>
    NextResponse.json(
      await registrarPagoAProveedor(session, parseWith(idSchema, params.id), body),
      { status: 201 },
    ),
)
