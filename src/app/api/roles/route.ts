// src/app/api/roles/route.ts
import { handler } from '@/server/http/handler'
import { knownRoles, permissionsForRole } from '@/server/authz/permissions'
import { listarRolesAsignables } from '@/modules/users/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Roles disponibles, con los permisos que otorga cada uno. El administrador de
 * un local recibe solo los que puede asignar.
 *
 * Ya no existe `POST /api/roles`. Crear un rol desde la API no servia de
 * nada: los permisos no viven en la tabla `Role` sino en el catalogo del
 * codigo, asi que un rol nuevo nacia sin poder hacer absolutamente nada, y
 * el endpoint (sin autenticacion) solo servia para ensuciar la tabla.
 *
 * Cuando los permisos pasen a la base en la fase siguiente, este endpoint
 * vuelve con alta y edicion reales.
 */
export const GET = handler(
  {
    auth: 'session',
    permission: 'users.view',
    audit: 'GET /api/roles',
  },
  async ({ session }) => {
    const roles = await listarRolesAsignables(session)

    return roles.map((rol) => ({
      ...rol,
      permissions: [...permissionsForRole(rol.name)].sort(),
      /** false = el rol existe en la base pero no tiene permisos definidos. */
      configurado: knownRoles().includes(rol.name),
    }))
  },
)
