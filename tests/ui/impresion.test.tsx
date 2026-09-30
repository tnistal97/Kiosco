/**
 * @vitest-environment jsdom
 *
 * Ticket termico y area de impresion. V1 comercial.
 *
 * Lo que importa: el papel dice todo lo que tiene que decir --comercio,
 * numero, cajero, lineas, total, medios, vuelto, cliente-- y dice que NO es
 * una factura. Y `window.print()` es lo unico que se llama: sin drivers.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { TicketDeVenta, CierreImpreso, LEYENDA_NO_FISCAL } from '@/components/impresion/Ticket'
import { ticketDeCobro, ticketDeVenta } from '@/components/impresion/datos'
import { AreaDeImpresion } from '@/components/impresion/AreaDeImpresion'
import {
  leerPreferencias,
  guardarPreferencias,
  PREFERENCIAS_POR_DEFECTO,
  CLAVE_PREFERENCIAS,
} from '@/components/impresion/preferencias'
import type { VentaDTO } from '@/modules/sales/dto'

const VENTA: VentaDTO = {
  id: 482,
  date: '2026-09-30T18:12:00.000Z',
  status: 'completed',
  total: '11390.00',
  paymentMethod: 'CASH',
  canceledAt: null,
  cancelReason: null,
  user: { id: 3, name: 'Lucia Bravo' },
  canceledBy: null,
  client: { id: 9, name: 'Juan Pérez' },
  items: [
    {
      id: 1,
      quantity: 2,
      saleUnit: 'UNIT',
      price: '4850.00',
      product: { id: 1, name: 'Yerba mate 1 kg' },
    },
    {
      id: 2,
      quantity: 1,
      saleUnit: 'UNIT',
      price: '1690.00',
      product: { id: 2, name: 'Leche entera 1 L' },
    },
  ],
  payments: [
    { method: 'MERCADO_PAGO', amount: '6000.00', cashReceived: null, changeGiven: null },
    { method: 'CASH', amount: '5390.00', cashReceived: '6000.00', changeGiven: '610.00' },
  ],
}

afterEach(() => {
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('El ticket de venta', () => {
  it('dice todo lo que tiene que decir, y que no es factura', () => {
    const datos = ticketDeVenta(VENTA, { comercio: 'Almacén Don Pepe', textoFinal: '¡Gracias!' })
    render(<TicketDeVenta datos={datos} />)

    const ticket = screen.getByTestId('ticket-de-venta')
    expect(ticket).toHaveTextContent('Almacén Don Pepe')
    expect(ticket).toHaveTextContent('Venta N° 482')
    expect(ticket).toHaveTextContent('Cajero: Lucia Bravo')
    expect(ticket).toHaveTextContent('Cliente: Juan Pérez')
    expect(ticket).toHaveTextContent('2 u.')
    expect(ticket).toHaveTextContent('Yerba mate 1 kg')
    expect(ticket).toHaveTextContent('9.700,00')
    expect(ticket).toHaveTextContent('TOTAL')
    expect(ticket).toHaveTextContent('11.390,00')
    expect(ticket).toHaveTextContent('Mercado Pago')
    expect(ticket).toHaveTextContent('Efectivo')
    expect(ticket).toHaveTextContent('Entregado')
    expect(ticket).toHaveTextContent('6.000,00')
    expect(ticket).toHaveTextContent('Vuelto')
    expect(ticket).toHaveTextContent('610,00')
    expect(ticket).toHaveTextContent('¡Gracias!')
    expect(ticket).toHaveTextContent(LEYENDA_NO_FISCAL)
    expect(ticket).not.toHaveTextContent('ANULADA')
  })

  it('una reimpresion de una venta anulada lo dice arriba de todo', () => {
    const datos = ticketDeVenta({ ...VENTA, status: 'canceled' }, { comercio: 'X', textoFinal: '' })
    render(<TicketDeVenta datos={datos} />)
    expect(screen.getByTestId('ticket-de-venta')).toHaveTextContent('ANULADA')
  })

  it('una venta vieja sin pagos desglosados usa el medio unico', () => {
    const datos = ticketDeVenta({ ...VENTA, payments: [] }, { comercio: 'X', textoFinal: '' })
    expect(datos.pagos).toEqual([{ etiqueta: 'Efectivo', importe: '11390.00' }])
  })

  it('recien cobrada: el carrito y los pagos que se mandaron, con el vuelto', () => {
    const datos = ticketDeCobro({
      comercio: 'Almacén',
      numero: 500,
      fecha: '2026-09-30T18:12:00.000Z',
      cajero: 'Lucia Bravo',
      lineas: [
        {
          productId: 7,
          name: 'Queso cremoso',
          barcode: null,
          price: '8000.00',
          stock: '5.000',
          quantity: '0.425',
          saleUnit: 'KG',
        },
      ],
      total: '3400.00',
      pagos: [
        { method: 'CASH', amount: '3400.00', cashReceived: '5000.00', changeGiven: '1600.00' },
      ],
      cliente: null,
      textoFinal: 'Gracias',
    })
    expect(datos.lineas[0]?.cantidad).toBe('0,425 kg')
    expect(datos.lineas[0]?.subtotal).toBe('3400.00')
    expect(datos.pagos[0]?.vuelto).toBe('1600.00')

    // Se renderiza sin navegador: es un componente de servidor.
    const html = renderToStaticMarkup(<TicketDeVenta datos={datos} />)
    expect(html).toContain('Queso cremoso')
    expect(html).toContain('1.600,00')
  })

  it('el fiado figura como "Fiado"', () => {
    const datos = ticketDeVenta(
      {
        ...VENTA,
        payments: [
          { method: 'ACCOUNT', amount: '11390.00', cashReceived: null, changeGiven: null },
        ],
      },
      { comercio: 'X', textoFinal: '' },
    )
    expect(datos.pagos[0]?.etiqueta).toBe('Fiado')
  })
})

describe('El cierre impreso', () => {
  it('lleva los tres bloques', () => {
    render(
      <CierreImpreso
        datos={{
          comercio: 'Almacén',
          fecha: '30/09/2026',
          impresoEn: '2026-09-30T23:00:00.000Z',
          ventas: { total: '485400.00', operaciones: 91, anuladas: 1 },
          porMedio: [
            { etiqueta: 'Efectivo', cobrado: '210000.00' },
            { etiqueta: 'Mercado Pago', cobrado: '120000.00' },
          ],
          caja: {
            hay: true,
            cajaInicial: '20000.00',
            ventasEnEfectivo: '210000.00',
            ingresos: '8000.00',
            egresos: '15000.00',
            deberiaHaber: '223000.00',
            contado: '222500.00',
            diferencia: '-500.00',
          },
        }}
      />,
    )
    const cierre = screen.getByTestId('cierre-impreso')
    expect(cierre).toHaveTextContent('485.400,00')
    expect(cierre).toHaveTextContent('Mercado Pago')
    expect(cierre).toHaveTextContent('Debería haber')
    expect(cierre).toHaveTextContent('223.000,00')
    expect(cierre).toHaveTextContent('-$ 500,00')
  })
})

describe('Preferencias', () => {
  it('por defecto 80 mm, y lo guardado vuelve', () => {
    expect(leerPreferencias()).toEqual(PREFERENCIAS_POR_DEFECTO)
    guardarPreferencias({ ancho: '58', textoFinal: 'Hasta luego' })
    expect(leerPreferencias()).toEqual({ ancho: '58', textoFinal: 'Hasta luego' })
  })

  it('algo roto en el almacenamiento no rompe la impresion', () => {
    window.localStorage.setItem(CLAVE_PREFERENCIAS, '{"ancho":"120"}')
    expect(leerPreferencias().ancho).toBe('80')
    window.localStorage.setItem(CLAVE_PREFERENCIAS, 'no es json')
    expect(leerPreferencias()).toEqual(PREFERENCIAS_POR_DEFECTO)
  })
})

describe('El area de impresion', () => {
  it('llama a window.print con el contenido en el portal, y avisa al terminar', async () => {
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const terminado = vi.fn()
    guardarPreferencias({ ancho: '58', textoFinal: '' })

    const { rerender } = render(<AreaDeImpresion contenido={null} onTerminado={terminado} />)
    expect(print).not.toHaveBeenCalled()

    rerender(<AreaDeImpresion contenido={<p>hola papel</p>} onTerminado={terminado} />)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30))
    })

    const portal = document.getElementById('impresion')
    expect(portal).not.toBeNull()
    expect(portal).toHaveTextContent('hola papel')
    expect(portal?.querySelector('.hoja-de-impresion')?.getAttribute('data-ancho')).toBe('58')
    expect(print).toHaveBeenCalledTimes(1)

    act(() => {
      window.dispatchEvent(new Event('afterprint'))
    })
    expect(terminado).toHaveBeenCalledTimes(1)
  })
})
