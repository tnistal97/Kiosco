/**
 * @vitest-environment jsdom
 *
 * Los dos modos de la caja: lector y nombre. UX V3.
 *
 * La regla que importa es una: LA ELECCION DEL EQUIPO NO CAMBIA SOLA. El
 * lector funciona en los dos modos, asi que un escaneo no puede mover el
 * modo; lo unico que lo mueve es una persona tocando el selector.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, renderHook, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SelectorDeModo } from '@/components/venta/SelectorDeModo'
import { useModoDeVenta } from '@/components/venta/useModoDeVenta'

const CLAVE = 'kiosco:venta:modo'

/** Simula el tipo de puntero del equipo. */
function conPuntero(grueso: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((consulta: string) => ({
      matches: consulta.includes('coarse') ? grueso : !grueso,
      media: consulta,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  )
}

describe('La preferencia del equipo', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.unstubAllGlobals()
  })

  it('sin preferencia y con mouse arranca en lector', () => {
    conPuntero(false)
    const { result } = renderHook(() => useModoDeVenta())
    expect(result.current.modo).toBe('lector')
  })

  it('sin preferencia y con el dedo arranca en nombre: ahi casi nunca hay lector', () => {
    conPuntero(true)
    const { result } = renderHook(() => useModoDeVenta())
    expect(result.current.modo).toBe('nombre')
  })

  it('la preferencia guardada gana sobre el tipo de puntero', () => {
    localStorage.setItem(CLAVE, 'lector')
    conPuntero(true)
    const { result } = renderHook(() => useModoDeVenta())
    expect(result.current.modo).toBe('lector')
  })

  it('elegir un modo lo deja guardado en este equipo', () => {
    conPuntero(false)
    const { result } = renderHook(() => useModoDeVenta())
    act(() => {
      result.current.elegir('nombre')
    })
    expect(result.current.modo).toBe('nombre')
    expect(localStorage.getItem(CLAVE)).toBe('nombre')
  })

  it('un valor raro en el almacenamiento no rompe nada', () => {
    localStorage.setItem(CLAVE, 'lo-que-sea')
    conPuntero(false)
    const { result } = renderHook(() => useModoDeVenta())
    expect(result.current.modo).toBe('lector')
  })
})

describe('El selector', () => {
  it('muestra los dos modos y cual esta activo', () => {
    render(<SelectorDeModo modo="lector" onModo={vi.fn()} />)
    const lector = screen.getByRole('radio', { name: /lector/i })
    const nombre = screen.getByRole('radio', { name: /nombre/i })
    expect(lector).toHaveAttribute('aria-checked', 'true')
    expect(nombre).toHaveAttribute('aria-checked', 'false')
  })

  it('cambiar de modo avisa cual', async () => {
    const usuario = userEvent.setup()
    const onModo = vi.fn()
    render(<SelectorDeModo modo="lector" onModo={onModo} />)
    await usuario.click(screen.getByRole('radio', { name: /nombre/i }))
    expect(onModo).toHaveBeenCalledWith('nombre')
  })

  it('es un grupo de opciones, no dos botones sueltos', () => {
    render(<SelectorDeModo modo="nombre" onModo={vi.fn()} />)
    expect(screen.getByRole('radiogroup', { name: 'Modo de venta' })).toBeInTheDocument()
  })
})
