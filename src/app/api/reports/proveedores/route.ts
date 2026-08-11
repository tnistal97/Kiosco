// src/app/api/reports/proveedores/route.ts
import { handler } from '@/server/http/handler'
import { rangoQuerySchema } from '@/modules/reports/schemas'
import { reporteDeProveedores } from '@/modules/reports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cuentas por pagar y movimiento con proveedores.
 *
 * Separa a proposito la FOTO de la PELICULA --los saldos son el estado de hoy,
 * lo recibido y lo pagado es lo que ocurrio en el rango-- y separa COMPRADO de
 * PAGADO, que son dos preguntas distintas: cuanta mercaderia entro y cuanta
 * plata salio. Una entrega a 30 dias suma a la primera y no a la segunda.
 *
 * Va bajo `reports.purchases.view` y no bajo un permiso nuevo: es la misma
 * materia que el reporte de compras --lo que se le compra a cada proveedor-- y
 * quien ya podia ver cuanto se compro puede ver cuanto de eso falta pagar.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'reports.purchases.view',
    query: rangoQuerySchema,
    audit: 'GET /api/reports/proveedores',
  },
  ({ session, query }) => reporteDeProveedores(session, query),
)
