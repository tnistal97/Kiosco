// src/app/api/roles/route.ts
import { prisma } from '@/lib/prisma'
import { handler } from '@/server/http/handler'
import { knownRoles, permissionsForRole } from '@/server/authz/permissions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Roles disponibles, con los permisos que otorga cada uno.
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
  async () => {
    const roles = await prisma.role.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    return roles.map((rol) => ({
      ...rol,
      permissions: [...permissionsForRole(rol.name)].sort(),
      /** false = el rol existe en la base pero no tiene permisos definidos. */
      configurado: knownRoles().includes(rol.name),
    }))
  },
)
