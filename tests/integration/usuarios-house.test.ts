/**
 * Usuarios de un local, del lado del servidor.
 *
 * El escenario es el de House: Franco administra el local (`admin_local`) y da
 * de alta a sus empleados. Lo que tiene que valer siempre:
 *
 *   - "Franco", "franco" y " FRANCO " son la misma persona, tambien en la base;
 *   - una contrasena temporal no sirve para nada mas que para cambiarla;
 *   - restablecer y desactivar cierran las sesiones abiertas;
 *   - el administrador de un local no ve ni toca nada fuera de su local;
 *   - el local no se queda sin administrador.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import bcrypt from 'bcrypt'
import { seedFixture, prisma, type Fixture, type TestUser } from '../helpers/db'
import { call, errorDe, sessionCookie, type CallResult } from '../helpers/http'
import { getSession } from '@/server/auth/session'
import { __resetLoginAttempts } from '@/server/auth/loginAttempts'
import { permissionsForRole } from '@/server/authz/permissions'
import { navegacionPara } from '@/components/shell/navigation'

let fx: Fixture
let franco: TestUser

const TEMPORAL = 'temporal1'
const PROPIA = 'mi-clave-propia'

beforeEach(async () => {
  __resetLoginAttempts()
  fx = await seedFixture()
  const base = fx.porRol.admin_local
  if (!base) throw new Error('La fixture no trae un admin_local')
  await prisma.user.update({ where: { id: base.id }, data: { username: 'franco' } })
  franco = { ...base, username: 'franco' }
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function login(username: string, password: string) {
  const { POST } = await import('@/app/api/auth/login/route')
  return call(POST, '/api/auth/login', { method: 'POST', body: { username, password } })
}

function cookieNueva(res: CallResult): string {
  const token = /(?:^|,\s*)token=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
  return token ? `token=${token}` : ''
}

async function usuarioDeLaCookie(cookie: string): Promise<number | null> {
  const sesion = await getSession(new Request('http://localhost/', { headers: { cookie } }))
  return sesion?.userId ?? null
}

async function rolId(name: string): Promise<number> {
  return (await prisma.role.findUniqueOrThrow({ where: { name } })).id
}

async function crear(cookie: string, body: unknown) {
  const { POST } = await import('@/app/api/users/route')
  return call<{ id: number; username: string }>(POST, '/api/users', {
    method: 'POST',
    cookie,
    body,
  })
}

async function listar(cookie: string) {
  const { GET } = await import('@/app/api/users/route')
  return call<{ data: Array<{ id: number; username: string; mustChangePassword: boolean }> }>(
    GET,
    '/api/users',
    { cookie },
  )
}

async function editar(id: number, cookie: string, body: unknown) {
  const { PUT } = await import('@/app/api/users/[id]/route')
  return call(PUT, `/api/users/${String(id)}`, {
    method: 'PUT',
    cookie,
    params: { id: String(id) },
    body,
  })
}

async function restablecer(id: number, cookie: string, clave = TEMPORAL) {
  const { POST } = await import('@/app/api/users/[id]/password/route')
  return call(POST, `/api/users/${String(id)}/password`, {
    method: 'POST',
    cookie,
    params: { id: String(id) },
    body: { claveNueva: clave, claveConfirmacion: clave },
  })
}

async function elegirClave(cookie: string, clave = PROPIA, confirmacion = clave) {
  const { POST } = await import('@/app/api/auth/password/temporal/route')
  return call(POST, '/api/auth/password/temporal', {
    method: 'POST',
    cookie,
    body: { claveNueva: clave, claveConfirmacion: confirmacion },
  })
}

async function verCatalogo(cookie: string) {
  const { GET } = await import('@/app/api/products/route')
  return call(GET, '/api/products', { cookie })
}

/** Franco da de alta a un empleado, por la API. Devuelve su id. */
async function altaDeEmpleado(username = 'juan'): Promise<number> {
  const res = await crear(await sessionCookie(franco), {
    username,
    name: 'Juan Perez',
    password: TEMPORAL,
    roleId: await rolId('empleado'),
  })
  expect(res.status).toBe(201)
  return (res.body as { id: number }).id
}

describe('Login: el usuario no distingue mayusculas ni espacios', () => {
  it.each(['Franco', 'franco', 'FRANCO', ' franco ', 'FrAnCo'])(
    '"%s" autentica al mismo usuario',
    async (escrito) => {
      const res = await login(escrito, franco.password)
      expect(res.status).toBe(200)
      expect(await usuarioDeLaCookie(cookieNueva(res))).toBe(franco.id)
    },
  )

  it('la contrasena si distingue mayusculas', async () => {
    const res = await login('franco', franco.password.toUpperCase())
    expect(res.status).toBe(401)
  })

  it('el limite de intentos cuenta junto lo escrito de distintas formas', async () => {
    for (const escrito of ['Franco', 'FRANCO', 'franco', ' franco', 'fRaNcO', 'FRANco', 'franCO']) {
      expect((await login(escrito, 'no-es-la-clave')).status).toBe(401)
    }
    await login('franco', 'no-es-la-clave')

    const bloqueado = await login('FRANCO', franco.password)
    expect(bloqueado.status).toBe(429)
  })
})

describe('La base no acepta dos usuarios que difieren en mayusculas', () => {
  const datos = (username: string, roleId: number, branchId: number) => ({
    username,
    name: 'Otro',
    password: 'x',
    roleId,
    branchId,
  })

  it('un usuario no canonico lo rechaza la base, sin pasar por la aplicacion', async () => {
    const roleId = await rolId('empleado')
    await expect(
      prisma.user.create({ data: datos('Franco', roleId, franco.branchId) }),
    ).rejects.toThrow()
    await expect(
      prisma.user.create({ data: datos(' pedro', roleId, franco.branchId) }),
    ).rejects.toThrow()
  })

  it('crear "Franco" si ya existe "franco": duplicado', async () => {
    const res = await crear(await sessionCookie(franco), {
      username: 'Franco',
      name: 'Otro Franco',
      password: TEMPORAL,
      roleId: await rolId('empleado'),
    })
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('DUPLICATE_USERNAME')
    expect(await prisma.user.count({ where: { username: 'franco' } })).toBe(1)
  })

  it('el alta guarda la forma canonica', async () => {
    const res = await crear(await sessionCookie(franco), {
      username: '  Juan.Perez ',
      name: 'Juan Perez',
      password: TEMPORAL,
      roleId: await rolId('empleado'),
    })
    expect(res.status).toBe(201)
    expect((res.body as { username: string }).username).toBe('juan.perez')
  })

  it('editar el usuario normaliza y valida que este libre', async () => {
    const id = await altaDeEmpleado()
    const cookie = await sessionCookie(franco)

    const ocupado = await editar(id, cookie, { username: 'FRANCO' })
    expect(ocupado.status).toBe(409)
    expect(errorDe(ocupado).code).toBe('DUPLICATE_USERNAME')

    expect((await editar(id, cookie, { username: ' Juancito ' })).status).toBe(200)
    const u = await prisma.user.findUniqueOrThrow({ where: { id } })
    expect(u.username).toBe('juancito')
  })
})

describe('Alta de un empleado', () => {
  it('Franco crea un empleado en SU local, que queda con contrasena temporal', async () => {
    const id = await altaDeEmpleado()

    const u = await prisma.user.findUniqueOrThrow({
      where: { id },
      include: { role: true },
    })
    expect(u.branchId).toBe(franco.branchId)
    expect(u.role.name).toBe('empleado')
    expect(u.mustChangePassword).toBe(true)
    expect(u.password).not.toBe(TEMPORAL)
    expect(await bcrypt.compare(TEMPORAL, u.password)).toBe(true)
  })

  it('no acepta elegir la sucursal', async () => {
    const res = await crear(await sessionCookie(franco), {
      username: 'juan',
      name: 'Juan',
      password: TEMPORAL,
      roleId: await rolId('empleado'),
      branchId: fx.branchB.id,
    })
    expect(res.status).toBe(400)
  })

  it.each(['admin', 'duenio', 'encargado', 'auditor'])(
    'Franco no puede crear un usuario con el rol %s',
    async (rol) => {
      const res = await crear(await sessionCookie(franco), {
        username: 'colado',
        name: 'Colado',
        password: TEMPORAL,
        roleId: await rolId(rol),
      })
      expect(res.status).toBe(403)
      expect(await prisma.user.count({ where: { username: 'colado' } })).toBe(0)
    },
  )

  it('Franco solo ve los roles que puede asignar', async () => {
    const { GET } = await import('@/app/api/roles/route')
    const res = await call<Array<{ name: string }>>(GET, '/api/roles', {
      cookie: await sessionCookie(franco),
    })
    expect(res.status).toBe(200)
    expect((res.body as Array<{ name: string }>).map((r) => r.name).sort()).toEqual([
      'admin_local',
      'empleado',
    ])
  })

  it('una temporal muy corta no se acepta', async () => {
    const res = await crear(await sessionCookie(franco), {
      username: 'juan',
      name: 'Juan',
      password: 'corta',
      roleId: await rolId('empleado'),
    })
    expect(res.status).toBe(400)
  })
})

describe('Primer ingreso con la contrasena temporal', () => {
  it('no se puede saltear: toda la API responde que hay que cambiarla', async () => {
    await altaDeEmpleado()
    const cookie = cookieNueva(await login('juan', TEMPORAL))

    const res = await verCatalogo(cookie)
    expect(res.status).toBe(403)
    expect(errorDe(res).code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('cambia la contrasena con dos campos y recien ahi entra', async () => {
    const id = await altaDeEmpleado()
    const cookie = cookieNueva(await login('juan', TEMPORAL))

    const res = await elegirClave(cookie)
    expect(res.status).toBe(200)

    const nueva = cookieNueva(res)
    expect((await verCatalogo(nueva)).status).toBe(200)

    const u = await prisma.user.findUniqueOrThrow({ where: { id } })
    expect(u.mustChangePassword).toBe(false)
    expect(await bcrypt.compare(PROPIA, u.password)).toBe(true)
  })

  it('despues entra con la propia, y la temporal ya no sirve', async () => {
    await altaDeEmpleado()
    await elegirClave(cookieNueva(await login('juan', TEMPORAL)))

    expect((await login('juan', TEMPORAL)).status).toBe(401)
    const ingreso = await login('JUAN', PROPIA)
    expect(ingreso.status).toBe(200)
    expect((await verCatalogo(cookieNueva(ingreso))).status).toBe(200)
  })

  it('no acepta repetir la temporal, ni una confirmacion distinta, ni una corta', async () => {
    await altaDeEmpleado()
    const cookie = cookieNueva(await login('juan', TEMPORAL))

    await prisma.user.update({
      where: { username: 'juan' },
      data: { password: await bcrypt.hash('temporal-larga', 4) },
    })
    expect((await elegirClave(cookie, 'temporal-larga')).status).toBe(400)
    expect((await elegirClave(cookie, PROPIA, 'otra-cosa-distinta')).status).toBe(400)
    expect((await elegirClave(cookie, 'corta')).status).toBe(400)

    const u = await prisma.user.findUniqueOrThrow({ where: { username: 'juan' } })
    expect(u.mustChangePassword).toBe(true)
  })

  it('esa ruta no sirve para cambiar la clave de una sesion comun sin la actual', async () => {
    const antes = await prisma.user.findUniqueOrThrow({ where: { id: fx.cajero.id } })

    const res = await elegirClave(await sessionCookie(fx.cajero))
    expect(res.status).toBe(409)

    const despues = await prisma.user.findUniqueOrThrow({ where: { id: fx.cajero.id } })
    expect(despues.password).toBe(antes.password)
    expect(despues.sessionVersion).toBe(antes.sessionVersion)
  })

  it('sin sesion, 401', async () => {
    expect((await elegirClave('')).status).toBe(401)
  })
})

describe('Restablecer la contrasena', () => {
  it('la sesion anterior deja de servir y hay que volver a cambiarla', async () => {
    const id = await altaDeEmpleado()
    const sesion = cookieNueva(await elegirClave(cookieNueva(await login('juan', TEMPORAL))))
    expect((await verCatalogo(sesion)).status).toBe(200)

    const res = await restablecer(id, await sessionCookie(franco), 'otra-temporal')
    expect(res.status).toBe(200)
    // Quien la escribio ya la conoce: no vuelve en la respuesta.
    expect(JSON.stringify(res.body)).not.toContain('otra-temporal')

    expect((await verCatalogo(sesion)).status).toBe(401)
    expect(await usuarioDeLaCookie(sesion)).toBeNull()

    const u = await prisma.user.findUniqueOrThrow({ where: { id } })
    expect(u.mustChangePassword).toBe(true)

    const reingreso = cookieNueva(await login('juan', 'otra-temporal'))
    const catalogo = await verCatalogo(reingreso)
    expect(catalogo.status).toBe(403)
    expect(errorDe(catalogo).code).toBe('PASSWORD_CHANGE_REQUIRED')
  })

  it('una confirmacion distinta no cambia nada', async () => {
    const id = await altaDeEmpleado()
    const antes = await prisma.user.findUniqueOrThrow({ where: { id } })

    const { POST } = await import('@/app/api/users/[id]/password/route')
    const res = await call(POST, `/api/users/${String(id)}/password`, {
      method: 'POST',
      cookie: await sessionCookie(franco),
      params: { id: String(id) },
      body: { claveNueva: 'otra-temporal', claveConfirmacion: 'otra-temporaL' },
    })
    expect(res.status).toBe(400)

    const despues = await prisma.user.findUniqueOrThrow({ where: { id } })
    expect(despues.password).toBe(antes.password)
  })

  it('la propia no se restablece: se cambia sabiendo la actual', async () => {
    const res = await restablecer(franco.id, await sessionCookie(franco))
    expect(res.status).toBe(409)
  })
})

describe('Desactivar y activar', () => {
  it('desactivado no entra y su sesion se corta; activado vuelve con su clave', async () => {
    const id = await altaDeEmpleado()
    const sesion = cookieNueva(await elegirClave(cookieNueva(await login('juan', TEMPORAL))))
    const cookie = await sessionCookie(franco)

    expect((await editar(id, cookie, { isActive: false })).status).toBe(200)
    expect((await login('juan', PROPIA)).status).toBe(401)
    expect((await verCatalogo(sesion)).status).toBe(401)

    expect((await editar(id, cookie, { isActive: true })).status).toBe(200)
    const ingreso = await login('juan', PROPIA)
    expect(ingreso.status).toBe(200)
    expect((await verCatalogo(cookieNueva(ingreso))).status).toBe(200)
  })

  it('Franco no puede desactivarse', async () => {
    const res = await editar(franco.id, await sessionCookie(franco), { isActive: false })
    expect(res.status).toBe(409)
    const u = await prisma.user.findUniqueOrThrow({ where: { id: franco.id } })
    expect(u.isActive).toBe(true)
  })
})

describe('Quien ve Usuarios', () => {
  const menu = (rol: string) =>
    navegacionPara(new Set(permissionsForRole(rol)))
      .flatMap((g) => g.items)
      .map((i) => i.href)

  it('el empleado no lo ve en el menu; Franco si', () => {
    expect(menu('empleado')).not.toContain('/usuarios')
    expect(menu('admin_local')).toContain('/usuarios')
  })

  it('el empleado ve lo que necesita para atender', () => {
    expect(menu('empleado')).toEqual(
      expect.arrayContaining(['/', '/venta', '/caja', '/productos', '/stock', '/inventarios']),
    )
  })

  it('el empleado no puede usar la API de usuarios a mano', async () => {
    const empleado = fx.porRol.empleado
    if (!empleado) throw new Error('La fixture no trae un empleado')
    const cookie = await sessionCookie(empleado)

    expect((await listar(cookie)).status).toBe(403)
    expect(
      (
        await crear(cookie, {
          username: 'colado',
          name: 'Colado',
          password: TEMPORAL,
          roleId: await rolId('admin'),
        })
      ).status,
    ).toBe(403)
    expect((await editar(fx.cajero.id, cookie, { name: 'Otro' })).status).toBe(403)
    expect((await restablecer(fx.cajero.id, cookie)).status).toBe(403)

    const { GET } = await import('@/app/api/roles/route')
    expect((await call(GET, '/api/roles', { cookie })).status).toBe(403)
  })

  it('Franco si, y nunca le llega un hash', async () => {
    await altaDeEmpleado()
    const res = await listar(await sessionCookie(franco))
    expect(res.status).toBe(200)
    expect(JSON.stringify(res.body)).not.toContain('password"')
    expect(JSON.stringify(res.body)).not.toContain('$2b$')
  })
})

describe('Franco administra solo su local', () => {
  it('la lista trae a su gente y nadie mas', async () => {
    const id = await altaDeEmpleado()
    const res = await listar(await sessionCookie(franco))
    const nombres = (res.body as { data: Array<{ id: number; username: string }> }).data
    expect(nombres.map((u) => u.username).sort()).toEqual(['franco', 'juan', 'u_empleado'].sort())
    expect(nombres.some((u) => u.id === id)).toBe(true)
  })

  it('no puede tocar a nadie de otra sucursal', async () => {
    const cookie = await sessionCookie(franco)
    expect((await editar(fx.cajeroB.id, cookie, { name: 'Otro' })).status).toBe(404)
    expect((await restablecer(fx.cajeroB.id, cookie)).status).toBe(404)
  })

  it('no puede tocar las cuentas generales de su propia sucursal', async () => {
    const cookie = await sessionCookie(franco)
    expect((await editar(fx.admin.id, cookie, { isActive: false })).status).toBe(404)
    expect((await restablecer(fx.admin.id, cookie)).status).toBe(404)
    expect((await editar(fx.cajero.id, cookie, { name: 'Otro' })).status).toBe(404)
  })

  it('no puede ascender a nadie a un rol que no administra', async () => {
    const id = await altaDeEmpleado()
    const res = await editar(id, await sessionCookie(franco), { roleId: await rolId('admin') })
    expect(res.status).toBe(403)
    const u = await prisma.user.findUniqueOrThrow({ where: { id }, include: { role: true } })
    expect(u.role.name).toBe('empleado')
  })

  it('el administrador general sigue viendo a todos los de su sucursal', async () => {
    const res = await listar(await sessionCookie(fx.admin))
    const nombres = (res.body as { data: Array<{ username: string }> }).data.map((u) => u.username)
    expect(nombres).toContain('admin1')
    expect(nombres).toContain('cajero1')
    expect(nombres).toContain('franco')
  })

  it('edita su propio nombre y usuario', async () => {
    const cookie = await sessionCookie(franco)
    expect((await editar(franco.id, cookie, { name: 'Franco G.' })).status).toBe(200)
    expect((await editar(franco.id, cookie, { username: 'franco.g' })).status).toBe(200)
    expect((await login('Franco.G', franco.password)).status).toBe(200)
  })
})

describe('El local no se queda sin administrador', () => {
  it('Franco no puede quitarse el rol si es el ultimo', async () => {
    const res = await editar(franco.id, await sessionCookie(franco), {
      roleId: await rolId('empleado'),
    })
    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('LAST_ADMIN')
    const u = await prisma.user.findUniqueOrThrow({
      where: { id: franco.id },
      include: { role: true },
    })
    expect(u.role.name).toBe('admin_local')
  })

  it('con otro administrador activo, si', async () => {
    const id = await altaDeEmpleado()
    const cookie = await sessionCookie(franco)
    await editar(id, cookie, { roleId: await rolId('admin_local') })

    const res = await editar(franco.id, cookie, { roleId: await rolId('empleado') })
    expect(res.status).toBe(200)
  })

  it('un administrador desactivado no cuenta como reemplazo', async () => {
    const id = await altaDeEmpleado()
    const cookie = await sessionCookie(franco)
    await editar(id, cookie, { roleId: await rolId('admin_local') })
    await editar(id, cookie, { isActive: false })

    const res = await editar(franco.id, cookie, { roleId: await rolId('empleado') })
    expect(res.status).toBe(409)
  })

  it('dos administradores que se quitan el rol a la vez: queda uno', async () => {
    const id = await altaDeEmpleado()
    const cookie = await sessionCookie(franco)
    await editar(id, cookie, { roleId: await rolId('admin_local') })
    const otro = await prisma.user.findUniqueOrThrow({ where: { id } })
    const cookieOtro = await sessionCookie({ ...franco, ...otro, role: 'admin_local' })

    const rol = await rolId('empleado')
    const resultados = await Promise.all([
      editar(franco.id, cookieOtro, { roleId: rol }),
      editar(id, cookie, { roleId: rol }),
    ])

    // El segundo puede frenar en la regla (409) o, si el primero ya termino, en
    // que ya no es administrador (403). Lo que importa es que pase uno solo.
    expect(resultados.filter((r) => r.status === 200)).toHaveLength(1)
    expect(
      await prisma.user.count({
        where: { branchId: franco.branchId, isActive: true, role: { name: 'admin_local' } },
      }),
    ).toBe(1)
  })

  it('el administrador general si puede: tiene el resto de las cuentas', async () => {
    const res = await editar(franco.id, await sessionCookie(fx.admin), { isActive: false })
    expect(res.status).toBe(200)
  })
})

describe('Queda en la bitacora, sin ninguna contrasena', () => {
  it('cada hecho deja su entrada, con quien lo hizo y sobre quien', async () => {
    const id = await altaDeEmpleado()
    const cookie = await sessionCookie(franco)
    await editar(id, cookie, { name: 'Juan Perez Gomez' })
    await editar(id, cookie, { roleId: await rolId('admin_local') })
    await editar(id, cookie, { roleId: await rolId('empleado') })
    await restablecer(id, cookie, 'otra-temporal')
    await editar(id, cookie, { isActive: false })
    await editar(id, cookie, { isActive: true })

    const entradas = await prisma.auditLog.findMany({
      where: { tableName: 'User', recordId: id },
      orderBy: { id: 'asc' },
    })
    expect(entradas.map((e) => e.actionType)).toEqual([
      'create',
      'update',
      'role_change',
      'role_change',
      'password_reset',
      'deactivate',
      'activate',
    ])
    for (const e of entradas) {
      expect(e.userId).toBe(franco.id)
      expect(e.branchId).toBe(franco.branchId)
    }

    const texto = JSON.stringify(entradas)
    for (const prohibido of [TEMPORAL, 'otra-temporal', '$2b$', 'sessionVersion']) {
      expect(texto).not.toContain(prohibido)
    }
  })
})
