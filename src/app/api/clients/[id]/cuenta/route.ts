// src/app/api/clients/[id]/cuenta/route.ts
import { handler } from '@/server/http/handler'
import { idSchema, parseWith } from '@/server/http/validate'
import { listarMovimientosCuentaQuerySchema } from '@/modules/clients/schemas'
import { listarMovimientosDeCuenta } from '@/modules/clients/service.cuenta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * El extracto de la cuenta corriente, paginado.
 *
 * `accounts.view` y no `clients.view`: el saldo de una persona es informacion
 * suya, y hay roles --el repositor, compras-- que necesitan el catalogo pero no
 * la cartera de deudores.
 *
 * Cada fila lleva su saldo anterior y su saldo resultante, guardados en el
 * momento del movimiento. Es lo que permite mostrarle a alguien por que debe lo
 * que debe sin tener que recorrer todo su historial hacia atras.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'accounts.view',
    query: listarMovimientosCuentaQuerySchema,
    audit: 'GET /api/clients/:id/cuenta',
  },
  ({ session, query, params }) =>
    listarMovimientosDeCuenta(session, parseWith(idSchema, params.id), query),
)
