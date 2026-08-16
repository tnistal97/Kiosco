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

/**
 * El texto que lee quien se topa con un permiso que no tiene.
 *
 * Fase 5A.2, del recorrido con el navegador: la pantalla decia `Falta el
 * permiso "inventoryCounts.view"`. Es exacto y no le sirve a nadie parado en el
 * mostrador: nombra un identificador interno y no dice que hacer. El nombre del
 * permiso sigue viajando --en `details`, que es donde lo busca quien da
 * soporte-- y la frase pasa a decir el paso siguiente.
 */
export const SIN_PERMISO = 'No tenés permiso para hacer esto. Pedíselo a un encargado.'

/** Exige un permiso concreto. */
export function requirePermission(session: Session | null, permission: Permission): Session {
  const user = requireUser(session)
  if (!user.permissions.has(permission)) {
    throw forbidden(SIN_PERMISO, { details: { permiso: permission } })
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
    throw forbidden(SIN_PERMISO, { details: { permisos: [...permissions] } })
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
