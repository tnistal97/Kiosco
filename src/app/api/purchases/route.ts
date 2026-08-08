// src/app/api/purchases/route.ts
import { NextResponse } from 'next/server'
import { handler } from '@/server/http/handler'
import { crearOrdenSchema, listarOrdenesSchema } from '@/modules/purchases/schemas'
import { crearOrden, listarOrdenes } from '@/modules/purchases/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ordenes de compra de la sucursal.
 *
 * `branchId` sale de la sesion, nunca de la query: las compras de una sucursal
 * no se ven desde otra.
 *
 * El importe total NO viaja para quien no tenga `products.cost.view`. Un total
 * de compras es informacion financiera tanto como un costo unitario, y lo
 * decide el servicio en un solo lugar. Ver docs/PURCHASE_FLOW.md.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'purchases.view',
    query: listarOrdenesSchema,
    audit: 'GET /api/purchases',
  },
  ({ session, query }) => listarOrdenes(session, query),
)

/**
 * Crea un BORRADOR. Confirmarlo es otra operacion.
 *
 * Puede nacer vacio: el borrador se arma de a poco, y obligar a cargar la
 * primera linea antes de poder guardar haria perder el trabajo de quien se
 * interrumpe a mitad de camino.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'purchases.create',
    body: crearOrdenSchema,
    audit: 'POST /api/purchases',
  },
  async ({ session, body }) => NextResponse.json(await crearOrden(session, body), { status: 201 }),
)
