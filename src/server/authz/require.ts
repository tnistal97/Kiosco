/**
 * Comprobaciones de autorizacion. Lanzan AppError; no devuelven booleanos,
 * para que sea imposible olvidarse de mirar el resultado.
 */

import { forbidden, unauthenticated } from '@/server/http/errors'
import type { Session } from '@/server/auth/session'
import type { Permission } from '@/server/authz/permissions'

/** Exige sesion valida. */
export function requireUser(session: Session | null): Session {
  if (!session) throw unauthenticated()
  return session
}

/** Exige un permiso concreto. */
export function requirePermission(session: Session | null, permission: Permission): Session {
  const user = requireUser(session)
  if (!user.permissions.has(permission)) {
    throw forbidden(`Falta el permiso "${permission}"`)
  }
  return user
}

/** Exige alguno de varios permisos. */
export function requireAnyPermission(
  session: Session | null,
  permissions: readonly Permission[],
): Session {
  const user = requireUser(session)
  if (!permissions.some((p) => user.permissions.has(p))) {
    throw forbidden(`Falta alguno de los permisos: ${permissions.join(', ')}`)
  }
  return user
}

/**
 * Exige que el recurso pertenezca a la sucursal del usuario.
 *
 * Se llama con el branchId leido de la BASE, no con el que mando el cliente.
 * Ese es el punto: el navegador nunca elige sobre que sucursal opera.
 */
export function requireBranchAccess(session: Session, resourceBranchId: number): void {
  if (session.branchId !== resourceBranchId) {
    // Mismo mensaje y mismo codigo que "no existe", para no confirmar que el
    // recurso existe en otra sucursal.
    throw forbidden('El recurso no pertenece a su sucursal')
  }
}
