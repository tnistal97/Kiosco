/**
 * Contrasenas desde la aplicacion (P0-A).
 *
 *   POST /api/auth/password       cambio de la propia, con la actual
 *   POST /api/users/:id/password  reseteo de la de otro, con `users.manage`
 *
 * Hasta ahora la unica forma de cambiar una clave era entrar por SSH y correr
 * `scripts/establecer-clave.ts`. Lo que tiene que valer siempre:
 *
 *   - la clave nunca vuelve en una respuesta, salvo la temporal generada, y
 *     esa una sola vez;
 *   - ningun hash sale del servidor ni entra en la bitacora;
 *   - el cambio cierra las OTRAS sesiones; el reseteo cierra TODAS;
 *   - equivocarse con la clave actual cuenta en el mismo limite que el login.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import bcrypt from 'bcrypt'
import { seedFixture, prisma, type Fixture, type TestUser } from '../helpers/db'
import { call, errorDe, sessionCookie, type CallResult } from '../helpers/http'
import { getSession } from '@/server/auth/session'
import { __resetLoginAttempts } from '@/server/auth/loginAttempts'
import { PASSWORD_MIN } from '@/modules/users/schemas'

let fx: Fixture

beforeEach(async () => {
  __resetLoginAttempts()
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function cambiar(cookie: string, body: unknown) {
  const { POST } = await import('@/app/api/auth/password/route')
  return call(POST, '/api/auth/password', { method: 'POST', cookie, body })
}

async function resetear(id: number, cookie: string, body: unknown = {}) {
  const { POST } = await import('@/app/api/users/[id]/password/route')
  return call(POST, `/api/users/${id}/password`, {
    method: 'POST',
    cookie,
    params: { id: String(id) },
    body,
  })
}

/** Si la cookie todavia abre sesion, con las mismas reglas que la aplicacion. */
async function abreSesion(cookie: string): Promise<boolean> {
  return (await getSession(new Request('http://localhost/', { headers: { cookie } }))) !== null
}

/** La cookie de sesion que fija la respuesta, lista para mandar. */
function cookieNueva(res: CallResult): string | null {
  const token = /(?:^|,\s*)token=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]
  return token ? `token=${token}` : null
}

async function claveGuardada(user: TestUser): Promise<string> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  return u.password
}

async function versionDeSesion(user: TestUser): Promise<number> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  return u.sessionVersion
}

const NUEVA = 'Otra-Clave-2026'

describe('Cambio de la contrasena propia', () => {
  it('sin sesion, 401', async () => {
    const res = await cambiar('', {
      claveActual: fx.cajero.password,
      claveNueva: NUEVA,
      claveConfirmacion: NUEVA,
    })
    expect(res.status).toBe(401)
  })

  it('con la actual equivocada: 400, no cambia nada y queda como intento fallido', async () => {
    const antes = await claveGuardada(fx.cajero)

    const res = await cambiar(await sessionCookie(fx.cajero), {
      claveActual: 'no-es-la-clave',
      claveNueva: NUEVA,
      claveConfirmacion: NUEVA,
    })

    expect(res.status).toBe(400)
    expect(errorDe(res).message).toBe('La contraseña actual no es correcta')
    expect(await claveGuardada(fx.cajero)).toBe(antes)
    expect(await versionDeSesion(fx.cajero)).toBe(fx.cajero.sessionVersion)

    const log = await prisma.auditLog.findFirst({
      where: { actionType: 'password_change', userId: fx.cajero.id },
    })
    expect(log?.result).toBe('failure')
    expect(log?.reason).toBe('contraseña actual incorrecta')
  })

  it('la confirmacion distinta de la nueva: 400', async () => {
    const res = await cambiar(await sessionCookie(fx.cajero), {
      claveActual: fx.cajero.password,
      claveNueva: NUEVA,
      claveConfirmacion: `${NUEVA}x`,
    })
    expect(res.status).toBe(400)
    expect(await versionDeSesion(fx.cajero)).toBe(fx.cajero.sessionVersion)
  })

  it(`una nueva de menos de ${String(PASSWORD_MIN)} caracteres: 400`, async () => {
    const corta = 'a'.repeat(PASSWORD_MIN - 1)
    const res = await cambiar(await sessionCookie(fx.cajero), {
      claveActual: fx.cajero.password,
      claveNueva: corta,
      claveConfirmacion: corta,
    })
    expect(res.status).toBe(400)
  })

  it('la nueva igual a la actual: 400', async () => {
    const res = await cambiar(await sessionCookie(fx.cajero), {
      claveActual: fx.cajero.password,
      claveNueva: fx.cajero.password,
      claveConfirmacion: fx.cajero.password,
    })
    expect(res.status).toBe(400)
  })

  it('un campo de mas hace fallar la peticion entera', async () => {
    const delCajero = await claveGuardada(fx.cajero)
    const delAdmin = await claveGuardada(fx.admin)

    const res = await cambiar(await sessionCookie(fx.cajero), {
      claveActual: fx.cajero.password,
      claveNueva: NUEVA,
      claveConfirmacion: NUEVA,
      userId: fx.admin.id,
    })

    expect(res.status).toBe(400)
    expect(await claveGuardada(fx.cajero)).toBe(delCajero)
    expect(await claveGuardada(fx.admin)).toBe(delAdmin)
    expect(await versionDeSesion(fx.admin)).toBe(fx.admin.sessionVersion)
  })

  it('cambia la clave, cierra las otras sesiones y deja viva la de este equipo', async () => {
    const otroEquipo = await sessionCookie(fx.cajero)

    const res = await cambiar(otroEquipo, {
      claveActual: fx.cajero.password,
      claveNueva: NUEVA,
      claveConfirmacion: NUEVA,
    })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })

    // La clave nueva vale y la vieja no.
    const hash = await claveGuardada(fx.cajero)
    expect(await bcrypt.compare(NUEVA, hash)).toBe(true)
    expect(await bcrypt.compare(fx.cajero.password, hash)).toBe(false)

    // Las sesiones emitidas antes quedan afuera...
    expect(await versionDeSesion(fx.cajero)).toBe(fx.cajero.sessionVersion + 1)
    expect(await abreSesion(otroEquipo)).toBe(false)

    // ...y la cookie que devuelve la respuesta sigue adentro.
    const cookie = cookieNueva(res)
    expect(cookie).not.toBeNull()
    expect(await abreSesion(cookie ?? '')).toBe(true)
  })

  it('ni la respuesta ni la bitacora llevan la clave o el hash', async () => {
    const res = await cambiar(await sessionCookie(fx.cajero), {
      claveActual: fx.cajero.password,
      claveNueva: NUEVA,
      claveConfirmacion: NUEVA,
    })
    expect(res.status).toBe(200)
    expect(res.text).not.toContain(NUEVA)
    expect(res.text).not.toMatch(/\$2[aby]\$/)

    const log = await prisma.auditLog.findFirst({
      where: { actionType: 'password_change', userId: fx.cajero.id, result: 'success' },
    })
    expect(log).not.toBeNull()
    const guardado = JSON.stringify(log)
    expect(guardado).not.toContain(NUEVA)
    expect(guardado).not.toContain(fx.cajero.password)
    expect(guardado).not.toMatch(/\$2[aby]\$/)
  })

  it('ocho intentos con la actual equivocada bloquean, igual que el login', async () => {
    const cookie = await sessionCookie(fx.cajero)
    for (let i = 0; i < 8; i++) {
      const res = await cambiar(cookie, {
        claveActual: `mal-${String(i)}`,
        claveNueva: NUEVA,
        claveConfirmacion: NUEVA,
      })
      expect(res.status).toBe(400)
    }

    // Bloqueado: ni siquiera con la clave correcta.
    const res = await cambiar(cookie, {
      claveActual: fx.cajero.password,
      claveNueva: NUEVA,
      claveConfirmacion: NUEVA,
    })
    expect(res.status).toBe(429)
    expect(await bcrypt.compare(fx.cajero.password, await claveGuardada(fx.cajero))).toBe(true)
  })
})

describe('Reseteo de la contrasena de otro', () => {
  it('sin sesion, 401', async () => {
    const res = await resetear(fx.cajero.id, '')
    expect(res.status).toBe(401)
  })

  it('sin users.manage, 403 y no cambia nada', async () => {
    const antes = await claveGuardada(fx.admin)
    const res = await resetear(fx.admin.id, await sessionCookie(fx.cajero))
    expect(res.status).toBe(403)
    expect(await claveGuardada(fx.admin)).toBe(antes)
  })

  it('la propia no: se cambia sabiendo la actual', async () => {
    const res = await resetear(fx.admin.id, await sessionCookie(fx.admin))
    expect(res.status).toBe(409)
  })

  it('un usuario de otra sucursal: 404', async () => {
    const antes = await claveGuardada(fx.cajeroB)
    const res = await resetear(fx.cajeroB.id, await sessionCookie(fx.admin))
    expect(res.status).toBe(404)
    expect(await claveGuardada(fx.cajeroB)).toBe(antes)
  })

  it('genera una temporal, la devuelve una vez y cierra todas las sesiones', async () => {
    const sesionDelCajero = await sessionCookie(fx.cajero)

    const res = await resetear(fx.cajero.id, await sessionCookie(fx.admin))

    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    const cuerpo = res.body as { success: boolean; claveTemporal?: string }
    const temporal = cuerpo.claveTemporal ?? ''
    expect(temporal).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/)
    expect(temporal.length).toBeGreaterThanOrEqual(PASSWORD_MIN)

    const hash = await claveGuardada(fx.cajero)
    expect(await bcrypt.compare(temporal, hash)).toBe(true)
    expect(await bcrypt.compare(fx.cajero.password, hash)).toBe(false)

    expect(await versionDeSesion(fx.cajero)).toBe(fx.cajero.sessionVersion + 1)
    expect(await abreSesion(sesionDelCajero)).toBe(false)

    // Nada del hash en la respuesta.
    expect(res.text).not.toMatch(/\$2[aby]\$/)
  })

  it('la bitacora registra quien reseteo a quien, sin la clave', async () => {
    const res = await resetear(fx.cajero.id, await sessionCookie(fx.admin))
    const temporal = (res.body as { claveTemporal?: string }).claveTemporal ?? ''
    expect(temporal).not.toBe('')

    const log = await prisma.auditLog.findFirst({
      where: { actionType: 'password_reset', recordId: fx.cajero.id },
    })
    expect(log?.userId).toBe(fx.admin.id)
    expect(log?.result).toBe('success')

    const todo = JSON.stringify(await prisma.auditLog.findMany())
    expect(todo).not.toContain(temporal)
    expect(todo).not.toMatch(/\$2[aby]\$/)
  })

  it('con una clave escrita por el administrador: la usa y no la devuelve', async () => {
    const res = await resetear(fx.cajero.id, await sessionCookie(fx.admin), { claveNueva: NUEVA })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ success: true })
    expect(res.text).not.toContain(NUEVA)
    expect(await bcrypt.compare(NUEVA, await claveGuardada(fx.cajero))).toBe(true)
  })

  it('una clave escrita que no cumple la politica: 400 y no cambia', async () => {
    const antes = await claveGuardada(fx.cajero)
    const res = await resetear(fx.cajero.id, await sessionCookie(fx.admin), {
      claveNueva: 'corta',
    })
    expect(res.status).toBe(400)
    expect(await claveGuardada(fx.cajero)).toBe(antes)
  })

  it('la persona reseteada entra con la temporal y la cambia por una propia', async () => {
    const res = await resetear(fx.cajero.id, await sessionCookie(fx.admin))
    const temporal = (res.body as { claveTemporal?: string }).claveTemporal ?? ''

    // Entra con la temporal...
    const { POST: login } = await import('@/app/api/auth/login/route')
    const ingreso = await call(login, '/api/auth/login', {
      method: 'POST',
      body: { username: fx.cajero.username, password: temporal },
    })
    expect(ingreso.status).toBe(200)
    const cookie = cookieNueva(ingreso) ?? ''

    // ...y la cambia desde su propia sesion.
    const cambio = await cambiar(cookie, {
      claveActual: temporal,
      claveNueva: NUEVA,
      claveConfirmacion: NUEVA,
    })
    expect(cambio.status).toBe(200)
    expect(await bcrypt.compare(NUEVA, await claveGuardada(fx.cajero))).toBe(true)
  })
})
