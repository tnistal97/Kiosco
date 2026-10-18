/**
 * Las pantallas de una funcion apagada (UX V5).
 *
 * Quien escribe /stock/lotes a mano en un almacen sin lotes no ve una
 * pantalla a medio dibujar ni un error: el middleware lo lleva a /stock con
 * una redireccion limpia. La API no pasa por aca: sigue respondiendo igual.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'
import { SESSION_COOKIE, signSessionToken } from '@/server/auth/token'

async function pedirConSesion(ruta: string) {
  const token = await signSessionToken({ userId: 1, branchId: 1, role: 'admin', sv: 0 })
  return middleware(
    new NextRequest(`http://127.0.0.1:3099${ruta}`, {
      headers: { host: 'localhost:3000', cookie: `${SESSION_COOKIE}=${token}` },
    }),
  )
}

describe('Funciones apagadas', () => {
  const antes = process.env.KIOSCO_FUNCIONES

  afterEach(() => {
    if (antes === undefined) delete process.env.KIOSCO_FUNCIONES
    else process.env.KIOSCO_FUNCIONES = antes
  })

  it('sin KIOSCO_FUNCIONES, /stock/lotes lleva a /stock', async () => {
    delete process.env.KIOSCO_FUNCIONES
    const res = await pedirConSesion('/stock/lotes/4')
    expect(res.status).toBe(307)
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe('/stock')
  })

  it('sin KIOSCO_FUNCIONES, las pantallas de compras llevan al inicio', async () => {
    delete process.env.KIOSCO_FUNCIONES
    for (const ruta of ['/compras', '/proveedores/2', '/devoluciones']) {
      const res = await pedirConSesion(ruta)
      expect(res.status, ruta).toBe(307)
      expect(new URL(res.headers.get('location') ?? '').pathname, ruta).toBe('/')
    }
  })

  it('la redireccion usa el nombre publico, no la direccion interna', async () => {
    delete process.env.KIOSCO_FUNCIONES
    const res = await pedirConSesion('/stock/lotes')
    expect(res.headers.get('location')).toBe('http://localhost:3000/stock')
  })

  it('con la funcion habilitada, la pantalla se abre', async () => {
    process.env.KIOSCO_FUNCIONES = 'lotes,compras'
    expect((await pedirConSesion('/stock/lotes')).status).toBe(200)
    expect((await pedirConSesion('/compras')).status).toBe(200)
  })

  it('la API no se redirige nunca', async () => {
    delete process.env.KIOSCO_FUNCIONES
    expect((await pedirConSesion('/api/lotes')).status).toBe(200)
  })

  it('el resto de las pantallas no cambia', async () => {
    delete process.env.KIOSCO_FUNCIONES
    for (const ruta of ['/', '/venta', '/stock', '/stock/movimientos', '/inventarios']) {
      expect((await pedirConSesion(ruta)).status, ruta).toBe(200)
    }
  })
})
