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
import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { audit, type DbClient } from '@/server/audit/audit'
import { conflict, forbidden, invalid, notFound, rateLimited } from '@/server/http/errors'
import {
  knownRoles,
  permissionsForRole,
  rolesAdministradores,
  rolesDelAlcance,
} from '@/server/authz/permissions'
import type { Session } from '@/server/auth/session'
import { estaBloqueado, registrarExito, registrarFallo } from '@/server/auth/loginAttempts'
import { paginado, toSkipTake, type Paginated } from '@/server/http/pagination'
import { generarClaveTemporal, permisosQueFaltan } from './claves'
import type {
  CambiarMiClaveInput,
  CrearUsuarioInput,
  EditarUsuarioInput,
  ElegirClaveInput,
  ListarUsuariosQuery,
  ResetearClaveInput,
} from './schemas'

/** Coste de bcrypt. 12 rondas: ~250 ms por hash en el hardware actual. */
const BCRYPT_ROUNDS = 12

/** Los roles son pocos por naturaleza; el tope es para no pedir sin limite. */
const TOPE_DE_ROLES = 500

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
  mustChangePassword: true,
  createdAt: true,
  role: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
} as const

export interface UsuarioPublico {
  id: number
  username: string
  name: string
  isActive: boolean
  /** Sigue con la contrasena que le dieron: todavia no entro a cambiarla. */
  mustChangePassword: boolean
  createdAt: Date
  role: { id: number; name: string }
  branch: { id: number; name: string }
}

/** Una sola a la vez por sucursal: ver `exigirOtroAdministrador`. */
const LLAVE_DE_ADMINISTRADORES = 7302

/** Filtro de Prisma con el alcance de quien administra. */
function alcanceDe(session: Session) {
  const roles = rolesDelAlcance(session.permissions)
  return roles === null ? {} : { role: { name: { in: [...roles] } } }
}

/** El rol pedido existe, tiene permisos definidos y quien actua puede asignarlo. */
async function rolAsignable(
  session: Session,
  roleId: number,
): Promise<{ id: number; name: string }> {
  const rol = await prisma.role.findUnique({ where: { id: roleId } })
  if (!rol) throw invalid('El rol indicado no existe')

  // Un rol sin permisos definidos crearia un usuario que no puede hacer nada
  // y nadie entenderia por que.
  if (!knownRoles().includes(rol.name)) {
    throw invalid(
      `El rol "${rol.name}" no tiene permisos definidos. Roles validos: ${knownRoles().join(', ')}`,
    )
  }

  const alcance = rolesDelAlcance(session.permissions)
  if (alcance !== null && !alcance.includes(rol.name)) {
    throw forbidden('No podés asignar ese rol.')
  }
  return rol
}

async function exigirNombreLibre(
  cliente: DbClient,
  username: string,
  salvo: number | null = null,
): Promise<void> {
  const yaExiste = await cliente.user.findUnique({ where: { username } })
  if (yaExiste && yaExiste.id !== salvo) {
    throw conflict('Ya existe un usuario con ese nombre', { code: 'DUPLICATE_USERNAME' })
  }
}

function administra(rol: string, activo: boolean): boolean {
  return activo && permissionsForRole(rol).has('users.manage')
}

/**
 * Un local no se queda sin administrador.
 *
 * Cuenta solo a quienes quien actua puede ver: para el administrador de un
 * local, las cuentas generales de la sucursal no cuentan, porque no son su
 * reemplazo en el mostrador. El bloqueo es para dos administradores que se
 * quitan el rol a la vez: el segundo espera y ve lo que hizo el primero.
 */
async function exigirOtroAdministrador(
  tx: Prisma.TransactionClient,
  session: Session,
  id: number,
): Promise<void> {
  const alcance = rolesDelAlcance(session.permissions)
  const roles = rolesAdministradores().filter((r) => alcance === null || alcance.includes(r))
  const otros = await tx.user.count({
    where: {
      branchId: session.branchId,
      isActive: true,
      id: { not: id },
      role: { name: { in: roles } },
    },
  })
  if (otros === 0) {
    throw conflict('El local no puede quedarse sin administrador.', { code: 'LAST_ADMIN' })
  }
}

/**
 * Personal de la sucursal, paginado.
 *
 * Un administrador ve el personal de SU sucursal, hasta donde llega su
 * alcance. Ver el de todas sera una funcion aparte cuando exista la pantalla.
 */
export async function listarUsuarios(
  session: Session,
  query: ListarUsuariosQuery,
): Promise<Paginated<UsuarioPublico>> {
  const where = {
    branchId: session.branchId,
    ...alcanceDe(session),
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

/** Roles que quien administra puede asignar, los unicos que ve en el formulario. */
export function listarRolesAsignables(session: Session) {
  return prisma.role.findMany({
    where: alcanceDe(session).role ?? {},
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: TOPE_DE_ROLES,
  })
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
  const rol = await rolAsignable(session, input.roleId)
  await exigirNombreLibre(prisma, input.username)

  const hash = await bcrypt.hash(input.password, BCRYPT_ROUNDS)

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        username: input.username,
        name: input.name,
        password: hash,
        roleId: input.roleId,
        branchId: session.branchId,
        // La eligio quien da el alta: la conocen dos personas. Al entrar por
        // primera vez, el empleado tiene que cambiarla.
        mustChangePassword: true,
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
 * Las barreras, y por que importan:
 *
 *  1. Solo usuarios de la misma sucursal y dentro del alcance de quien actua.
 *     Un administrador no toca el personal de otro local, y el de un local no
 *     toca las cuentas generales de la sucursal.
 *  2. Nadie se desactiva a si mismo, y el local no se queda sin administrador
 *     (`exigirOtroAdministrador`). El propio nombre y usuario si se corrigen.
 *  3. Desactivar incrementa `sessionVersion`, con lo que las sesiones abiertas
 *     de esa persona dejan de valer en el acto. Sin eso, quien tiene la
 *     pestania abierta sigue operando hasta que venza el token.
 *
 * Cada hecho deja su propia entrada en la bitacora: el cambio de datos, el de
 * rol y el de estado se buscan por separado.
 */
export async function editarUsuario(
  session: Session,
  id: number,
  input: EditarUsuarioInput,
): Promise<UsuarioPublico> {
  if (id === session.userId && input.isActive === false) {
    throw conflict('No podés desactivar tu propio usuario.')
  }

  const rolNuevo = input.roleId === undefined ? null : await rolAsignable(session, input.roleId)

  return prisma.$transaction(async (tx) => {
    // Primero el bloqueo y despues la lectura: lo que se lee ya incluye lo que
    // hizo el administrador que iba adelante.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LLAVE_DE_ADMINISTRADORES}::int, ${session.branchId}::int)`

    const antes = await tx.user.findFirst({
      where: { id, branchId: session.branchId, ...alcanceDe(session) },
      select: CAMPOS_PUBLICOS,
    })
    if (!antes) throw notFound('Usuario no encontrado')

    if (input.username !== undefined) await exigirNombreLibre(tx, input.username, id)

    const rolDespues = rolNuevo?.name ?? antes.role.name
    const activoDespues = input.isActive ?? antes.isActive
    if (administra(antes.role.name, antes.isActive) && !administra(rolDespues, activoDespues)) {
      await exigirOtroAdministrador(tx, session, id)
    }

    // Desactivar revoca; volver a activar no toca la version.
    const revoca = antes.isActive && !activoDespues

    const despues = await tx.user.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.username !== undefined ? { username: input.username } : {}),
        ...(input.roleId !== undefined ? { roleId: input.roleId } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(revoca ? { sessionVersion: { increment: 1 } } : {}),
      },
      select: CAMPOS_PUBLICOS,
    })

    const hecho = {
      userId: session.userId,
      branchId: session.branchId,
      table: 'User',
      recordId: id,
      origin: 'PUT /api/users/:id',
    }

    // Ni hash ni sessionVersion: la bitacora guarda que cambio, no como esta
    // hecha la sesion.
    if (antes.name !== despues.name || antes.username !== despues.username) {
      await audit(tx, {
        ...hecho,
        action: 'update',
        before: { name: antes.name, username: antes.username },
        after: { name: despues.name, username: despues.username },
      })
    }
    if (antes.role.name !== despues.role.name) {
      await audit(tx, {
        ...hecho,
        action: 'role_change',
        before: { usuario: despues.username, rol: antes.role.name },
        after: { usuario: despues.username, rol: despues.role.name },
      })
    }
    if (antes.isActive !== despues.isActive) {
      await audit(tx, {
        ...hecho,
        action: despues.isActive ? 'activate' : 'deactivate',
        before: { usuario: despues.username, isActive: antes.isActive },
        after: {
          usuario: despues.username,
          isActive: despues.isActive,
          ...(revoca ? { sesionesRevocadas: true } : {}),
        },
      })
    }

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
      data: { password: hash, sessionVersion: { increment: 1 }, mustChangePassword: false },
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

/**
 * Salir de una contrasena temporal: elegir la propia en la primera pantalla.
 *
 * No pide la actual, y no es un agujero: el reseteo incrementa `sessionVersion`
 * y el alta no deja sesiones, asi que una sesion con `mustChangePassword` nacio
 * necesariamente escribiendo la temporal en el login, hace un momento. Pedirla
 * otra vez no protege nada y es un paso mas para alguien que recien empieza.
 *
 * Por eso mismo solo sirve con una temporal: el resto de las sesiones cambia la
 * clave con `cambiarMiClave`, sabiendo la actual.
 */
export async function elegirClaveDefinitiva(
  session: Session,
  input: ElegirClaveInput,
): Promise<{ sessionVersion: number }> {
  if (!session.mustChangePassword) {
    throw conflict('Tu contraseña se cambia desde Configuración, con la actual.')
  }

  const usuario = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { password: true },
  })
  if (!usuario) throw notFound('Usuario no encontrado')

  if (await bcrypt.compare(input.claveNueva, usuario.password)) {
    throw invalid('Elegí una contraseña distinta de la temporal.', { campo: 'claveNueva' })
  }

  const hash = await bcrypt.hash(input.claveNueva, BCRYPT_ROUNDS)

  return prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: session.userId },
      data: { password: hash, sessionVersion: { increment: 1 }, mustChangePassword: false },
      select: { sessionVersion: true },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'User',
      recordId: session.userId,
      action: 'password_change',
      after: { dejoLaTemporal: true },
      origin: 'POST /api/auth/password/temporal',
    })

    return u
  })
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
 *  3. Solo personal de la misma sucursal y dentro del alcance, igual que la
 *     edicion.
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
    where: { id, branchId: session.branchId, ...alcanceDe(session) },
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
      // Temporal: la conoce quien la reseteo. Hay que cambiarla al entrar.
      data: { password: hash, sessionVersion: { increment: 1 }, mustChangePassword: true },
    })

    await audit(tx, {
      userId: session.userId,
      branchId: session.branchId,
      table: 'User',
      recordId: id,
      action: 'password_reset',
      // Quien, a quien y si la genero el sistema. Nunca la clave.
      after: {
        usuario: destino.username,
        generada,
        sesionesCerradas: true,
        debeCambiarla: true,
      },
      origin: 'POST /api/users/:id/password',
    })
  })

  return generada ? { claveTemporal: clave } : {}
}
