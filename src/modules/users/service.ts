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
import { conflict, forbidden, invalid, notFound, rateLimited } from '@/server/http/errors'
import { knownRoles } from '@/server/authz/permissions'
import type { Session } from '@/server/auth/session'
import { estaBloqueado, registrarExito, registrarFallo } from '@/server/auth/loginAttempts'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import { generarClaveTemporal, permisosQueFaltan } from './claves'
import type {
  CambiarMiClaveInput,
  CrearUsuarioInput,
  EditarUsuarioInput,
  ListarUsuariosQuery,
  ResetearClaveInput,
} from './schemas'

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
      branchId: session.branchId,
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

/**
 * Modificacion de un usuario del personal.
 *
 * Tres barreras, y las tres importan:
 *
 *  1. Solo usuarios de la misma sucursal. Un administrador no toca el
 *     personal de otro local.
 *  2. Nadie se edita a si mismo por aca. Sin esto, el unico administrador
 *     podria darse de baja o bajarse el rol y dejar el sistema sin nadie que
 *     pueda administrarlo.
 *  3. Dar de baja incrementa `sessionVersion`, con lo que las sesiones
 *     abiertas de esa persona dejan de valer en el acto. Sin eso, quien tiene
 *     la pestania abierta sigue operando hasta que venza el token.
 */
export async function editarUsuario(
  session: Session,
  id: number,
  input: EditarUsuarioInput,
): Promise<UsuarioPublico> {
  if (id === session.userId) {
    throw conflict(
      'No podes modificar tu propio usuario desde esta pantalla. Pediselo a otro administrador.',
    )
  }

  const antes = await prisma.user.findFirst({
    where: { id, branchId: session.branchId },
    select: { ...CAMPOS_PUBLICOS, sessionVersion: true },
  })
  if (!antes) throw notFound('Usuario no encontrado')

  if (input.roleId !== undefined) {
    const rol = await prisma.role.findUnique({ where: { id: input.roleId } })
    if (!rol) throw invalid('El rol indicado no existe')
    if (!knownRoles().includes(rol.name)) {
      throw invalid(
        `El rol "${rol.name}" no tiene permisos definidos. Roles validos: ${knownRoles().join(', ')}`,
      )
    }
  }

  // Dar de baja revoca; volver a habilitar no toca la version.
  const revoca = input.isActive === false && antes.isActive

  return prisma.$transaction(async (tx) => {
    const despues = await tx.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(revoca ? { sessionVersion: { increment: 1 } } : {}),
      },
      select: CAMPOS_PUBLICOS,
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'User',
      recordId: id,
      action: 'update',
      // Ni hash ni sessionVersion: la bitacora guarda que cambio, no como
      // esta hecha la sesion.
      before: {
        name: antes.name,
        rol: antes.role.name,
        isActive: antes.isActive,
      },
      after: {
        name: despues.name,
        rol: despues.role.name,
        isActive: despues.isActive,
        ...(revoca ? { sesionesRevocadas: true } : {}),
      },
      origin: 'PUT /api/users/:id',
    })

    return despues
  })
}

/**
 * Cambio de la contrasena propia.
 *
 * Pide la actual aunque haya sesion: una pestania abierta en el mostrador no
 * alcanza para quedarse con la cuenta. Los intentos fallidos cuentan en el
 * MISMO limite que el login --usuario y origen--, porque adivinar la clave
 * actual por aca es el mismo ataque que adivinarla en la pantalla de ingreso.
 *
 * Incrementa `sessionVersion`: todas las sesiones abiertas de la persona
 * dejan de valer. Devuelve la version nueva para que la ruta vuelva a firmar
 * la cookie de ESTA sesion; si no, cambiar la clave te echaria del equipo en
 * el que la estas cambiando.
 */
export async function cambiarMiClave(
  session: Session,
  input: CambiarMiClaveInput,
  origen: string,
): Promise<{ sessionVersion: number }> {
  if (estaBloqueado(session.username, origen)) {
    throw rateLimited('Demasiados intentos fallidos. Espere 15 minutos.')
  }

  const usuario = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { password: true },
  })
  if (!usuario) throw notFound('Usuario no encontrado')

  const actualOk = await bcrypt.compare(input.claveActual, usuario.password)
  if (!actualOk) {
    registrarFallo(session.username, origen)
    await audit(prisma, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'User',
      recordId: session.userId,
      action: 'password_change',
      result: 'failure',
      reason: 'contraseña actual incorrecta',
      origin: 'POST /api/auth/password',
    })
    // 400 y no 401: la sesion es valida, lo que no es valido es el dato. Un
    // 401 le diria a la interfaz que la sesion vencio.
    throw invalid('La contraseña actual no es correcta', { campo: 'claveActual' })
  }

  const hash = await bcrypt.hash(input.claveNueva, BCRYPT_ROUNDS)

  const actualizado = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: session.userId },
      data: { password: hash, sessionVersion: { increment: 1 } },
      select: { sessionVersion: true },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'User',
      recordId: session.userId,
      action: 'password_change',
      // Ni la clave ni el hash: solo que paso y que efecto tuvo.
      after: { otrasSesionesCerradas: true },
      origin: 'POST /api/auth/password',
    })

    return u
  })

  registrarExito(session.username, origen)
  return { sessionVersion: actualizado.sessionVersion }
}

/** Lo que devuelve el reseteo. La clave, solo si la genero el servidor. */
export interface ClaveReseteada {
  /**
   * La clave temporal generada. Viaja UNA vez, en esta respuesta, y no queda
   * guardada en ningun lado: ni en la base (solo el hash), ni en la bitacora,
   * ni en el log.
   */
  claveTemporal?: string
}

/**
 * Reseteo de la contrasena de otro usuario.
 *
 * Es lo que reemplaza entrar por SSH a correr `scripts/establecer-clave.ts`
 * cuando un empleado se olvida la clave. Cuatro barreras:
 *
 *  1. `users.manage`, en la ruta.
 *  2. La propia no: esa se cambia sabiendo la actual (`cambiarMiClave`).
 *     Sin esto, una sesion robada con `users.manage` cambia la clave del
 *     duenio sin conocerla.
 *  3. Solo personal de la misma sucursal, igual que la edicion.
 *  4. Nadie resetea a alguien que puede hacer cosas que el no puede: seria
 *     entrar como esa persona y heredar sus permisos.
 *
 * Incrementa `sessionVersion`: quien tuviera la sesion abierta queda afuera
 * en el acto, que es justamente lo que se quiere si la clave se filtro.
 */
export async function resetearClave(
  session: Session,
  id: number,
  input: ResetearClaveInput,
): Promise<ClaveReseteada> {
  if (id === session.userId) {
    throw conflict('Tu propia contraseña se cambia desde Configuración, con la actual.')
  }

  const destino = await prisma.user.findFirst({
    where: { id, branchId: session.branchId },
    select: { id: true, username: true, role: { select: { name: true } } },
  })
  if (!destino) throw notFound('Usuario no encontrado')

  const faltan = permisosQueFaltan(session.permissions, destino.role.name)
  if (faltan.length > 0) {
    throw forbidden(
      'No podés resetear la contraseña de alguien que tiene permisos que vos no tenés.',
      { details: { permisos: faltan } },
    )
  }

  const generada = input.claveNueva === undefined
  const clave = input.claveNueva ?? generarClaveTemporal()
  const hash = await bcrypt.hash(clave, BCRYPT_ROUNDS)

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: { password: hash, sessionVersion: { increment: 1 } },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'User',
      recordId: id,
      action: 'password_reset',
      // Quien, a quien y si la genero el sistema. Nunca la clave.
      after: { usuario: destino.username, generada, sesionesCerradas: true },
      origin: 'POST /api/users/:id/password',
    })
  })

  return generada ? { claveTemporal: clave } : {}
}
