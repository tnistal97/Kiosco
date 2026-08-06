/**
 * Como invoca Next a los route handlers.
 *
 * Next pasa `{ params }` SOLO a las rutas con segmento dinamico. A las demas
 * --que son casi todas-- las llama con el segundo argumento ausente.
 *
 * `handler()` hacia `await args.params` sin comprobar nada, asi que toda la
 * API respondia 500 en el navegador. Las pruebas no lo vieron porque el
 * ayudante construia siempre un `params` vacio, es decir, probaba una forma
 * de llamada que en produccion no ocurre nunca.
 *
 * Estas pruebas invocan los handlers de las dos maneras reales: sin segundo
 * argumento (ruta estatica) y con la promesa de parametros (ruta dinamica).
 */

import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import { seedFixture, prisma, type Fixture } from '../helpers/db'
import { sessionCookie, type InvocacionReal } from '../helpers/http'

let fx: Fixture

beforeEach(async () => {
  fx = await seedFixture()
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function handlerDe(modulo: string, metodo: string): Promise<InvocacionReal> {
  const mod = (await import(/* @vite-ignore */ modulo)) as Record<string, InvocacionReal>
  const fn = mod[metodo]
  if (!fn) throw new Error(`El modulo ${modulo} no exporta ${metodo}`)
  return fn
}

function pedido(path: string, cookie?: string): NextRequest {
  const headers = new Headers()
  if (cookie) headers.set('cookie', cookie)
  return new NextRequest(new URL(path, 'http://localhost:3000'), { method: 'GET', headers })
}

describe('Rutas sin segmento dinamico: Next no pasa `params`', () => {
  it('GET /api/products responde sin el segundo argumento', async () => {
    const route = await handlerDe('@/app/api/products/route', 'GET')
    // Exactamente como lo llama Next: un solo argumento.
    const res = await route(pedido('/api/products', await sessionCookie(fx.admin)))
    expect(res.status).toBe(200)
  })

  it('GET /api/cash/balance responde sin el segundo argumento', async () => {
    const route = await handlerDe('@/app/api/cash/balance/route', 'GET')
    const res = await route(pedido('/api/cash/balance', await sessionCookie(fx.admin)))
    expect(res.status).toBe(200)
  })

  it('POST /api/auth/login responde sin el segundo argumento', async () => {
    const route = await handlerDe('@/app/api/auth/login/route', 'POST')
    const { __resetLoginAttempts } = await import('@/server/auth/loginAttempts')
    __resetLoginAttempts()

    const req = new NextRequest(new URL('http://localhost:3000/api/auth/login'), {
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
      body: JSON.stringify({ username: fx.admin.username, password: fx.admin.password }),
    })
    const res = await route(req)
    expect(res.status).toBe(200)
  })

  it('un fallo de este tipo no se disfraza de 500 generico', async () => {
    // La comprobacion negativa: si `normalizarParams` volviera a romperse,
    // la respuesta seria 500 y esta prueba lo diria.
    const route = await handlerDe('@/app/api/branches/route', 'GET')
    const res = await route(pedido('/api/branches', await sessionCookie(fx.admin)))
    expect(res.status).not.toBe(500)
  })
})

describe('Rutas con segmento dinamico: `params` llega como promesa', () => {
  it('PUT /api/products/[id] recibe el id', async () => {
    const route = await handlerDe('@/app/api/products/[id]/route', 'PUT')
    const req = new NextRequest(new URL(`http://localhost:3000/api/products/${fx.productoA.id}`), {
      method: 'PUT',
      headers: new Headers({
        'content-type': 'application/json',
        cookie: await sessionCookie(fx.admin),
      }),
      body: JSON.stringify({ name: 'Renombrado por la prueba' }),
    })
    const res = await route(req, { params: Promise.resolve({ id: String(fx.productoA.id) }) })
    expect(res.status).toBe(200)

    const guardado = await prisma.product.findUnique({ where: { id: fx.productoA.id } })
    expect(guardado?.name).toBe('Renombrado por la prueba')
  })
})
