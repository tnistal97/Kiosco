// src/app/api/auth/validate/route.ts
import { handler } from '@/server/http/handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Datos de la sesion actual, para que la interfaz sepa a quien tiene delante
 * y que puede mostrarle.
 *
 * Devuelve la lista de permisos, no solo el nombre del rol: asi la navegacion
 * puede ocultar lo que el usuario no puede usar sin duplicar la tabla de
 * permisos en el cliente. Ocultar en el cliente es comodidad; la decision
 * real la sigue tomando cada endpoint.
 */
export const POST = handler(
  {
    auth: 'session',
    audit: 'POST /api/auth/validate',
  },
  // Sin await: toda la informacion ya viene de la sesion, que `handler` valido
  // contra la base antes de llegar aca.
  // eslint-disable-next-line @typescript-eslint/require-await -- la firma de handler() exige una promesa
  async ({ session }) => ({
    valid: true,
    user: {
      id: session.userId,
      name: session.name,
      username: session.username,
      role: session.role,
      branchId: session.branchId,
      permissions: [...session.permissions].sort(),
    },
  }),
)
