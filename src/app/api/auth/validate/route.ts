// src/app/api/auth/validate/route.ts
import { handler } from '@/server/http/handler'
import { prisma } from '@/lib/prisma'
import { hoyEn, zonaDeSucursal } from '@/server/tiempo'

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
 *
 * Devuelve ademas QUE DIA ES HOY EN EL LOCAL. Hasta la Fase 3D eso lo decidia
 * el reloj del dispositivo: una tableta con la fecha mal puesta --o alguien
 * mirando el panel desde otro huso-- pedia "las ventas de hoy" de un dia que
 * no era el del negocio. El navegador ya no decide que dia es; pregunta.
 * Ver docs/TIMEZONE_POLICY.md.
 */
export const POST = handler(
  {
    auth: 'session',
    audit: 'POST /api/auth/validate',
  },
  async ({ session }) => {
    const timeZone = await zonaDeSucursal(prisma, session.branchId)
    return {
      valid: true,
      user: {
        id: session.userId,
        name: session.name,
        username: session.username,
        role: session.role,
        branchId: session.branchId,
        permissions: [...session.permissions].sort(),
      },
      branch: { timeZone, hoy: hoyEn(timeZone) },
    }
  },
)
