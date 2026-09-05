/**
 * @vitest-environment jsdom
 *
 * El limite de carga. UX V2, Fase 2.1.
 *
 * Es un componente de cuatro lineas, pero lo que promete importa: que quien
 * hace clic vea ALGO enseguida, y que quien no ve la pantalla se entere de que
 * hay algo en curso. Por eso lo que se prueba es el anuncio, no el dibujo.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CargandoPantalla } from '@/components/shell/CargandoPantalla'

describe('Mientras la pantalla se arma', () => {
  it('se anuncia como algo en curso, no como contenido', () => {
    render(<CargandoPantalla />)
    const aviso = screen.getByRole('status')
    expect(aviso).toHaveAttribute('aria-busy', 'true')
  })

  it('lo dice con palabras para quien no ve el esqueleto', () => {
    render(<CargandoPantalla />)
    expect(screen.getByText('Cargando la pantalla')).toBeInTheDocument()
  })
})
