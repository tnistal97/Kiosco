// src/app/api/clients/[id]/ventas/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { paginationQuerySchema } from '@/server/http/pagination'
import { listarVentasDeCliente } from '@/modules/clients/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Las compras de un cliente, paginadas.
 *
 * `sales.view` y no `accounts.view`: es el historial de ventas, filtrado. Cada
 * fila lleva cuanto de esa venta quedo a cuenta, que es el dato que distingue
 * "compro y pago" de "compro y quedo debiendo" sin abrir el ticket.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'sales.view',
    query: paginationQuerySchema,
    audit: 'GET /api/clients/:id/ventas',
  },
  ({ session, query, params }) =>
    listarVentasDeCliente(session, parseWith(idSchema, params.id), query),
)
