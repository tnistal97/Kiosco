/**
 * Convierte a un usuario en el administrador de su local (`admin_local`).
 *
 * Toca UNA cosa de ese usuario: el rol. Ni la contrasena, ni `sessionVersion`
 * (su sesion abierta sigue valiendo y los permisos se leen de la base en cada
 * peticion), ni `mustChangePassword`. Se comprueba adentro de la transaccion:
 * si alguna de las tres cambiara, no se aplica nada.
 *
 * Asegura antes que existan los roles del local, que son filas de `Role`: una
 * instancia vieja no los tiene.
 *
 * Es idempotente: si ya tiene el rol, no hace nada y no deja rastro.
 * `aplicar: false` hace todo, comprueba y deshace.
 */
import type { PrismaClient } from '@prisma/client'
import { audit } from '@/server/audit/audit'
import { ROLES_DE_LOCAL } from '@/server/authz/permissions'
import { normalizeUsername } from '@/modules/users/username'

export const ORIGEN = 'scripts/promover-admin-local'

export interface OpcionesDePromocion {
  usuario: string
  sucursal: number
  autor: number
  /** false: hace todo, comprueba y deshace. */
  aplicar: boolean
}

export interface ResultadoDePromocion {
  usuario: string
  rolAntes: string
  rolDespues: string
  rolesCreados: string[]
  /** Ya tenia el rol: no se hizo nada. */
  yaEstaba: boolean
  aplicado: boolean
}

class Ensayo extends Error {
  constructor(readonly resultado: ResultadoDePromocion) {
    super('ensayo: se deshace')
  }
}

export async function promoverAdminLocal(
  db: PrismaClient,
  opciones: OpcionesDePromocion,
): Promise<ResultadoDePromocion> {
  const username = normalizeUsername(opciones.usuario)
  const select = {
    id: true,
    username: true,
    branchId: true,
    isActive: true,
    password: true,
    sessionVersion: true,
    mustChangePassword: true,
    role: { select: { name: true } },
  }

  try {
    return await db.$transaction(async (tx) => {
      const autor = await tx.user.findFirst({
        where: { id: opciones.autor, isActive: true, role: { name: { in: ['admin', 'duenio'] } } },
        select: { id: true },
      })
      if (!autor)
        throw new Error(`El autor ${String(opciones.autor)} no es un administrador activo`)

      const antes = await tx.user.findUnique({ where: { username }, select })
      if (!antes) throw new Error(`No existe el usuario "${username}"`)
      if (antes.branchId !== opciones.sucursal) {
        throw new Error(`"${username}" no es de la sucursal ${String(opciones.sucursal)}`)
      }
      if (!antes.isActive) throw new Error(`"${username}" está desactivado`)

      const rolesCreados: string[] = []
      for (const name of ROLES_DE_LOCAL) {
        const existe = await tx.role.findUnique({ where: { name } })
        if (existe) continue
        const rol = await tx.role.create({ data: { name } })
        rolesCreados.push(name)
        await audit(tx, {
          userId: autor.id,
          branchId: opciones.sucursal,
          table: 'Role',
          recordId: rol.id,
          action: 'create',
          after: rol,
          origin: ORIGEN,
        })
      }

      const resultado = {
        usuario: antes.username,
        rolAntes: antes.role.name,
        rolDespues: 'admin_local',
        rolesCreados,
        yaEstaba: antes.role.name === 'admin_local',
        aplicado: opciones.aplicar,
      }

      if (!resultado.yaEstaba) {
        const despues = await tx.user.update({
          where: { id: antes.id },
          data: { role: { connect: { name: 'admin_local' } } },
          select,
        })
        if (
          despues.password !== antes.password ||
          despues.sessionVersion !== antes.sessionVersion ||
          despues.mustChangePassword !== antes.mustChangePassword ||
          despues.isActive !== antes.isActive
        ) {
          throw new Error('La promoción tocó algo más que el rol')
        }
        await audit(tx, {
          userId: autor.id,
          branchId: opciones.sucursal,
          table: 'User',
          recordId: antes.id,
          action: 'role_change',
          before: { usuario: antes.username, rol: antes.role.name },
          after: { usuario: antes.username, rol: despues.role.name },
          reason: 'Administrador del local',
          origin: ORIGEN,
        })
      }

      if (!opciones.aplicar) throw new Ensayo(resultado)
      return resultado
    })
  } catch (error) {
    if (error instanceof Ensayo) return error.resultado
    throw error
  }
}
