/**
 * @vitest-environment jsdom
 *
 * Cantidades y dinero, como se leen y como se escriben. UX V2, Fase 1.
 *
 * El hallazgo que motiva esto: "Pendiente 30.000 unidad", "Anterior 33.000",
 * "4.000 unidades". En es-AR el punto separa miles, y un repositor leia
 * treinta mil donde habia treinta. Un unico formato, y nunca mas una cadena
 * cruda de tres decimales en pantalla.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { QuantityText, formatQuantity } from '@/components/ui/QuantityText'
import { MoneyInput, montoDesdeTextoLocal, textoLocalDeMonto } from '@/components/ui/MoneyInput'
import {
  formatearCantidadDeCompra,
  formatearCantidadDeCompraConUnidad,
  formatearCantidadParaEditar,
  formatearNumeroDeCantidad,
} from '@/modules/products/units'

describe('Cantidades para leer', () => {
  it('por unidad se muestran enteras: 30, nunca 30.000', () => {
    expect(formatQuantity('30.000', 'UNIT')).toBe('30 u.')
    expect(formatQuantity('30.000', 'UNIT', false)).toBe('30')
    expect(formatQuantity('5.000', 'G', false)).toBe('5')
    expect(formatQuantity('1500.000', 'UNIT', false)).toBe('1.500')
  })

  it('por peso llevan coma decimal y tres cifras', () => {
    expect(formatQuantity('1.250', 'KG')).toBe('1,250 kg')
    expect(formatQuantity('2.500', 'L')).toBe('2,500 L')
    expect(formatQuantity('0.425', 'KG', false)).toBe('0,425')
  })

  it('los bultos de compra se cuentan y llevan plural', () => {
    expect(formatQuantity('30.000', 'BOX')).toBe('30 cajas')
    expect(formatQuantity('1.000', 'BOX')).toBe('1 caja')
    expect(formatQuantity('2.000', 'PACK')).toBe('2 packs')
    expect(formatearCantidadDeCompra('2.500', 'BOX')).toBe('2,5')
    expect(formatearCantidadDeCompraConUnidad('12.000', 'UNIT')).toBe('12 u.')
  })

  it('sin unidad va el numero solo, sin ceros de relleno', () => {
    expect(formatQuantity('7.000', null)).toBe('7')
    expect(formatQuantity('0.425')).toBe('0,425')
    expect(formatQuantity('1.500', null)).toBe('1,5')
    expect(formatearNumeroDeCantidad('1250.000')).toBe('1.250')
  })

  it('algo que no es una cantidad se muestra tal cual, sin romper', () => {
    expect(formatQuantity('—', 'UNIT')).toBe('—')
  })

  it('el componente marca la cifra como numerica', () => {
    const { container } = render(<QuantityText value="30.000" unit="UNIT" />)
    expect(screen.getByText('30 u.')).toBeInTheDocument()
    expect(container.querySelector('[data-numeric]')).not.toBeNull()
  })
})

describe('Cantidades para escribir', () => {
  it('sin punto de miles: un 1.500 en un campo se leeria como uno y medio', () => {
    expect(formatearCantidadParaEditar('1500.000', 'UNIT')).toBe('1500')
    expect(formatearCantidadParaEditar('1.250', 'KG')).toBe('1,250')
    expect(formatearCantidadParaEditar('5.000', 'UNIT')).toBe('5')
  })
})

describe('Dinero escrito a mano', () => {
  it('lee lo que se tipea en un mostrador', () => {
    expect(montoDesdeTextoLocal('15000')).toBe('15000.00')
    expect(montoDesdeTextoLocal('15000,50')).toBe('15000.50')
    expect(montoDesdeTextoLocal('15.000,50')).toBe('15000.50')
    expect(montoDesdeTextoLocal('1.234.567')).toBe('1234567.00')
    expect(montoDesdeTextoLocal('15.5')).toBe('15.50')
  })

  it('"15.000" con punto de miles es quince mil, no quince con tres decimales', () => {
    expect(montoDesdeTextoLocal('15.000')).toBe('15000.00')
  })

  it('lo que no es un importe es null, no cero', () => {
    expect(montoDesdeTextoLocal('')).toBeNull()
    expect(montoDesdeTextoLocal('abc')).toBeNull()
    expect(montoDesdeTextoLocal('1,2,3')).toBeNull()
  })

  it('se muestra como en el resto de la aplicacion, sin el simbolo', () => {
    expect(textoLocalDeMonto('1234.56')).toBe('1.234,56')
    expect(textoLocalDeMonto('20000.00')).toBe('20.000,00')
  })

  it('el campo formatea al salir y avisa el importe interpretado', async () => {
    const usuario = userEvent.setup()
    const cambios: Array<[string, string | null]> = []

    function Campo() {
      const [valor, setValor] = useState('')
      return (
        <MoneyInput
          label="Paga con"
          value={valor}
          onChange={(texto, monto) => {
            cambios.push([texto, monto])
            setValor(texto)
          }}
        />
      )
    }

    render(<Campo />)
    const campo = screen.getByLabelText('Paga con')
    await usuario.type(campo, '20000')
    expect(cambios[cambios.length - 1]).toEqual(['20000', '20000.00'])

    await usuario.tab()
    expect(cambios[cambios.length - 1]).toEqual(['20.000,00', '20000.00'])
    expect(campo).toHaveValue('20.000,00')
  })

  it('el campo filtra lo que no puede ser un numero', async () => {
    const usuario = userEvent.setup()
    const onChange = vi.fn()
    render(<MoneyInput label="Importe" value="" onChange={onChange} />)

    await usuario.type(screen.getByLabelText('Importe'), 'a')
    expect(onChange).toHaveBeenCalledWith('', null)
  })

  it('marca como invalido un texto que no es un importe', () => {
    render(<MoneyInput label="Importe" value="1,2,3" onChange={() => undefined} />)
    expect(screen.getByLabelText('Importe')).toHaveAttribute('aria-invalid', 'true')
  })
})
