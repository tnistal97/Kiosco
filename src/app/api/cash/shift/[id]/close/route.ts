import { handler } from '@/server/http/handler'
import { cerrarTurnoSchema } from '@/modules/cash/schemas'
import { cerrarTurno } from '@/modules/cash/service.turnos'
import { idSchema, parseWith } from '@/server/http/validate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cierra la caja.
 *
 * `cash.shift.close` alcanza para cerrar el turno PROPIO. Cerrar el de otro
 * exige ademas `cash.shift.close.other`, y eso se comprueba en el servicio,
 * donde se sabe de quien es el turno.
 *
 * El esperado lo calcula el servidor. El cliente manda lo que conto y, si hay
 * que autorizar una diferencia grande, la confirmacion explicita.
 */
export const POST = handler(
  {
    auth: 'session',
    permission: 'cash.shift.close',
    body: cerrarTurnoSchema,
    audit: 'POST /api/cash/shift/:id/close',
  },
  ({ session, body, params }) => cerrarTurno(session, parseWith(idSchema, params.id), body),
)
