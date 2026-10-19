/**
 * @vitest-environment jsdom
 *
 * El carrito con una linea elegida. UX V2, Fase 1; teclado V6.
 *
 * Lo que se comprueba es la gramatica cuando el foco esta en el carrito
 * --↑ ↓ eligen linea, → suma una, ← resta una, Enter cobra, Esc vuelve-- y
 * una cosa que la auditoria encontro rota: despues de quitar una linea con
 * Supr, el foco caia al `body` y la caja quedaba sorda (H-06, D15).
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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
      onEditando={() => undefined}
      onVaciar={() => undefined}
      onCobrar={() => undefined}
      onSalir={onSalir}
      puedeCobrar
      {...props}
    />,
  )
  return { onSeleccionar, onCantidad, onAjustar, onQuitar, onSalir }
}

const grupo = () => screen.getByRole('group', { name: 'Líneas del carrito' })

describe('La linea elegida', () => {
  // V5: los controles estan en TODAS las lineas. En la V3 solo aparecian en
  // la elegida, y quien entraba por primera vez no encontraba como llevar dos.
  it('se marca; todas las lineas tienen sus botones de cantidad y Quitar', () => {
    montar()
    const yerba = screen.getByText('Yerba mate 1 kg').closest('li')
    expect(yerba).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('spinbutton', { name: /cantidad de yerba/i })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: /cantidad de leche/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar Yerba mate 1 kg' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Quitar Leche entera 1 L' })).toBeInTheDocument()
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

  it('la linea dice cuanto, en el formato de siempre', () => {
    montar()
    expect(screen.getByRole('spinbutton', { name: /cantidad de yerba/i })).toHaveAttribute(
      'aria-valuetext',
      '2 u.',
    )
    expect(screen.getByRole('spinbutton', { name: /cantidad de queso/i })).toHaveAttribute(
      'aria-valuetext',
      '0,500 kg',
    )
    expect(screen.queryByText('2.000')).toBeNull()
  })
})

describe('Teclado con el foco en el carrito', () => {
  it('abajo y arriba mueven la seleccion', async () => {
    const usuario = userEvent.setup()
    const { onSeleccionar } = montar()
    grupo().focus()
    await usuario.keyboard('{ArrowDown}')
    expect(onSeleccionar).toHaveBeenLastCalledWith(2)
    await usuario.keyboard('{ArrowUp}')
    expect(onSeleccionar).toHaveBeenLastCalledWith(1)
  })

  it('derecha suma EXACTAMENTE una unidad e izquierda resta una (V6)', async () => {
    // El carrito no decide que pasa con la cantidad --si llega a cero se
    // quita, y eso lo sabe la pantalla--: pide el ajuste y ya. La aritmetica
    // sigue siendo la misma funcion pura.
    const usuario = userEvent.setup()
    const { onAjustar, onSeleccionar } = montar()
    grupo().focus()
    await usuario.keyboard('{ArrowRight}')
    expect(onAjustar).toHaveBeenLastCalledWith(YERBA, 1)
    await usuario.keyboard('{ArrowLeft}')
    expect(onAjustar).toHaveBeenLastCalledWith(YERBA, -1)
    expect(onAjustar).toHaveBeenCalledTimes(2)
    // Y no movieron la seleccion: eso es de ↑ ↓.
    expect(onSeleccionar).not.toHaveBeenCalled()
    expect(cantidadAjustada(YERBA, 1)).toBe('3.000')
    expect(cantidadAjustada(YERBA, -1)).toBe('1.000')
  })

  it('+ y - son lo mismo que derecha e izquierda', async () => {
    const usuario = userEvent.setup()
    const { onAjustar } = montar()
    grupo().focus()
    await usuario.keyboard('+')
    expect(onAjustar).toHaveBeenLastCalledWith(YERBA, 1)
    await usuario.keyboard('-')
    expect(onAjustar).toHaveBeenLastCalledWith(YERBA, -1)
  })

  it('derecha sostenida suma UNA, no treinta', async () => {
    const usuario = userEvent.setup()
    const { onAjustar } = montar()
    grupo().focus()
    // Un toque y cuatro repeticiones del teclado (`repeat`, como las manda el
    // navegador con la tecla apretada): solo cuenta el primero.
    await usuario.keyboard('{ArrowRight}')
    for (let i = 0; i < 4; i++) fireEvent.keyDown(grupo(), { key: 'ArrowRight', repeat: true })
    expect(onAjustar).toHaveBeenCalledOnce()
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

  it('Enter avanza al cobro: no cambia ninguna cantidad', async () => {
    const usuario = userEvent.setup()
    const onCobrar = vi.fn()
    const { onAjustar } = montar({ onCobrar })
    grupo().focus()
    await usuario.keyboard('{Enter}')
    expect(onCobrar).toHaveBeenCalledOnce()
    expect(onAjustar).not.toHaveBeenCalled()
  })

  it('Enter avanza al cobro tambien sobre una linea que se pesa (V6)', async () => {
    // En la V5, Enter sobre el queso abria el peso: la misma tecla hacia dos
    // cosas segun la linea. Ahora el peso se corrige con → o ←.
    const usuario = userEvent.setup()
    const onCobrar = vi.fn()
    const { onAjustar } = montar({ seleccionada: 3, onCobrar })
    grupo().focus()
    await usuario.keyboard('{Enter}')
    expect(onCobrar).toHaveBeenCalledOnce()
    expect(onAjustar).not.toHaveBeenCalled()
  })

  it('Enter sostenido abre el cobro UNA vez', async () => {
    const usuario = userEvent.setup()
    const onCobrar = vi.fn()
    montar({ onCobrar })
    grupo().focus()
    await usuario.keyboard('{Enter}')
    for (let i = 0; i < 3; i++) fireEvent.keyDown(grupo(), { key: 'Enter', repeat: true })
    expect(onCobrar).toHaveBeenCalledOnce()
  })

  it('con el foco en la cantidad, las flechas no mueven la seleccion', async () => {
    const usuario = userEvent.setup()
    const { onSeleccionar } = montar()
    screen.getByRole('spinbutton', { name: /cantidad de yerba/i }).focus()
    await usuario.keyboard('{ArrowDown}')
    expect(onSeleccionar).not.toHaveBeenCalled()
  })

  it('Escape vuelve a productos', async () => {
    const usuario = userEvent.setup()
    const { onSalir } = montar()
    grupo().focus()
    await usuario.keyboard('{Escape}')
    expect(onSalir).toHaveBeenCalledOnce()
  })
})

describe('El pie', () => {
  it('muestra el TOTAL y un boton de cobrar que no dice F12', () => {
    montar()
    expect(screen.getByText('TOTAL')).toBeInTheDocument()
    const cobrar = screen.getByRole('button', { name: /^Cobrar/ })
    expect(cobrar).toBeEnabled()
    expect(screen.queryByText('F12')).toBeNull()
  })

  it('el TOTAL es la cifra grande del pie', () => {
    montar()
    const total = screen.getByText('TOTAL').parentElement
    expect(total?.textContent).toContain('16.000,00')
    expect(total?.querySelector('.money')?.className).toContain('text-4xl')
  })

  it('sin ticket, cobrar no se ve como un boton verde apagado', () => {
    montar({ lineas: [], articulos: 0, total: '0.00', puedeCobrar: false })
    const cobrar = screen.getByRole('button', { name: 'Cobrar' })
    expect(cobrar).toBeDisabled()
    expect(cobrar.className).not.toContain('bg-success')
  })

  it('revisando, el panel dice que hacen las teclas', () => {
    montar({ revisando: true })
    expect(screen.getByText(/Revisá el carrito/)).toBeInTheDocument()
    const ayuda = screen.getByText(/Revisá el carrito/).closest('p')
    expect(ayuda?.textContent).toMatch(/revisar/)
    expect(ayuda?.textContent).toMatch(/\+1/)
    expect(ayuda?.textContent).toMatch(/−1/)
    expect(ayuda?.textContent).toMatch(/cobrar/)
    expect(ayuda?.textContent).toMatch(/volver/)
  })

  it('sin revisar no hay ayuda de teclas ocupando lugar', () => {
    montar()
    expect(screen.queryByText(/Revisá el carrito/)).toBeNull()
  })

  it('se llama "Carrito", como la etapa', () => {
    montar()
    expect(screen.getByRole('region', { name: 'Carrito' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /^Carrito/ })).toBeInTheDocument()
  })
})
