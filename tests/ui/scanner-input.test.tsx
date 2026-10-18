/**
 * @vitest-environment jsdom
 *
 * El campo unico del punto de venta. UX V2, Fase 1.
 *
 * Lo que importa: el lector escribe digitos y manda Enter, y eso tiene que
 * llegar como "un codigo" sin ninguna consulta en el medio; las letras son
 * una busqueda; y las teclas de la gramatica se anuncian, no se interpretan.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { ScannerInput, type TeclaDelLector } from '@/components/ui/ScannerInput'

function Campo({
  onKey,
  onCambio,
}: {
  onKey: (tecla: TeclaDelLector, texto: string) => boolean
  onCambio?: (texto: string) => void
}) {
  const [valor, setValor] = useState('')
  return (
    <ScannerInput
      value={valor}
      onValueChange={(t) => {
        setValor(t)
        onCambio?.(t)
      }}
      onKey={onKey}
      status="idle"
      message="Yerba mate 1 kg · agregado"
    />
  )
}

describe('El campo unico', () => {
  it('se marca para que el escucha global no le robe las teclas', () => {
    render(<Campo onKey={() => false} />)
    const campo = screen.getByRole('textbox', { name: /escaneá o buscá/i })
    expect(campo).toHaveAttribute('data-barcode-input')
  })

  it('digitos y Enter llegan como Enter con el codigo entero', async () => {
    const usuario = userEvent.setup()
    const onKey = vi.fn(() => true)
    render(<Campo onKey={onKey} />)

    await usuario.type(screen.getByRole('textbox'), '7790001000011{Enter}')
    expect(onKey).toHaveBeenLastCalledWith('Enter', '7790001000011')
  })

  it('un lector encima de texto con numeros toma el codigo y devuelve lo escrito', async () => {
    const persona = userEvent.setup({ delay: 80 })
    const lector = userEvent.setup({ delay: null })
    const onKey = vi.fn(() => true)
    const onCambio = vi.fn()
    render(<Campo onKey={onKey} onCambio={onCambio} />)
    const campo = screen.getByRole('textbox')

    await persona.type(campo, 'agua 500')
    await lector.type(campo, '7790001000019{Enter}')

    // El codigo es lo que paso el lector, sin el "500" que se habia escrito.
    expect(onKey).toHaveBeenLastCalledWith('Enter', '7790001000019')
    expect(onCambio).toHaveBeenLastCalledWith('agua 500')
  })

  it('numeros escritos a mano y despues una lectura: no se mezclan', async () => {
    const persona = userEvent.setup({ delay: 120 })
    const lector = userEvent.setup({ delay: null })
    const onKey = vi.fn(() => true)
    const onCambio = vi.fn()
    render(<Campo onKey={onKey} onCambio={onCambio} />)
    const campo = screen.getByRole('textbox')

    // Un codigo interno, sin digito verificador: lo decide el ritmo.
    await persona.type(campo, '123')
    await new Promise((r) => setTimeout(r, 300))
    await lector.type(campo, '7790001000011{Enter}')

    expect(onKey).toHaveBeenLastCalledWith('Enter', '7790001000011')
    expect(onCambio).toHaveBeenLastCalledWith('123')
  })

  it('numeros escritos, un clic afuera y despues la lectura: tampoco se mezclan', async () => {
    const persona = userEvent.setup({ delay: 120 })
    const lector = userEvent.setup({ delay: null })
    const onKey = vi.fn(() => true)
    const onCambio = vi.fn()
    render(<Campo onKey={onKey} onCambio={onCambio} />)
    const campo = screen.getByRole('textbox')

    await persona.type(campo, '500')
    // Tocar una categoria saca el foco un instante y lo devuelve.
    campo.blur()
    campo.focus()
    await new Promise((r) => setTimeout(r, 300))
    await lector.type(campo, '7790001000011{Enter}', { skipClick: true })

    expect(onKey).toHaveBeenLastCalledWith('Enter', '7790001000011')
    expect(onCambio).toHaveBeenLastCalledWith('500')
  })

  it('una lectura cortada por una traba sigue siendo un solo codigo', async () => {
    const lector = userEvent.setup({ delay: null })
    const onKey = vi.fn(() => true)
    render(<Campo onKey={onKey} />)
    const campo = screen.getByRole('textbox')

    await lector.type(campo, '77900')
    await new Promise((r) => setTimeout(r, 60))
    await lector.type(campo, '01000019{Enter}')

    expect(onKey).toHaveBeenLastCalledWith('Enter', '7790001000019')
  })

  it('las letras se anuncian como texto, tecla por tecla', async () => {
    const usuario = userEvent.setup()
    const onCambio = vi.fn()
    render(<Campo onKey={() => false} onCambio={onCambio} />)

    await usuario.type(screen.getByRole('textbox'), 'yer')
    expect(onCambio).toHaveBeenLastCalledWith('yer')
  })

  it('las flechas, Escape, Supr, mas y menos se anuncian con lo escrito', async () => {
    const usuario = userEvent.setup()
    const onKey = vi.fn(() => true)
    render(<Campo onKey={onKey} />)
    const campo = screen.getByRole('textbox')
    campo.focus()

    await usuario.keyboard('{ArrowDown}{ArrowUp}{ArrowLeft}{ArrowRight}{Escape}{Delete}+-')
    const teclas = onKey.mock.calls.map((c) => (c as unknown as [TeclaDelLector, string])[0])
    expect(teclas).toEqual([
      'ArrowDown',
      'ArrowUp',
      'ArrowLeft',
      'ArrowRight',
      'Escape',
      'Delete',
      '+',
      '-',
    ])
  })

  it('cuando la pantalla no toma la tecla, el navegador la escribe', async () => {
    const usuario = userEvent.setup()
    render(<Campo onKey={() => false} />)
    const campo = screen.getByRole('textbox')

    // Con `false`, el + y el − quedan escritos: son texto como cualquier otro.
    await usuario.type(campo, '1+2-')
    expect(campo).toHaveValue('1+2-')
  })

  it('cuando la pantalla toma la tecla, no queda escrita', async () => {
    const usuario = userEvent.setup()
    render(<Campo onKey={() => true} />)
    const campo = screen.getByRole('textbox')

    await usuario.type(campo, '12+')
    expect(campo).toHaveValue('12')
  })

  it('anuncia el ultimo resultado a un lector de pantalla', () => {
    render(<Campo onKey={() => false} />)
    expect(screen.getByRole('status')).toHaveTextContent('Yerba mate 1 kg · agregado')
  })
})
