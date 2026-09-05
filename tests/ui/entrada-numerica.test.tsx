/**
 * @vitest-environment jsdom
 *
 * El campo numerico, tecla por tecla.
 *
 * El hallazgo que motiva esto: "0" no entraba donde la pantalla mostraba
 * "0,00". La tabla de `tests/unit/numero-local.test.ts` comprueba QUE se
 * entiende; esto comprueba COMO se comporta el campo mientras alguien lo usa:
 * que no reformatee a cada tecla, que normalice al salir y que diga en
 * castellano que pasa cuando lo escrito no es un numero.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Field } from '@/components/ui/Field'
import {
  NumericInput,
  problemaDeCantidad,
  problemaDeImporte,
  type ModoNumerico,
} from '@/components/ui/NumericInput'
import type { UnidadDeVenta } from '@/modules/products/units'

/** El campo con estado, que es como vive en un formulario. */
function Campo({
  modo = 'dinero',
  unidad,
  inicial = '',
  negativos = false,
  alCambiar,
}: {
  modo?: ModoNumerico
  unidad?: UnidadDeVenta
  inicial?: string
  negativos?: boolean
  alCambiar?: (texto: string, valor: string | null) => void
}) {
  const [texto, setTexto] = useState(inicial)
  return (
    <Field
      label="Importe"
      error={modo === 'cantidad' ? problemaDeCantidad(texto, { unidad }) : problemaDeImporte(texto, { permitirCero: true })} // prettier-ignore
    >
      <NumericInput
        modo={modo}
        unidad={unidad}
        negativos={negativos}
        value={texto}
        onChange={(t, v) => {
          alCambiar?.(t, v)
          setTexto(t)
        }}
      />
    </Field>
  )
}

describe('Mientras se escribe', () => {
  it('NO reformatea a cada tecla: "1," se queda "1,"', async () => {
    const usuario = userEvent.setup()
    render(<Campo />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, '1,')
    // Con "1,00" acá, el cursor saltaría al final y escribir el resto de los
    // centavos sería imposible.
    expect(campo).toHaveValue('1,')

    await usuario.type(campo, '50')
    expect(campo).toHaveValue('1,50')
  })

  it('avisa el valor interpretado sin tocar el texto', async () => {
    const usuario = userEvent.setup()
    const cambios: Array<[string, string | null]> = []
    render(<Campo alCambiar={(t, v) => cambios.push([t, v])} />)

    await usuario.type(screen.getByLabelText('Importe'), '1500')
    expect(cambios[cambios.length - 1]).toEqual(['1500', '1500.00'])
  })

  it('filtra lo que no puede formar parte de un numero', async () => {
    const usuario = userEvent.setup()
    render(<Campo />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, '1a5')
    expect(campo).toHaveValue('15')
  })
})

describe('Al salir del campo', () => {
  it.each([
    ['0', '0,00'],
    ['0,0', '0,00'],
    ['1500', '1.500,00'],
    ['1500,5', '1.500,50'],
    ['1.500', '1.500,00'],
  ])('"%s" queda "%s"', async (escrito, mostrado) => {
    const usuario = userEvent.setup()
    render(<Campo />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, escrito)
    await usuario.tab()
    expect(campo).toHaveValue(mostrado)
  })

  it('el cero escrito a mano vale, y vale lo mismo que "0,00"', async () => {
    const usuario = userEvent.setup()
    const cambios: Array<[string, string | null]> = []
    render(<Campo alCambiar={(t, v) => cambios.push([t, v])} />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, '0')
    const conCero = cambios[cambios.length - 1]?.[1]

    await usuario.clear(campo)
    await usuario.type(campo, '0,00')
    const conDecimales = cambios[cambios.length - 1]?.[1]

    expect(conCero).toBe('0.00')
    expect(conCero).toBe(conDecimales)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('una cantidad sin unidad queda con coma y sin ceros de relleno', async () => {
    const usuario = userEvent.setup()
    render(<Campo modo="cantidad" />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, '1.5')
    await usuario.tab()
    expect(campo).toHaveValue('1,5')
  })

  it('una cantidad en kilos queda con la escala de su unidad', async () => {
    const usuario = userEvent.setup()
    render(<Campo modo="cantidad" unidad="KG" />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, '1,5')
    await usuario.tab()
    expect(campo).toHaveValue('1,500')
  })

  it('una cantidad por unidad queda entera', async () => {
    const usuario = userEvent.setup()
    render(<Campo modo="cantidad" unidad="UNIT" />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, '15')
    await usuario.tab()
    expect(campo).toHaveValue('15')
  })
})

describe('Al volver a entrar', () => {
  it('queda todo seleccionado: tipear reemplaza', async () => {
    const usuario = userEvent.setup()
    render(<Campo inicial="1.500,00" />)
    const campo = screen.getByLabelText<HTMLInputElement>('Importe')

    await usuario.click(campo)
    expect(campo.selectionStart).toBe(0)
    expect(campo.selectionEnd).toBe('1.500,00'.length)

    await usuario.keyboard('2000')
    expect(campo).toHaveValue('2000')
  })

  it('lo que el campo escribio, el campo lo vuelve a leer igual', async () => {
    const usuario = userEvent.setup()
    const cambios: Array<[string, string | null]> = []
    render(<Campo alCambiar={(t, v) => cambios.push([t, v])} />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, '1500,25')
    await usuario.tab()
    expect(campo).toHaveValue('1.500,25')

    // Segunda vuelta: entra, sale y el importe es el mismo.
    await usuario.click(campo)
    await usuario.tab()
    expect(cambios[cambios.length - 1]).toEqual(['1.500,25', '1500.25'])
  })
})

describe('Lo que no es un numero se dice en castellano', () => {
  it.each([
    ['1,2,3', 'Ingresá un número válido.'],
    ['1..2', 'Ingresá un número válido.'],
    ['1.2.3', 'Ingresá un número válido.'],
  ])('"%s" → %s', async (basura, mensaje) => {
    const usuario = userEvent.setup()
    render(<Campo />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, basura)
    expect(screen.getByRole('alert')).toHaveTextContent(mensaje)
    expect(campo).toHaveAttribute('aria-invalid', 'true')
  })

  it('las letras no llegan a ser un error: no se pueden ni tipear', async () => {
    const usuario = userEvent.setup()
    render(<Campo />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, 'abc')
    expect(campo).toHaveValue('')
    // Un campo vacio no es un error: es un campo que todavia no se completo.
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('un importe con tres decimales dice cuantos van', async () => {
    const usuario = userEvent.setup()
    render(<Campo />)
    await usuario.type(screen.getByLabelText('Importe'), '10,555')
    expect(screen.getByRole('alert')).toHaveTextContent('dos decimales')
  })

  it('media unidad en un producto que se cuenta se explica sin hablar de decimales', async () => {
    const usuario = userEvent.setup()
    render(<Campo modo="cantidad" unidad="UNIT" />)
    await usuario.type(screen.getByLabelText('Importe'), '1,5')
    expect(screen.getByRole('alert')).toHaveTextContent('Las unidades van enteras: 1, 2, 3.')
  })

  it('el mismo 1,5 en kilos no molesta a nadie', async () => {
    const usuario = userEvent.setup()
    render(<Campo modo="cantidad" unidad="KG" />)
    await usuario.type(screen.getByLabelText('Importe'), '1,5')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('el signo lo decide el campo', async () => {
    const usuario = userEvent.setup()
    render(<Campo />)
    await usuario.type(screen.getByLabelText('Importe'), '-100')
    // Sin `negativos`, el menos ni siquiera se puede tipear.
    expect(screen.getByLabelText('Importe')).toHaveValue('100')
  })

  it('con negativos habilitados, el menos entra una sola vez y adelante', async () => {
    const usuario = userEvent.setup()
    const cambios: Array<[string, string | null]> = []
    render(<Campo modo="cantidad" negativos alCambiar={(t, v) => cambios.push([t, v])} />)
    const campo = screen.getByLabelText('Importe')

    await usuario.type(campo, '-3')
    expect(campo).toHaveValue('-3')
    expect(cambios[cambios.length - 1]?.[1]).toBe('-3.000')
  })
})

describe('El teclado del telefono', () => {
  it('decimal donde hay decimales, numerico donde no', () => {
    const { rerender } = render(<Campo modo="dinero" />)
    expect(screen.getByLabelText('Importe')).toHaveAttribute('inputmode', 'decimal')

    rerender(<Campo modo="cantidad" unidad="KG" />)
    expect(screen.getByLabelText('Importe')).toHaveAttribute('inputmode', 'decimal')
  })
})

describe('Pegar un importe copiado de otra pantalla', () => {
  it.each(['$ 1.500,00', '1.500,00', '1500,00', '1500.00'])('%s entra igual', async (pegado) => {
    const usuario = userEvent.setup()
    const cambios: Array<[string, string | null]> = []
    render(<Campo alCambiar={(t, v) => cambios.push([t, v])} />)

    const campo = screen.getByLabelText('Importe')
    await usuario.click(campo)
    await usuario.paste(pegado)

    expect(cambios[cambios.length - 1]?.[1]).toBe('1500.00')
  })
})
