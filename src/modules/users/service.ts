/**
 * Reglas de negocio del personal.
 *
 * La regla que gobierna el modulo: nunca sale un hash de aca. Todas las
 * lecturas usan `CAMPOS_PUBLICOS`, que es una lista blanca explicita y no un
 * `include`. La version anterior hacia `findMany({ include: { role, branch } })`,
 * que devuelve TODAS las columnas de User incluida `password`, de modo que un
 * GET sin autenticar entregaba los hashes bcrypt de todo el personal.
 */

import bcrypt from 'bcrypt'
import { prisma } from '@/lib/prisma'
import { audit } from '@/server/audit/audit'
import { conflict, invalid } from '@/server/http/errors'
import { knownRoles } from '@/server/authz/permissions'
import type { Session } from '@/server/auth/session'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import type { CrearUsuarioInput, ListarUsuariosQuery } from './schemas'

/** Coste de bcrypt. 12 rondas: ~250 ms por hash en el hardware actual. */
const BCRYPT_ROUNDS = 12

/**
 * Campos que pueden salir del servidor.
 *
 * `password` no esta, y esa ausencia es la unica defensa: si alguien agrega
 * un `include` en vez de usar esto, el hash vuelve a viajar.
 */
export const CAMPOS_PUBLICOS = {
  id: true,
  username: true,
  name: true,
  isActive: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
} as const

export interface UsuarioPublico {
  id: number
  username: string
  name: string
  isActive: boolean
  createdAt: Date
  role: { id: number; name: string }
  branch: { id: number; name: string }
}

/**
 * Personal de la sucursal, paginado.
 *
 * Un administrador ve el personal de SU sucursal. Ver el de todas sera una
 * funcion aparte cuando exista la pantalla.
 */
export async function listarUsuarios(
  session: Session,
  query: ListarUsuariosQuery,
): Promise<Paginated<UsuarioPublico>> {
  const where = {
    branchId: session.branchId,
    ...(query.estado === 'todos' ? {} : { isActive: query.estado === 'activos' }),
  }

  const [total, usuarios] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: CAMPOS_PUBLICOS,
      orderBy: { name: 'asc' },
      ...toSkipTake(query),
    }),
  ])

  return paginado(usuarios, total, query)
}

/**
 * Alta de usuario.
 *
 * La sucursal la fija el servidor: un administrador da de alta personal en SU
 * sucursal. El esquema no declara `branchId`, asi que mandarlo hace fallar la
 * peticion.
 */
export async function crearUsuario(
  session: Session,
  input: CrearUsuarioInput,
): Promise<UsuarioPublico> {
  const rol = await prisma.role.findUnique({ where: { id: input.roleId } })
  if (!rol) throw invalid('El rol indicado no existe')

  // Un rol sin permisos definidos crearia un usuario que no puede hacer nada
  // y nadie entenderia por que.
  if (!knownRoles().includes(rol.name)) {
    throw invalid(
      `El rol "${rol.name}" no tiene permisos definidos. Roles validos: ${knownRoles().join(', ')}`,
    )
  }

  const yaExiste = await prisma.user.findUnique({ where: { username: input.username } })
  if (yaExiste) {
    throw conflict('Ya existe un usuario con ese nombre', { code: 'DUPLICATE_USERNAME' })
  }

  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: input.username,
        name: input.name,
        password: hash,
        roleId: input.roleId,
        branchId: session.branchId,
      },
      select: CAMPOS_PUBLICOS,
    })

    await audit(tx, {
      userId: session.userId,
      table: 'User',
      recordId: user.id,
      action: 'create',
      // El hash nunca entra en la bitacora.
      after: {
        id: user.id,
        username: user.username,
        name: user.name,
        rol: rol.name,
        branchId: session.branchId,
      },
      origin: 'POST /api/users',
    })

    return user
  })
}
