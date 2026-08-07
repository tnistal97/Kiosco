import { handler } from '@/server/http/handler'
import { consultarMovimientosQuerySchema } from '@/modules/inventory/schemas'
import { consultarMovimientos } from '@/modules/inventory/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Libro de movimientos de stock de la sucursal propia.
 *
 * Solo lectura, y a proposito: no hay POST, PUT, PATCH ni DELETE. Un
 * movimiento no se crea a mano --lo emite el servicio de inventario como
 * consecuencia de una venta, una anulacion o un ajuste-- y no se edita ni se
 * borra. Hay ademas un disparador en la base que lo impide.
 *
 * Cuelga de `/api/inventory` y no de `/api/stock` para no quedar al lado de
 * `/api/stock/[id]`, donde "movements" seria un segmento estatico compitiendo
 * con uno dinamico. Next lo resuelve bien, pero el que lee el codigo no.
 *
 * Con `inventory.movements.view`, que no es lo mismo que `stock.view`: el
 * cajero necesita saber cuanto hay, no quien lo ajusto.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'inventory.movements.view',
    query: consultarMovimientosQuerySchema,
    audit: 'GET /api/inventory/movements',
  },
  ({ session, query }) => consultarMovimientos(session, query),
)
