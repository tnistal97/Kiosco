/**
 * @vitest-environment jsdom
 *
 * Nada tecnico a la vista. UX V2, Fase 1.
 *
 * La auditoria encontro `CASH`, `DEBIT_CARD` y `customer_payment` en Caja y
 * en Ventas (H-05). Esto comprueba que cada codigo que puede llegar a la
 * pantalla tenga su nombre, en un solo lugar, y que lo desconocido se muestre
 * tal cual en vez de desaparecer.
 */

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describirMovimientoDeCaja } from '@/modules/cash/movement-types'
import { medioLegible, tipoDe } from '@/components/caja/MovimientoRow'
import { EstadoBadge, describirEstado } from '@/components/ui/EstadoBadge'
import { PaymentSelector, medioDeTecla } from '@/components/venta/PaymentSelector'
import { sugerenciasDeRecibido } from '@/components/venta/cobro'

describe('Movimientos de caja', () => {
  it('cada tipo tiene su nombre, incluidos los cobros y pagos', () => {
    expect(describirMovimientoDeCaja('sale').etiqueta).toBe('Venta')
    expect(describirMovimientoDeCaja('customer_payment').etiqueta).toBe('Cobro a cliente')
    expect(describirMovimientoDeCaja('supplier_payment').etiqueta).toBe('Pago a proveedor')
    expect(describirMovimientoDeCaja('retiro').tono).toBe('warning')
  })

  it('un tipo desconocido se muestra tal cual, en gris', () => {
    expect(describirMovimientoDeCaja('algo_nuevo')).toEqual({
      etiqueta: 'algo_nuevo',
      glifo: '•',
      tono: 'neutral',
    })
    expect(tipoDe('customer_payment').etiqueta).toBe('Cobro a cliente')
  })

  it('los medios se leen en castellano, tambien los guardados con el vocabulario viejo', () => {
    expect(medioLegible('CASH')).toBe('Efectivo')
    expect(medioLegible('DEBIT_CARD')).toBe('Débito')
    expect(medioLegible('TRANSFER')).toBe('Transferencia')
    expect(medioLegible('efectivo')).toBe('Efectivo')
    expect(medioLegible('MERCADO_PAGO')).toBe('Mercado Pago')
    expect(medioLegible('mercado_pago')).toBe('Mercado Pago')
    expect(medioLegible('tarjeta')).toBe('Tarjeta')
  })
})

describe('Estados', () => {
  it('cada dominio traduce sus codigos', () => {
    expect(describirEstado('compra', 'PARTIALLY_RECEIVED')).toEqual({
      etiqueta: 'Parcial',
      tono: 'warning',
    })
    expect(describirEstado('compra', 'DRAFT').etiqueta).toBe('Borrador')
    expect(describirEstado('inventario', 'COUNTING').etiqueta).toBe('Contando')
    expect(describirEstado('venta', 'canceled')).toEqual({ etiqueta: 'Anulada', tono: 'danger' })
    expect(describirEstado('deuda', 'VENCIDA')).toEqual({ etiqueta: 'Vencida', tono: 'danger' })
  })

  it('un estado desconocido no desaparece', () => {
    expect(describirEstado('compra', 'LO_QUE_SEA')).toEqual({
      etiqueta: 'LO_QUE_SEA',
      tono: 'neutral',
    })
  })

  it('el badge lleva glifo ademas de color', () => {
    render(<EstadoBadge dominio="compra" estado="RECEIVED" />)
    expect(screen.getByText('Recibida')).toBeInTheDocument()
    expect(screen.getByText('✓')).toBeInTheDocument()
  })
})

describe('Medios de pago como botones', () => {
  it('es un grupo de opciones con una elegida', () => {
    render(<PaymentSelector value="CASH" onChange={() => undefined} />)
    expect(screen.getByRole('radiogroup', { name: 'Cómo paga' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Fiado' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Mercado Pago' })).toBeInTheDocument()
    // Nunca el codigo.
    expect(screen.queryByText('CASH')).toBeNull()
  })

  it('las flechas recorren el grupo', async () => {
    const usuario = userEvent.setup()
    let valor = 'CASH'
    const { rerender } = render(
      <PaymentSelector
        value="CASH"
        onChange={(m) => {
          valor = m
        }}
      />,
    )
    screen.getByRole('radio', { name: 'Efectivo' }).focus()
    await usuario.keyboard('{ArrowRight}')
    expect(valor).toBe('DEBIT_CARD')
    rerender(<PaymentSelector value="DEBIT_CARD" onChange={() => undefined} />)
    expect(screen.getByRole('radio', { name: 'Débito' })).toBeChecked()
  })

  it('cada medio tiene una letra', () => {
    expect(medioDeTecla('e')).toBe('CASH')
    expect(medioDeTecla('T')).toBe('TRANSFER')
    expect(medioDeTecla('m')).toBe('MERCADO_PAGO')
    expect(medioDeTecla('f')).toBe('ACCOUNT')
    expect(medioDeTecla('x')).toBeNull()
  })
})

describe('Importes rapidos', () => {
  it('propone hasta tres billetes por encima del total, sin repetir', () => {
    expect(sugerenciasDeRecibido('11390.00')).toEqual(['12000.00', '15000.00', '20000.00'])
    expect(sugerenciasDeRecibido('24850.00')).toEqual(['25000.00', '30000.00', '40000.00'])
    expect(sugerenciasDeRecibido('800.00')).toEqual(['1000.00', '5000.00', '10000.00'])
  })

  it('nunca uno igual o menor al total', () => {
    expect(sugerenciasDeRecibido('10000.00')).toEqual(['20000.00', '50000.00', '100000.00'])
    expect(sugerenciasDeRecibido('0.00')).toEqual([])
  })
})
