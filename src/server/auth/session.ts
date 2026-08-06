/**
 * Obtencion de la sesion del servidor.
 *
 * Unico punto del sistema que decide "quien es el que llama". Antes esta
 * logica estaba copiada en nueve archivos con cuatro variantes distintas, y
 * ninguna comprobaba si el usuario seguia existiendo.
 *
 * Toma la peticion como argumento en vez de usar `cookies()` de next/headers
 * a proposito: asi los handlers son funciones puras de Request y se pueden
 * probar sin levantar un servidor.
 */

import { prisma } from '@/lib/prisma'
import { permissionsForRole, type Permission } from '@/server/authz/permissions'
import { readSessionCookie, verifySessionToken } from '@/server/auth/token'

export interface Session {
  userId: number
  name: string
  username: string
  role: string
  branchId: number
  permissions: ReadonlySet<Permission>
}

/**
 * Devuelve la sesion o null. Rechaza cuando:
 *   - no hay cookie
 *   - la firma no valida o el token vencio
 *   - el usuario ya no existe
 *   - el usuario esta dado de baja (isActive = false)
 *   - la sesion fue revocada (sessionVersion no coincide)
 *   - la sucursal del token no coincide con la del usuario en la base
 */
export async function getSession(req: Request): Promise<Session | null> {
  const token = readSessionCookie(req)
  if (!token) return null

  const claims = await verifySessionToken(token)
  if (!claims) return null

  const user = await prisma.user.findUnique({
    where: { id: claims.userId },
    select: {
      id: true,
      name: true,
      username: true,
      branchId: true,
      isActive: true,
      sessionVersion: true,
      role: { select: { name: true } },
    },
  })

  if (!user || !user.isActive) return null
  if (user.sessionVersion !== claims.sv) return null

  // La sucursal se toma SIEMPRE de la base, no del token. Un token viejo de
  // alguien que fue trasladado de sucursal no debe dar acceso a la anterior.
  if (user.branchId !== claims.branchId) return null

  return {
    userId: user.id,
    name: user.name,
    username: user.username,
    role: user.role.name,
    branchId: user.branchId,
    permissions: permissionsForRole(user.role.name),
  }
}
