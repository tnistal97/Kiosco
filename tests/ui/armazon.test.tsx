/**
 * @vitest-environment jsdom
 *
 * El armazon cuando NO hay sesion. UX V2, Fase 2.1.
 *
 * Tres situaciones que se veian iguales --el contenido dibujado sin barra
 * lateral ni cabecera, sin ninguna explicacion-- y que son tres cosas
 * distintas:
 *
 *   /login y /offline   pantallas propias, sin armazon: asi tienen que verse
 *   sin conexion        el service worker sirve la pantalla guardada, y la
 *                       sirve bajo la direccion a la que se quiso ir
 *   sesion vencida      hay que volver a entrar, y decirlo
 *
 * La tercera es la unica que muestra "Tu sesion vencio". Confundirla con la
 * segunda fue un defecto real de esta fase: la comprobacion de la PWA lo
 * encontro --sin red aparecia "Tu sesion vencio" en vez de "Sin conexion"--.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppShell } from '@/components/shell/AppShell'
import { SessionProvider } from '@/components/shell/SessionProvider'

const rutaActual = vi.hoisted(() => ({ valor: '/productos' }))
vi.mock('next/navigation', () => ({
  usePathname: () => rutaActual.valor,
}))

/** El armazon sin sesion, envolviendo una pantalla cualquiera. */
function armar(pathname: string) {
  rutaActual.valor = pathname
  render(
    <SessionProvider session={null}>
      <AppShell>
        <p>Contenido de la pantalla</p>
      </AppShell>
    </SessionProvider>,
  )
}

afterEach(() => {
  document.querySelectorAll('[data-pantalla]').forEach((n) => {
    n.remove()
  })
})

describe('Sin sesion', () => {
  it('en una pantalla cualquiera dice que la sesion venció y ofrece volver', () => {
    armar('/productos')
    expect(screen.getByText('Tu sesión venció')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Volver a ingresar' })).toHaveAttribute(
      'href',
      '/login?next=%2Fproductos',
    )
    expect(screen.queryByText('Contenido de la pantalla')).toBeNull()
  })

  it('en el ingreso no se mete: esa pantalla se dibuja sola', () => {
    armar('/login')
    expect(screen.getByText('Contenido de la pantalla')).toBeInTheDocument()
    expect(screen.queryByText('Tu sesión venció')).toBeNull()
  })

  it('con la pantalla de sin conexión en el documento, no dice que venció', () => {
    // El service worker guarda el documento de /offline y lo sirve para
    // CUALQUIER direccion: aca la barra dice /productos y lo que se esta
    // mostrando es la pantalla de sin conexion. La marca del documento es lo
    // unico que lo distingue.
    document.body.insertAdjacentHTML('afterbegin', '<div data-pantalla="sin-conexion"></div>')
    armar('/productos')
    expect(screen.getByText('Contenido de la pantalla')).toBeInTheDocument()
    expect(screen.queryByText('Tu sesión venció')).toBeNull()
  })
})
