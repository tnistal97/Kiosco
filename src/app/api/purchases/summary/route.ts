// src/app/api/purchases/summary/route.ts
import { handler } from '@/server/http/handler'
import { resumenDeCompras } from '@/modules/purchases/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cuantas compras esperan mercaderia. Tres numeros, una sola peticion.
 *
 * Para el panel de inicio. `parciales` es el numero accionable: son las
 * ordenes de las que llego una parte y hay que perseguir el resto. Una orden
 * pedida y todavia sin entregar es lo normal; una a medio entregar hace una
 * semana, no.
 *
 * El IMPORTE pendiente solo viaja para quien tenga `products.cost.view`: un
 * total de compras es informacion financiera tanto como un costo unitario, y
 * esconderlo en la ficha para mostrarlo sumado en la portada no seria
 * esconderlo. Lo decide el servicio, en el mismo lugar que el resto.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'purchases.view',
    audit: 'GET /api/purchases/summary',
  },
  ({ session }) => resumenDeCompras(session),
)
