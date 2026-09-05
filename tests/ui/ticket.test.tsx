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
  return { onSeleccionar, onCantidad, onQuitar, onEditarPeso, onSalir }
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

  it('derecha e izquierda cambian la cantidad de a una unidad', async () => {
    const usuario = userEvent.setup()
    const { onCantidad } = montar()
    grupo().focus()
    await usuario.keyboard('{ArrowRight}')
    expect(onCantidad).toHaveBeenLastCalledWith(1, '3.000')
    await usuario.keyboard('{ArrowLeft}')
    expect(onCantidad).toHaveBeenLastCalledWith(1, '1.000')
  })

  it('en un producto que se pesa, derecha abre el peso en vez de sumar de a uno', async () => {
    const usuario = userEvent.setup()
    const { onCantidad, onEditarPeso } = montar({ seleccionada: 3 })
    grupo().focus()
    await usuario.keyboard('{ArrowRight}')
    expect(onCantidad).not.toHaveBeenCalled()
    expect(onEditarPeso).toHaveBeenCalledWith(3)
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
    const cobrar = screen.getByRole('button', { name: 'Cobrar' })
    expect(cobrar).toBeEnabled()
    expect(screen.queryByText('F12')).toBeNull()
  })
})
