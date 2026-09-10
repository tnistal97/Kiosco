/**
 * @vitest-environment jsdom
 *
 * El ticket con una linea elegida. UX V2, Fase 1.
 *
 * Lo que se comprueba es la gramatica cuando el foco esta en el ticket, y
 * una cosa que la auditoria encontro rota: despues de quitar una linea con
 * Supr, el foco caia al `body` y la caja quedaba sorda (H-06, D15).
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Ticket, cantidadAjustada } from '@/components/venta/Ticket'
import type { CartLine } from '@/store/cart'

const YERBA: CartLine = {
  productId: 1,
  name: 'Yerba mate 1 kg',
  barcode: '7790001000011',
  price: '4850.00',
  stock: '24.000',
  quantity: '2.000',
  saleUnit: 'UNIT',
}

const LECHE: CartLine = {
  productId: 2,
  name: 'Leche entera 1 L',
  barcode: '7790003000017',
  price: '1690.00',
  stock: '30.000',
  quantity: '1.000',
  saleUnit: 'UNIT',
}

const QUESO: CartLine = {
  productId: 3,
  name: 'Queso cremoso',
  barcode: null,
  price: '9800.00',
  stock: '5.000',
  quantity: '0.500',
  saleUnit: 'KG',
}

function montar(props: Partial<Parameters<typeof Ticket>[0]> = {}) {
  const onSeleccionar = vi.fn()
  const onCantidad = vi.fn()
  const onAjustar = vi.fn()
  const onQuitar = vi.fn()
  const onEditarPeso = vi.fn()
  const onSalir = vi.fn()
  render(
    <Ticket
      lineas={[YERBA, LECHE, QUESO]}
      total="16000.00"
      articulos={3}
      seleccionada={1}
      onSeleccionar={onSeleccionar}
      onCantidad={onCantidad}
      onAjustar={onAjustar}
      onQuitar={onQuitar}
      onEditarPeso={onEditarPeso}
      onEditando={() => undefined}
      onVaciar={() => undefined}
      onCobrar={() => undefined}
      onSalir={onSalir}
      puedeCobrar
      {...props}
    />,
  )
  return { onSeleccionar, onCantidad, onAjustar, onQuitar, onEditarPeso, onSalir }
}

const grupo = () => screen.getByRole('group', { name: 'Líneas del ticket' })

describe('La linea elegida', () => {
  it('se marca, y es la unica con controles', () => {
    montar()
    const yerba = screen.getByText('Yerba mate 1 kg').closest('li')
    expect(yerba).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('spinbutton', { name: /cantidad de yerba/i })).toBeInTheDocument()
    expect(screen.queryByRole('spinbutton', { name: /cantidad de leche/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Quitar' })).toBeInTheDocument()
  })

  it('se anuncia para quien no la ve', () => {
    montar()
    expect(screen.getByText('Yerba mate 1 kg, 2 u.')).toBeInTheDocument()
  })

  it('se elige con un clic', async () => {
    const usuario = userEvent.setup()
    const { onSeleccionar } = montar()
    await usuario.click(screen.getByText('Leche entera 1 L'))
    expect(onSeleccionar).toHaveBeenCalledWith(2)
  })

  it('la linea dice cuanto por cuanto, en el formato de siempre', () => {
    montar()
    expect(screen.getByText('2 u.')).toBeInTheDocument()
    expect(screen.getByText('0,500 kg')).toBeInTheDocument()
    expect(screen.queryByText('2.000')).toBeNull()
  })
})

describe('Teclado con el foco en el ticket', () => {
  it('abajo y arriba mueven la seleccion', async () => {
    const usuario = userEvent.setup()
    const { onSeleccionar } = montar()
    grupo().focus()
    await usuario.keyboard('{ArrowDown}')
    expect(onSeleccionar).toHaveBeenLastCalledWith(2)
    await usuario.keyboard('{ArrowUp}')
    expect(onSeleccionar).toHaveBeenLastCalledWith(1)
  })

  it('derecha e izquierda piden una unidad mas o menos sobre la elegida', async () => {
    // El ticket no decide que pasa con la cantidad --si llega a cero se quita,
    // y eso lo sabe la pantalla--: pide el ajuste y ya. La aritmetica sigue
    // siendo la misma funcion pura.
    const usuario = userEvent.setup()
    const { onAjustar } = montar()
    grupo().focus()
    await usuario.keyboard('{ArrowRight}')
    expect(onAjustar).toHaveBeenLastCalledWith(YERBA, 1)
    await usuario.keyboard('{ArrowLeft}')
    expect(onAjustar).toHaveBeenLastCalledWith(YERBA, -1)
    expect(cantidadAjustada(YERBA, 1)).toBe('3.000')
    expect(cantidadAjustada(YERBA, -1)).toBe('1.000')
  })

  it('en un producto que se pesa no hay "una unidad mas": se ajusta abriendo el peso', async () => {
    const usuario = userEvent.setup()
    const { onCantidad, onAjustar } = montar({ seleccionada: 3 })
    grupo().focus()
    await usuario.keyboard('{ArrowRight}')
    expect(onCantidad).not.toHaveBeenCalled()
    expect(onAjustar).toHaveBeenCalledWith(QUESO, 1)
    expect(cantidadAjustada(QUESO, 1)).toBeNull()
  })

  it('Supr quita la elegida y el foco NO cae al body', async () => {
    const usuario = userEvent.setup()

    function ConEstado() {
      const [lineas, setLineas] = useState([YERBA, LECHE])
      const [seleccionada, setSeleccionada] = useState<number | null>(1)
      return (
        <Ticket
          lineas={lineas}
          total="11390.00"
          articulos={lineas.length}
          seleccionada={seleccionada}
          onSeleccionar={setSeleccionada}
          onCantidad={() => undefined}
          onAjustar={() => undefined}
          onQuitar={(id) => {
            setLineas((l) => l.filter((x) => x.productId !== id))
            setSeleccionada(2)
          }}
          onEditarPeso={() => undefined}
          onEditando={() => undefined}
          onVaciar={() => undefined}
          onCobrar={() => undefined}
          puedeCobrar
        />
      )
    }

    render(<ConEstado />)
    grupo().focus()
    await usuario.keyboard('{Delete}')

    expect(screen.queryByText('Yerba mate 1 kg')).toBeNull()
    expect(document.activeElement, 'el foco cayo al body').not.toBe(document.body)
    expect(grupo().contains(document.activeElement)).toBe(true)
    expect(screen.getByText('Leche entera 1 L').closest('li')).toHaveAttribute(
      'aria-current',
      'true',
    )
  })

  it('Enter en una linea por unidad lleva el foco a la cantidad', async () => {
    const usuario = userEvent.setup()
    montar()
    grupo().focus()
    await usuario.keyboard('{Enter}')
    expect(document.activeElement).toBe(
      screen.getByRole('spinbutton', { name: /cantidad de yerba/i }),
    )
  })

  it('con el foco en la cantidad, las flechas no mueven la seleccion', async () => {
    const usuario = userEvent.setup()
    const { onSeleccionar } = montar()
    screen.getByRole('spinbutton', { name: /cantidad de yerba/i }).focus()
    await usuario.keyboard('{ArrowDown}')
    expect(onSeleccionar).not.toHaveBeenCalled()
  })

  it('Escape devuelve el foco al lector', async () => {
    const usuario = userEvent.setup()
    const { onSalir } = montar()
    grupo().focus()
    await usuario.keyboard('{Escape}')
    expect(onSalir).toHaveBeenCalledOnce()
  })
})

describe('El pie', () => {
  it('muestra el total y un boton de cobrar que no dice F12', () => {
    montar()
    expect(screen.getByText('Total')).toBeInTheDocument()
    const cobrar = screen.getByRole('button', { name: /^Cobrar/ })
    expect(cobrar).toBeEnabled()
    expect(screen.queryByText('F12')).toBeNull()
  })

  it('el importe va EN el boton: es lo ultimo que se mira antes de cobrar', () => {
    montar()
    const cobrar = screen.getByRole('button', { name: /^Cobrar/ })
    expect(cobrar.textContent).toContain('16.000,00')
  })

  it('sin ticket, cobrar no se ve como un boton verde apagado', () => {
    montar({ lineas: [], articulos: 0, total: '0.00', puedeCobrar: false })
    const cobrar = screen.getByRole('button', { name: 'Cobrar' })
    expect(cobrar).toBeDisabled()
    expect(cobrar.className).not.toContain('bg-success')
  })

  it('revisando, el panel dice que hacen las teclas', () => {
    montar({ revisando: true })
    expect(screen.getByText(/Revisá el ticket/)).toBeInTheDocument()
  })

  it('sin revisar no hay ayuda de teclas ocupando lugar', () => {
    montar()
    expect(screen.queryByText(/Revisá el ticket/)).toBeNull()
  })
})
