/**
 * Autenticacion: errores genericos, sin enumeracion de usuarios, con limite
 * de intentos y con auditoria.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, sessionCookie, type RouteHandler } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  const { __resetLoginAttempts } = await import('@/server/auth/loginAttempts')
  __resetLoginAttempts()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function login(username: string, password: string) {
  const { POST } = await import('@/app/api/auth/login/route')
  return call<{ error?: string }>(POST as RouteHandler, '/api/auth/login', {
    method: 'POST',
    body: { username, password },
  })
}

describe('Inicio de sesion', () => {
  it('acepta credenciales correctas y devuelve una cookie httpOnly', async () => {
    const res = await login(fx.cajero.username, fx.cajero.password)

    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('token=')
    expect(setCookie.toLowerCase()).toContain('httponly')
    expect(setCookie.toLowerCase()).toContain('samesite=lax')
  })

  it('no devuelve datos del usuario en el cuerpo', async () => {
    const res = await login(fx.cajero.username, fx.cajero.password)
    expect(res.text).not.toMatch(/\$2[aby]\$/)
    expect(res.text).not.toContain('"password"')
  })

  it('un usuario dado de baja no puede iniciar sesion', async () => {
    const res = await login(fx.inactivo.username, fx.inactivo.password)
    expect(res.status).toBe(401)
  })
})

describe('No permite enumerar usuarios', () => {
  it('usuario inexistente y contrasena incorrecta dan el mismo error', async () => {
    const inexistente = await login('no_existe_nadie', 'Cualquiera-1234')
    const incorrecta = await login(fx.cajero.username, 'Contrasena-Incorrecta')

    expect(inexistente.status).toBe(401)
    expect(incorrecta.status).toBe(401)
    expect(inexistente.body.error).toBe(incorrecta.body.error)
  })

  it('el mensaje no dice cual de los dos campos fallo', async () => {
    const res = await login(fx.cajero.username, 'mal')
    const mensaje = (res.body.error ?? '').toLowerCase()

    expect(mensaje).not.toContain('usuario no encontrado')
    expect(mensaje).not.toContain('no existe')
    expect(mensaje).not.toContain('contrasena incorrecta')
  })
})

describe('Limite de intentos', () => {
  it('bloquea despues de varios intentos fallidos seguidos', async () => {
    let bloqueado = false

    for (let i = 0; i < 12; i++) {
      const res = await login(fx.cajero.username, `intento-fallido-${i}`)
      if (res.status === 429) {
        bloqueado = true
        break
      }
    }

    expect(bloqueado, 'Se permitieron 12 intentos de contrasena sin ningun freno').toBe(true)
  })

  it('un intento fallido queda registrado en la bitacora', async () => {
    await login(fx.cajero.username, 'contrasena-mal')

    const log = await prisma.auditLog.findFirst({
      where: { actionType: 'login_failed' },
      orderBy: { id: 'desc' },
    })

    expect(log, 'Los intentos fallidos de acceso no se registran').not.toBeNull()
  })
})

describe('Cierre de sesion', () => {
  it('borra la cookie', async () => {
    const { POST } = await import('@/app/api/auth/logout/route')
    const res = await call(POST as RouteHandler, '/api/auth/logout', {
      method: 'POST',
      cookie: await sessionCookie(fx.cajero),
    })

    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('token=')
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)
  })

  it('invalida la sesion del lado del servidor, no solo la cookie', async () => {
    const cookie = await sessionCookie(fx.cajero)

    const { POST: logout } = await import('@/app/api/auth/logout/route')
    await call(logout as RouteHandler, '/api/auth/logout', { method: 'POST', cookie })

    // Reutilizar la misma cookie (copiada antes del logout) ya no debe servir.
    const { GET } = await import('@/app/api/products/route')
    const res = await call(GET as RouteHandler, '/api/products', { cookie })

    expect(
      res.status,
      'La cookie sigue siendo valida despues del logout: un token copiado nunca caduca',
    ).toBe(401)
  })
})

describe('Validacion de sesion', () => {
  it('/api/auth/validate no expone datos sin sesion', async () => {
    const { POST } = await import('@/app/api/auth/validate/route')
    const res = await call(POST as RouteHandler, '/api/auth/validate', { method: 'POST' })

    expect(res.status).toBe(401)
    expect(res.text).not.toContain('"password"')
  })

  it('/api/auth/validate devuelve el usuario y sus permisos con sesion valida', async () => {
    const { POST } = await import('@/app/api/auth/validate/route')
    const res = await call<{ valid: boolean; user: { role: string; permissions: string[] } }>(
      POST as RouteHandler,
      '/api/auth/validate',
      { method: 'POST', cookie: await sessionCookie(fx.cajero) },
    )

    expect(res.status).toBe(200)
    expect(res.body.valid).toBe(true)
    expect(res.body.user.role).toBe('cajero')
    expect(res.body.user.permissions).toContain('sales.create')
    expect(res.body.user.permissions).not.toContain('users.manage')
  })
})
