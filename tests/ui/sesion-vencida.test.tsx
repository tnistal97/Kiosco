/**
 * @vitest-environment jsdom
 *
 * Sesion vencida. UX V2, Fase 2.1.
 *
 * Lo que se prueba es la diferencia que la aplicacion no hacia: un 401 no es
 * "error al cargar productos", es "tenes que volver a entrar". Y volver a
 * entrar no puede costar el lugar donde estaba la persona.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AvisoDeSesionVencida, SesionVencida } from '@/components/shell/SesionVencida'
import { EVENTO_SESION_VENCIDA, ApiError, apiRequest } from '@/lib/api-client'

const rutaActual = vi.hoisted(() => ({ valor: '/venta' }))
vi.mock('next/navigation', () => ({
  usePathname: () => rutaActual.valor,
}))

function enlace(nombre: RegExp): HTMLAnchorElement {
  return screen.getByRole('link', { name: nombre })
}

describe('La pantalla de sesion vencida', () => {
  it('dice que vencio y ofrece volver, conservando a donde iba', () => {
    render(<SesionVencida pathname="/caja/cerrar" />)
    expect(screen.getByText('Tu sesión venció')).toBeInTheDocument()
    expect(enlace(/Volver a ingresar/)).toHaveAttribute('href', '/login?next=%2Fcaja%2Fcerrar')
  })

  it('no arma un destino fuera del sitio', () => {
    render(<SesionVencida pathname="//evil.example/x" />)
    expect(enlace(/Volver a ingresar/)).toHaveAttribute('href', '/login')
  })
})

describe('El aviso, cuando la pantalla ya estaba abierta', () => {
  beforeEach(() => {
    rutaActual.valor = '/venta'
  })

  it('no muestra nada hasta que una consulta contesta 401', () => {
    render(<AvisoDeSesionVencida />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('aparece con el evento y lleva al ingreso con la ruta actual', async () => {
    render(<AvisoDeSesionVencida />)
    window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(enlace(/Volver a ingresar/)).toHaveAttribute('href', '/login?next=%2Fventa')
  })

  it('en el propio ingreso no se dibuja', () => {
    rutaActual.valor = '/login'
    render(<AvisoDeSesionVencida />)
    window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('Quien avisa es el cliente HTTP, una sola vez y para todas las pantallas', () => {
  const original = globalThis.fetch
  let avisos = 0
  const contar = () => {
    avisos += 1
  }

  beforeEach(() => {
    avisos = 0
    window.addEventListener(EVENTO_SESION_VENCIDA, contar)
  })

  afterEach(() => {
    window.removeEventListener(EVENTO_SESION_VENCIDA, contar)
    globalThis.fetch = original
  })

  function respuesta(status: number, code: string) {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code, message: 'no', requestId: 'r1' } }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    ) as typeof fetch
  }

  it('un 401 de cualquier consulta avisa que la sesion vencio', async () => {
    respuesta(401, 'SESSION_EXPIRED')
    await expect(apiRequest('/api/products', { parse: (d) => d })).rejects.toBeInstanceOf(ApiError)
    expect(avisos).toBe(1)
  })

  it('el 401 del ingreso NO avisa: ahi significa "esa contrasena no es"', async () => {
    respuesta(401, 'UNAUTHENTICATED')
    await expect(
      apiRequest('/api/auth/login', { parse: (d) => d, method: 'POST', body: {} }),
    ).rejects.toBeInstanceOf(ApiError)
    expect(avisos).toBe(0)
  })

  it('un 403 tampoco: eso es un permiso que falta, no una sesion vencida', async () => {
    respuesta(403, 'FORBIDDEN')
    await expect(apiRequest('/api/cash', { parse: (d) => d })).rejects.toBeInstanceOf(ApiError)
    expect(avisos).toBe(0)
  })
})
