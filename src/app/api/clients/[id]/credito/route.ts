// src/app/api/clients/[id]/credito/route.ts
import { z } from 'zod'
import { handler } from '@/server/http/handler'
import { amountSchema, idSchema, parseWith } from '@/server/http/validate'
import { estadoDeCredito } from '@/modules/clients/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const consultaSchema = z.object({ monto: amountSchema }).strict()

/**
 * Que pasaria si se le fiaran `monto` pesos a este cliente. Objetivo 23.
 *
 * Existe para que la pantalla de cobro pueda mostrar los cinco numeros ANTES de
 * confirmar --saldo actual, compra a cuenta, saldo resultante, limite y
 * disponible despues-- en vez de intentar la venta y traducir un 409.
 *
 * Es una PREVISUALIZACION, no una reserva: entre esta consulta y el cobro puede
 * entrar otra venta del mismo cliente en otra caja. La comprobacion que DECIDE
 * sigue estando dentro de la transaccion de la venta, en la misma sentencia que
 * mueve el saldo. Esto es para que la persona entienda; aquello es para que el
 * numero no se rompa.
 *
 * El calculo lo hace el servidor y no la pantalla: son las mismas tres
 * condiciones que aplica el libro, y replicarlas en el navegador garantizaria
 * que algun dia digan cosas distintas.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'accounts.view',
    query: consultaSchema,
    audit: 'GET /api/clients/:id/credito',
  },
  ({ session, query, params }) =>
    estadoDeCredito(session, parseWith(idSchema, params.id), query.monto),
)
