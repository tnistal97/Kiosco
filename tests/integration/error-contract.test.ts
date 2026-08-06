/**
 * Contrato de error: una sola forma, en todos los casos.
 *
 *   { "error": { "code", "message", "requestId", "details"? } }
 *
 * La mitad que importa no es que el contrato se cumpla cuando todo va bien,
 * sino que ningun error --incluidos los de Prisma, que traen el nombre de la
 * tabla y a veces la ruta del servidor-- se escape sin traducir.
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { call, errorDe, sessionCookie, rawCookie, type RouteHandler } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
  const { __resetLoginAttempts } = await import('@/server/auth/loginAttempts')
  __resetLoginAttempts()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function invocar(
  modulo: string,
  metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  ruta: string,
  opciones: {
    cookie?: string
    body?: unknown
    params?: Record<string, string>
    rawBody?: string
  } = {},
) {
  const mod = (await import(/* @vite-ignore */ modulo)) as Record<string, RouteHandler>
  const handler = mod[metodo]
  if (!handler) throw new Error(`El modulo ${modulo} no exporta ${metodo}`)
  return call(handler, ruta, { method: metodo, ...opciones })
}

describe('Toda respuesta de error tiene la misma forma', () => {
  it('401 sin sesion', async () => {
    const res = await invocar('@/app/api/products/route', 'GET', '/api/products')
    expect(res.status).toBe(401)

    const error = errorDe(res)
    expect(error.code).toBe('UNAUTHENTICATED')
    expect(error.message).not.toBe('')
    expect(error.requestId).not.toBe('')
  })

  it('403 por falta de permiso', async () => {
    const res = await invocar('@/app/api/users/route', 'GET', '/api/users', {
      cookie: await sessionCookie(fx.cajero),
    })
    expect(res.status).toBe(403)
    expect(errorDe(res).code).toBe('FORBIDDEN')
  })

  it('404 al pedir algo que no existe', async () => {
    const res = await invocar('@/app/api/products/[id]/route', 'GET', '/api/products/999999', {
      cookie: await sessionCookie(fx.cajero),
      params: { id: '999999' },
    })
    expect(res.status).toBe(404)
    expect(errorDe(res).code).toBe('NOT_FOUND')
  })

  it('400 con el detalle del campo que fallo', async () => {
    const res = await invocar('@/app/api/sales/route', 'POST', '/api/sales', {
      cookie: await sessionCookie(fx.cajero),
      body: { items: [{ productId: fx.productoA.id, quantity: -3 }], paymentMethod: 'efectivo' },
    })

    expect(res.status).toBe(400)
    const error = errorDe(res)
    expect(error.code).toBe('VALIDATION')
    expect(JSON.stringify(error.details)).toContain('quantity')
  })

  it('409 con un codigo especifico de dominio', async () => {
    const res = await invocar('@/app/api/sales/route', 'POST', '/api/sales', {
      cookie: await sessionCookie(fx.cajero),
      body: { items: [{ productId: fx.productoA.id, quantity: 9999 }], paymentMethod: 'efectivo' },
    })

    expect(res.status).toBe(409)
    // No alcanza con 'CONFLICT': el cliente tiene que poder distinguir
    // "falta stock" de cualquier otro conflicto sin comparar textos.
    expect(errorDe(res).code).toBe('INSUFFICIENT_STOCK')
  })

  it('429 al superar el limite de intentos', async () => {
    const codigos: string[] = []
    for (let i = 0; i < 12; i++) {
      const res = await invocar('@/app/api/auth/login/route', 'POST', '/api/auth/login', {
        body: { username: fx.cajero.username, password: `mal-${i}` },
      })
      codigos.push(res.status === 429 ? errorDe(res).code : String(res.status))
      if (res.status === 429) break
    }

    expect(codigos, 'Nunca llego a bloquear por intentos repetidos').toContain('RATE_LIMITED')
  })

  it('la cabecera x-request-id coincide con la del cuerpo', async () => {
    const res = await invocar('@/app/api/products/route', 'GET', '/api/products')
    expect(res.headers.get('x-request-id')).toBe(errorDe(res).requestId)
  })

  it('dos peticiones tienen requestId distintos', async () => {
    const a = await invocar('@/app/api/products/route', 'GET', '/api/products')
    const b = await invocar('@/app/api/products/route', 'GET', '/api/products')
    expect(errorDe(a).requestId).not.toBe(errorDe(b).requestId)
  })

  it('las respuestas correctas tambien llevan x-request-id', async () => {
    const res = await invocar('@/app/api/products/route', 'GET', '/api/products', {
      cookie: await sessionCookie(fx.cajero),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-request-id')).toBeTruthy()
  })
})

describe('Nada interno se escapa en el mensaje de error', () => {
  /** Rastros de que el error salio crudo del motor o del sistema de archivos. */
  const FUGAS = [
    /prisma\./i,
    /invalid `prisma/i,
    /\bSELECT\b.*\bFROM\b/i,
    /\bINSERT INTO\b/i,
    /Unique constraint failed on the fields/i,
    /node_modules/,
    /[A-Za-z]:\\\\/, // ruta de Windows
    /\/var\/www\//,
    /\/home\/[a-z]+\//,
    /at Object\.<anonymous>/, // stack trace
    /PrismaClient/,
  ]

  function sinFugas(texto: string, contexto: string): void {
    for (const patron of FUGAS) {
      expect(patron.test(texto), `${contexto} filtro algo interno: ${texto.slice(0, 200)}`).toBe(
        false,
      )
    }
  }

  it('un choque de codigo de barras repetido no nombra la columna ni la tabla', async () => {
    await invocar('@/app/api/products/route', 'POST', '/api/products', {
      cookie: await sessionCookie(fx.admin),
      body: {
        name: 'Repetido',
        barcode: fx.productoA.barcode,
        price: 100,
        categoryId: fx.categoryId,
      },
    })

    // El servicio comprueba antes, asi que devuelve 409 con su propio
    // mensaje. Lo que se verifica es que ese mensaje sea el escrito para el
    // usuario y no el de Prisma.
    const res = await invocar('@/app/api/products/route', 'POST', '/api/products', {
      cookie: await sessionCookie(fx.admin),
      body: {
        name: 'Repetido 2',
        barcode: fx.productoA.barcode,
        price: 100,
        categoryId: fx.categoryId,
      },
    })

    expect(res.status).toBe(409)
    const error = errorDe(res)
    expect(error.code).toBe('DUPLICATE_BARCODE')
    sinFugas(res.text, 'El alta de producto con codigo repetido')
  })

  it('un usuario repetido tampoco', async () => {
    const rol = await prisma.role.findFirstOrThrow({ where: { name: 'cajero' } })

    const res = await invocar('@/app/api/users/route', 'POST', '/api/users', {
      cookie: await sessionCookie(fx.admin),
      body: {
        username: fx.cajero.username,
        name: 'Duplicado',
        password: 'Clave-Larga-1234',
        roleId: rol.id,
      },
    })

    expect(res.status).toBe(409)
    expect(errorDe(res).code).toBe('DUPLICATE_USERNAME')
    sinFugas(res.text, 'El alta de usuario repetido')
  })

  it('el traductor de errores de Prisma no deja pasar el mensaje original', async () => {
    const { traducirError } = await import('@/server/http/prismaErrors')
    const { Prisma } = await import('@prisma/client')

    const original = new Prisma.PrismaClientKnownRequestError(
      'Invalid `prisma.product.create()` invocation in /var/www/kiosco/src/app/api/products/route.ts:88\n' +
        'Unique constraint failed on the fields: (`barcode`)',
      { code: 'P2002', clientVersion: '6.19.3', meta: { target: ['barcode'] } },
    )

    const traducido = traducirError(original)

    expect(traducido.status).toBe(409)
    expect(traducido.code).toBe('DUPLICATE_BARCODE')
    sinFugas(traducido.message, 'El error traducido')
    // El original se conserva para el log del servidor, no para la respuesta.
    expect(traducido.cause).toBe(original)
  })

  it('un codigo de Prisma no catalogado da 500 generico', async () => {
    const { traducirError } = await import('@/server/http/prismaErrors')
    const { Prisma } = await import('@prisma/client')

    const original = new Prisma.PrismaClientKnownRequestError(
      'Algo muy especifico del motor con la tabla "Sale" y la columna "total"',
      { code: 'P9999', clientVersion: '6.19.3' },
    )

    const traducido = traducirError(original)
    expect(traducido.status).toBe(500)
    expect(traducido.code).toBe('DATABASE')
    sinFugas(traducido.message, 'El error de codigo desconocido')
  })

  it('una excepcion cualquiera da 500 sin su mensaje', async () => {
    const { traducirError } = await import('@/server/http/prismaErrors')

    const traducido = traducirError(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 para el usuario kiosco_prod'),
    )

    expect(traducido.status).toBe(500)
    expect(traducido.code).toBe('INTERNAL')
    expect(traducido.message).toBe('Error interno del servidor')
    expect(traducido.message).not.toContain('10.0.0.5')
    expect(traducido.message).not.toContain('kiosco_prod')
  })

  it('un cuerpo que no es JSON da 400, no 500', async () => {
    const res = await invocar('@/app/api/sales/route', 'POST', '/api/sales', {
      cookie: await sessionCookie(fx.cajero),
      rawBody: '{esto no es json',
    })

    expect(res.status).toBe(400)
    sinFugas(res.text, 'El cuerpo mal formado')
  })

  it('un detalle de validacion no repite el valor recibido', async () => {
    // Si el detalle copiara el valor, una contrasena mal escrita terminaria
    // en el log del servidor y en la respuesta.
    const res = await invocar('@/app/api/users/route', 'POST', '/api/users', {
      cookie: await sessionCookie(fx.admin),
      body: {
        username: 'nuevo',
        name: 'Nuevo',
        password: 'corta',
        roleId: 1,
      },
    })

    expect(res.status).toBe(400)
    expect(res.text).not.toContain('corta')
  })
})

describe('Sesiones revocadas y usuarios dados de baja', () => {
  it('una cookie valida deja de servir despues del logout', async () => {
    const cookie = await sessionCookie(fx.cajero)

    const antes = await invocar('@/app/api/products/route', 'GET', '/api/products', { cookie })
    expect(antes.status).toBe(200)

    await invocar('@/app/api/auth/logout/route', 'POST', '/api/auth/logout', { cookie })

    const despues = await invocar('@/app/api/products/route', 'GET', '/api/products', { cookie })
    expect(
      despues.status,
      'La cookie sigue sirviendo despues de cerrar sesion: la revocacion es del lado del servidor',
    ).toBe(401)
  })

  it('un usuario dado de baja pierde acceso aunque su token siga vigente', async () => {
    const cookie = await sessionCookie(fx.cajero)
    expect(
      (await invocar('@/app/api/products/route', 'GET', '/api/products', { cookie })).status,
    ).toBe(200)

    await prisma.user.update({ where: { id: fx.cajero.id }, data: { isActive: false } })

    const res = await invocar('@/app/api/products/route', 'GET', '/api/products', { cookie })
    expect(res.status).toBe(401)
  })

  it('un token con firma invalida se rechaza', async () => {
    const valido = await sessionCookie(fx.cajero)
    // Se altera el ultimo caracter de la firma.
    const alterado = valido.slice(0, -1) + (valido.endsWith('A') ? 'B' : 'A')

    const res = await invocar('@/app/api/products/route', 'GET', '/api/products', {
      cookie: alterado,
    })
    expect(res.status).toBe(401)
  })

  it('una cookie con basura no rompe el servidor', async () => {
    const res = await invocar('@/app/api/products/route', 'GET', '/api/products', {
      cookie: rawCookie('no-es-un-token'),
    })
    expect(res.status).toBe(401)
    expect(errorDe(res).code).toBe('UNAUTHENTICATED')
  })
})
