// src/app/api/sales/route.ts
import { z } from 'zod'
import { handler } from '@/server/http/handler'
import { quantitySchema, idSchema, paymentMethodSchema } from '@/server/http/validate'
import { createSale } from '@/server/services/sales'
import { NextResponse } from 'next/server'

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
const crearVentaSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: idSchema,
            quantity: quantitySchema,
          })
          .strict(),
      )
      .min(1, 'La venta no tiene items')
      .max(200, 'Demasiados items en una sola venta'),
    paymentMethod: paymentMethodSchema,
  })
  .strict()

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
