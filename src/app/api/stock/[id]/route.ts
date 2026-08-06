// src/app/api/stock/[id]/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { ajusteAbsolutoSchema, ajusteRelativoSchema } from '@/modules/stock/schemas'
import { ajustarStock, fijarStock, stockDe } from '@/modules/stock/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Ajustes de inventario de UN producto de la sucursal propia.
 *
 * El id de la URL es el del producto. La sucursal nunca se recibe: sale de la
 * sesion. El endpoint de coleccion `/api/stock`, que aceptaba branchId del
 * cliente sin autenticacion, fue eliminado.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'stock.view',
    audit: 'GET /api/stock/:productId',
  },
  ({ session, params }) => stockDe(session, parseWith(idSchema, params.id)),
)

/** PUT: fija la cantidad exacta (recuento de inventario). */
export const PUT = handler(
  {
    auth: 'session',
    permission: 'stock.adjust',
    body: ajusteAbsolutoSchema,
    audit: 'PUT /api/stock/:productId',
  },
  ({ session, body, params }) => fijarStock(session, parseWith(idSchema, params.id), body),
)

/** PATCH: suma o resta unidades (entrada de mercaderia, rotura, faltante). */
export const PATCH = handler(
  {
    auth: 'session',
    permission: 'stock.adjust',
    body: ajusteRelativoSchema,
    audit: 'PATCH /api/stock/:productId',
  },
  ({ session, body, params }) => ajustarStock(session, parseWith(idSchema, params.id), body),
)
