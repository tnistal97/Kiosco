/**
 * @vitest-environment jsdom
 *
 * Las fundaciones de layout de UX V2, Fase 1: el contenedor de pagina, la
 * tabla-o-tarjetas y el pie fijo de los dialogos.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { PageContainer } from '@/components/ui/PageContainer'
import { ResponsiveData } from '@/components/ui/ResponsiveData'
import { Dialog } from '@/components/ui/Dialog'
import { Drawer } from '@/components/ui/Drawer'
import { Kbd } from '@/components/ui/Kbd'
import { Button } from '@/components/ui/Button'

describe('PageContainer', () => {
  it('centra, acota y deja margen por omision', () => {
    const { container } = render(
      <PageContainer>
        <p>contenido</p>
      </PageContainer>,
    )
    const raiz = container.firstElementChild
    expect(raiz?.className).toMatch(/mx-auto/)
    expect(raiz?.className).toMatch(/max-w-6xl/)
    expect(raiz?.className).toMatch(/p-gutter/)
    expect(raiz?.className).toMatch(/pb-safe/)
  })

  it('el punto de venta ocupa todo, sin margen ni tope', () => {
    const { container } = render(
      <PageContainer width="operational">
        <p>caja</p>
      </PageContainer>,
    )
    const raiz = container.firstElementChild
    expect(raiz?.className).not.toMatch(/max-w/)
    expect(raiz?.className).not.toMatch(/p-gutter/)
    expect(raiz?.className).toMatch(/h-full/)
  })

  it('las pantallas anchas y angostas tienen su tope', () => {
    const { container, rerender } = render(<PageContainer width="wide">x</PageContainer>)
    expect(container.firstElementChild?.className).toMatch(/max-w-7xl/)
    rerender(<PageContainer width="narrow">x</PageContainer>)
    expect(container.firstElementChild?.className).toMatch(/max-w-3xl/)
  })
})

describe('ResponsiveData', () => {
  it('en un telefono dibuja SOLO las tarjetas, no la tabla escondida', async () => {
    // El `matchMedia` de las pruebas dice siempre "no coincide": un telefono.
    render(
      <ResponsiveData table={<table aria-label="tabla" />} cards={<ul aria-label="tarjetas" />} />,
    )
    await waitFor(() => {
      expect(screen.queryByRole('table')).toBeNull()
    })
    expect(screen.getByRole('list', { name: 'tarjetas' })).toBeInTheDocument()
  })
})

describe('Dialog', () => {
  it('el pie no forma parte de lo que se desplaza', async () => {
    render(
      <Dialog open onClose={() => undefined} title="Cobrar" footer={<Button>Cobrar</Button>}>
        <p>cuerpo</p>
      </Dialog>,
    )
    const dialogo = await screen.findByRole('dialog')
    const pie = screen.getByRole('button', { name: 'Cobrar' }).parentElement
    expect(pie?.className).toMatch(/shrink-0/)
    const cuerpo = screen.getByText('cuerpo').parentElement
    expect(cuerpo?.className).toMatch(/overflow-y-auto/)
    expect(dialogo).toBeInTheDocument()
  })
})

describe('Drawer como hoja inferior', () => {
  it('nace desde abajo, con tirador', async () => {
    render(
      <Drawer open onClose={() => undefined} title="Ticket" side="bottom">
        <p>lineas</p>
      </Drawer>,
    )
    const hoja = await screen.findByRole('dialog', { name: 'Ticket' })
    expect(hoja).toBeInTheDocument()
    expect(
      document.querySelector('[data-headlessui-state] .rounded-t-xl, .rounded-t-xl'),
    ).not.toBeNull()
  })
})

describe('Kbd', () => {
  it('no cambia el nombre accesible del boton', () => {
    render(
      <Button>
        Cobrar
        <Kbd>Enter</Kbd>
      </Button>,
    )
    expect(screen.getByRole('button', { name: 'Cobrar' })).toBeInTheDocument()
    expect(screen.getByText('Enter')).toHaveAttribute('aria-hidden', 'true')
  })
})
