/**
 * `PUT /api/users/:id` — modificacion del personal.
 *
 * Es un endpoint nuevo de la Fase 2: hasta ahora habia alta y listado, y
 * cambiar un rol o dar de baja a alguien se hacia por SQL.
 *
 * Las tres reglas que hacen que no sea peligroso:
 *
 *   1. nadie se edita a si mismo. Sin esto, el unico administrador puede
 *      bajarse el rol o darse de baja y dejar el sistema sin nadie que lo
 *      administre;
 *   2. solo personal de la misma sucursal;
 *   3. dar de baja revoca las sesiones abiertas EN EL ACTO. Sin eso, quien
 *      tiene la pestania abierta sigue vendiendo hasta que venza el token.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function editar(id: number, cookie: string, body: unknown) {
  // Import directo del handler: el modulo exporta ademas `runtime` y
  // `dynamic`, que son cadenas, asi que no encaja en `Record<_, RouteHandler>`.
  const { PUT } = await import('@/app/api/users/[id]/route')

  return call(PUT, `/api/users/${id}`, {
    method: 'PUT',
    cookie,
    params: { id: String(id) },
    body,
  })
}

describe('Quien puede modificar', () => {
  it('sin sesion, 401', async () => {
    const res = await editar(fx.cajero.id, '', { name: 'Otro nombre' })
    expect(res.status).toBe(401)
  })

  it('sin users.manage, 403', async () => {
    const res = await editar(fx.admin.id, await sessionCookie(fx.cajero), { name: 'Otro' })
    expect(res.status).toBe(403)
    expect(errorDe(res).code).toBe('FORBIDDEN')
  })

  it('con users.manage, cambia el nombre', async () => {
    const res = await editar(fx.cajero.id, await sessionCookie(fx.admin), { name: 'Lucia Bravo' })
    expect(res.status).toBe(200)

    const guardado = await prisma.user.findUnique({ where: { id: fx.cajero.id } })
    expect(guardado?.name).toBe('Lucia Bravo')
  })
})

describe('Nadie se edita a si mismo', () => {
  it('el administrador no puede cambiarse el rol', async () => {
    const rolCajero = await prisma.role.findUniqueOrThrow({ where: { name: 'cajero' } })

    const res = await editar(fx.admin.id, await sessionCookie(fx.admin), { roleId: rolCajero.id })
    expect(res.status).toBe(409)

    const sinCambios = await prisma.user.findUnique({
      where: { id: fx.admin.id },
      select: { roleId: true },
    })
    expect(sinCambios?.roleId).not.toBe(rolCajero.id)
  })

  it('el administrador no puede darse de baja', async () => {
    const res = await editar(fx.admin.id, await sessionCookie(fx.admin), { isActive: false })
    expect(res.status).toBe(409)

    const sigueActivo = await prisma.user.findUnique({
      where: { id: fx.admin.id },
      select: { isActive: true },
    })
    expect(sigueActivo?.isActive).toBe(true)
  })
})

describe('Aislamiento por sucursal', () => {
  it('no se puede tocar personal de otra sucursal', async () => {
    const res = await editar(fx.cajeroB.id, await sessionCookie(fx.admin), { name: 'Intruso' })
    // 404 y no 403: no hay que confirmarle a nadie que ese usuario existe.
    expect(res.status).toBe(404)

    const intacto = await prisma.user.findUnique({ where: { id: fx.cajeroB.id } })
    expect(intacto?.name).not.toBe('Intruso')
  })
})

describe('Dar de baja revoca las sesiones', () => {
  it('incrementa sessionVersion, con lo que el token abierto deja de valer', async () => {
    const antes = await prisma.user.findUniqueOrThrow({
      where: { id: fx.cajero.id },
      select: { sessionVersion: true },
    })
    // La cookie se firma ANTES de la baja: es la que tendria en la pestania.
    const cookieAbierta = await sessionCookie(fx.cajero)

    const res = await editar(fx.cajero.id, await sessionCookie(fx.admin), { isActive: false })
    expect(res.status).toBe(200)

    const despues = await prisma.user.findUniqueOrThrow({
      where: { id: fx.cajero.id },
      select: { sessionVersion: true, isActive: true },
    })
    expect(despues.isActive).toBe(false)
    expect(despues.sessionVersion).toBe(antes.sessionVersion + 1)

    // Y el token viejo ya no abre nada.
    const { GET } = await import('@/app/api/products/route')
    const lectura = await call(GET, '/api/products', { cookie: cookieAbierta })
    expect(lectura.status).toBe(401)
  })

  it('volver a habilitar NO incrementa la version', async () => {
    await editar(fx.cajero.id, await sessionCookie(fx.admin), { isActive: false })
    const trasBaja = await prisma.user.findUniqueOrThrow({
      where: { id: fx.cajero.id },
      select: { sessionVersion: true },
    })

    await editar(fx.cajero.id, await sessionCookie(fx.admin), { isActive: true })
    const trasAlta = await prisma.user.findUniqueOrThrow({
      where: { id: fx.cajero.id },
      select: { sessionVersion: true, isActive: true },
    })

    expect(trasAlta.isActive).toBe(true)
    expect(trasAlta.sessionVersion).toBe(trasBaja.sessionVersion)
  })
})

describe('Validacion de la entrada', () => {
  it('rechaza un rol que no existe', async () => {
    const res = await editar(fx.cajero.id, await sessionCookie(fx.admin), { roleId: 999_999 })
    expect(res.status).toBe(400)
  })

  it('rechaza un cuerpo vacio', async () => {
    const res = await editar(fx.cajero.id, await sessionCookie(fx.admin), {})
    expect(res.status).toBe(400)
  })

  it('rechaza campos que no se pueden cambiar por aca', async () => {
    // `password` y `branchId` no estan en el esquema: `.strict()` los rechaza
    // en vez de ignorarlos, para que el intento se vea.
    const res = await editar(fx.cajero.id, await sessionCookie(fx.admin), {
      name: 'X',
      password: 'otra-contrasena',
    })
    expect(res.status).toBe(400)

    const conBranch = await editar(fx.cajero.id, await sessionCookie(fx.admin), {
      name: 'X',
      branchId: fx.branchB.id,
    })
    expect(conBranch.status).toBe(400)
  })

  it('nunca devuelve el hash', async () => {
    const res = await editar(fx.cajero.id, await sessionCookie(fx.admin), { name: 'Lucia' })
    expect(res.text).not.toMatch(/\$2[aby]\$/)
    expect(res.text).not.toContain('password')
  })
})

describe('Queda en la bitacora', () => {
  it('registra que cambio, sin datos de sesion', async () => {
    await editar(fx.cajero.id, await sessionCookie(fx.admin), { name: 'Lucia Bravo' })

    const entrada = await prisma.auditLog.findFirst({
      where: { tableName: 'User', recordId: fx.cajero.id, actionType: 'update' },
      orderBy: { id: 'desc' },
    })

    expect(entrada).not.toBeNull()
    expect(entrada?.userId).toBe(fx.admin.id)

    const texto = JSON.stringify(entrada?.changes)
    expect(texto).toContain('Lucia Bravo')
    expect(texto).not.toContain('password')
    expect(texto).not.toContain('sessionVersion')
  })
})
