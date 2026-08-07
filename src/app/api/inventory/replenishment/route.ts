import { handler } from '@/server/http/handler'
import { resumenDeReposicion } from '@/modules/inventory/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cuantos productos hay que reponer. Tres numeros, una sola peticion.
 *
 * El panel de inicio pedia esto con dos consultas al catalogo que traian
 * productos enteros para contarlos. Aca vienen contados, y ademas viene el
 * dato que faltaba: cuantos productos todavia no tienen minimo configurado.
 *
 * Con `stock.view`: es informacion de reposicion, no de control.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'stock.view',
    audit: 'GET /api/inventory/replenishment',
  },
  ({ session }) => resumenDeReposicion(session.branchId),
)
