// src/app/api/sales/route.ts
import { handler } from '@/server/http/handler'
import { createSale } from '@/modules/sales/service'
import { NextResponse } from 'next/server'
import { crearVentaSchema } from '@/modules/sales/schemas'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Esquema de entrada de una venta.
 *
 * Notar que `price`, `subtotal`, `total`, `branchId` y `userId` NO existen
 * aca. No es un olvido: al no estar declarados, `.strict()` hace que la
 * peticion se rechace si el navegador los manda. El precio sale del catalogo,
 * la sucursal y el cajero salen de la sesion.
 */

export const POST = handler(
  {
    auth: 'session',
    permission: 'sales.create',
    body: crearVentaSchema,
    audit: 'POST /api/sales',
  },
  async ({ session, body }) => {
    const venta = await createSale(session, body)
    return NextResponse.json(venta, { status: 201 })
  },
)
