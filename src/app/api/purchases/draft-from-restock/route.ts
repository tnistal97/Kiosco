// src/app/api/purchases/draft-from-restock/route.ts
import { handler } from '@/server/http/handler'
import { borradorDesdeReposicionSchema } from '@/modules/purchases/schemas'
import { borradorDesdeReposicion } from '@/modules/purchases/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Borradores de compra a partir de productos bajo minimo.
 *
 * Agrupa por proveedor principal y crea un BORRADOR por cada uno: una orden
 * que mezcla productos de dos distribuidoras no se le puede mandar a ninguna.
 *
 * No ordena y no recibe: deja borradores para que una persona los revise.
 * Comprar mercaderia sola es exactamente el tipo de automatismo que termina
 * con veinte cajas de algo que nadie compra.
 *
 * Los productos sin proveedor principal se saltean y se devuelven POR NOMBRE:
 * "3 quedaron afuera" no dice cuales.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'purchases.create',
    body: borradorDesdeReposicionSchema,
    audit: 'POST /api/purchases/draft-from-restock',
  },
  ({ session, body }) => borradorDesdeReposicion(session, body),
)
