/**
 * @vitest-environment jsdom
 *
 * "Ventas de hoy", el panel que se abre desde /venta. UX V5.
 *
 * Lo que tiene que garantizar:
 *
 *   - la lista del dia: hora, total, medio de pago, quien cobro y estado;
 *   - al tocar una venta, su detalle completo: productos, cantidades,
 *     precios, total, como se pago, con cuanto y el vuelto;
 *   - Mercado Pago y el pago dividido se nombran como en el mostrador;
 *   - el total del dia en pesos solo para quien ve los reportes de ventas.
 *
 * `apiRequest` se simula. Que la API mande los pagos lo comprueba
 * `tests/integration/ventas-del-dia.test.ts` contra la base.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { VentasDeHoy, medioDeLaVenta } from '@/components/venta/VentasDeHoy'
import { GuiaDeTeclado } from '@/components/venta/GuiaDeTeclado'
import { parsePaginaVentas, parseVenta } from '@/modules/sales/dto'
import { renderConSesion, SESION_ADMIN, SESION_CAJERO } from './helpers'

const peticion = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return { ...real, apiRequest: peticion }
})

/** Tres ventas como las manda `/api/admin/sales`: cantidades en TEXTO, como el servidor. */
const RESPUESTA = {
  data: [
    {
      id: 103,
      // 17:05 UTC = 14:05 en Buenos Aires.
      date: '2026-10-20T17:05:00.000Z',
      status: 'completed',
      total: '4850.00',
      paymentMethod: 'CASH',
      canceledAt: null,
      cancelReason: null,
      user: { id: 3, name: 'Lucia Bravo' },
      canceledBy: null,
      client: null,
      payments: [
        {
          method: 'CASH',
          amount: '2425.00',
          cashReceived: null,
          changeGiven: null,
          reference: null,
        },
        {
          method: 'TRANSFER',
          amount: '2425.00',
          cashReceived: null,
          changeGiven: null,
          reference: 'Mercado Pago',
        },
      ],
      items: [
        {
          id: 7,
          quantity: '1.000',
          saleUnit: 'UNIT',
          price: '4850.00',
          product: { id: 1, name: 'Yerba mate 1 kg' },
        },
      ],
    },
    {
      id: 102,
      date: '2026-10-20T15:30:00.000Z',
      status: 'completed',
      total: '3450.00',
      paymentMethod: 'TRANSFER',
      canceledAt: null,
      cancelReason: null,
      user: { id: 1, name: 'Ana Duarte' },
      canceledBy: null,
      client: null,
      payments: [
        {
          method: 'TRANSFER',
          amount: '3450.00',
          cashReceived: null,
          changeGiven: null,
          reference: 'Mercado Pago',
        },
      ],
      items: [
        {
          id: 6,
          quantity: '1.000',
          saleUnit: 'UNIT',
          price: '3450.00',
          product: { id: 2, name: 'Gaseosa cola 2.25 L' },
        },
      ],
    },
    {
      id: 101,
      date: '2026-10-20T12:10:00.000Z',
      status: 'completed',
      total: '14600.00',
      paymentMethod: 'CASH',
      canceledAt: null,
      cancelReason: null,
      user: { id: 3, name: 'Lucia Bravo' },
      canceledBy: null,
      client: null,
      payments: [
        {
          method: 'CASH',
          amount: '14600.00',
          cashReceived: '20000.00',
          changeGiven: '5400.00',
          reference: null,
        },
      ],
      items: [
        {
          id: 4,
          quantity: '2.000',
          saleUnit: 'UNIT',
          price: '4850.00',
          product: { id: 1, name: 'Yerba mate 1 kg' },
        },
        {
          id: 5,
          quantity: '0.500',
          saleUnit: 'KG',
          price: '9800.00',
          product: { id: 3, name: 'Queso cremoso' },
        },
      ],
    },
  ],
  pagination: { page: 1, pageSize: 50, total: 3, totalPages: 1 },
  totales: { ventas: 3, anuladas: 0, recaudado: '22900.00' },
}

beforeEach(() => {
  peticion.mockReset()
  // La API de verdad aplica `parse`; la simulada tambien, para que el panel
  // reciba lo mismo que en la aplicacion.
  peticion.mockImplementation((_url: string, opciones: { parse: (r: unknown) => unknown }) =>
    Promise.resolve(opciones.parse(RESPUESTA)),
  )
})

function abrir(sesion = SESION_ADMIN) {
  return renderConSesion(<VentasDeHoy abierto onCerrar={() => undefined} />, sesion)
}

describe('La lista del dia', () => {
  it('pide las ventas de HOY, todas, anuladas incluidas', async () => {
    abrir()
    await screen.findByRole('list', { name: 'Ventas de hoy' })

    const url = String(peticion.mock.calls[0]?.[0])
    expect(url).toMatch(/^\/api\/admin\/sales\?/)
    const params = new URLSearchParams(url.split('?')[1])
    expect(params.get('start')).toBe(params.get('end'))
    expect(params.get('estado')).toBe('todas')
  })

  it('cada venta dice hora, medio, quien cobro, estado y total', async () => {
    abrir()
    const lista = await screen.findByRole('list', { name: 'Ventas de hoy' })
    const filas = within(lista).getAllByRole('button')
    expect(filas).toHaveLength(3)

    const primera = filas[0]
    expect(primera).toHaveTextContent('14:05')
    expect(primera).toHaveTextContent('Efectivo + Mercado Pago')
    expect(primera).toHaveTextContent('Lucia Bravo')
    expect(primera).toHaveTextContent('Vigente')
    expect(primera).toHaveTextContent(/4\.850,00/)

    expect(filas[1]).toHaveTextContent('Mercado Pago')
    expect(filas[1]).not.toHaveTextContent('Transferencia')
  })

  it('el resumen cuenta las ventas y, con permiso, el total vendido', async () => {
    abrir()
    await screen.findByRole('list', { name: 'Ventas de hoy' })
    expect(screen.getByText('Total vendido')).toBeInTheDocument()
    expect(screen.getByText(/22\.900,00/)).toBeInTheDocument()
  })

  it('el cajero ve las ventas pero NO el total del dia en pesos', async () => {
    abrir(SESION_CAJERO)
    await screen.findByRole('list', { name: 'Ventas de hoy' })
    expect(screen.queryByText('Total vendido')).toBeNull()
    expect(screen.queryByText(/22\.900,00/)).toBeNull()
  })

  it('sin ventas lo dice, en vez de una lista vacia', async () => {
    peticion.mockImplementation((_url: string, opciones: { parse: (r: unknown) => unknown }) =>
      Promise.resolve(opciones.parse({ ...RESPUESTA, data: [], totales: { ventas: 0 } })),
    )
    abrir()
    expect(await screen.findByText('Todavía no hay ventas hoy')).toBeInTheDocument()
  })

  it('↓ y ↑ recorren la lista', async () => {
    const usuario = userEvent.setup()
    abrir()
    const lista = await screen.findByRole('list', { name: 'Ventas de hoy' })
    const filas = within(lista).getAllByRole('button')

    filas[0]?.focus()
    await usuario.keyboard('{ArrowDown}')
    expect(filas[1]).toHaveFocus()
    await usuario.keyboard('{End}')
    expect(filas[2]).toHaveFocus()
    await usuario.keyboard('{ArrowUp}')
    expect(filas[1]).toHaveFocus()
  })
})

describe('El detalle de una venta', () => {
  async function abrirDetalle() {
    const usuario = userEvent.setup()
    abrir()
    const lista = await screen.findByRole('list', { name: 'Ventas de hoy' })
    const fila = within(lista)
      .getAllByRole('button')
      .find((b) => b.textContent.includes('#101'))
    if (!fila) throw new Error('No esta la venta 101')
    await usuario.click(fila)
    return { usuario, detalle: await screen.findByRole('article') }
  }

  it('muestra productos, cantidades con su unidad, precios y subtotales', async () => {
    const { detalle } = await abrirDetalle()

    expect(within(detalle).getByRole('heading', { name: 'Venta #101' })).toBeInTheDocument()
    const filas = within(detalle).getAllByRole('row')
    const yerba = filas.find((f) => f.textContent.includes('Yerba mate'))
    const queso = filas.find((f) => f.textContent.includes('Queso cremoso'))

    // La cantidad viene como TEXTO del servidor: "2.000" es dos, no cero.
    expect(yerba).toHaveTextContent('2 u.')
    expect(yerba).toHaveTextContent(/9\.700,00/)
    expect(queso).toHaveTextContent('0,500 kg')
    expect(queso).toHaveTextContent(/4\.900,00/)
    expect(within(detalle).getByRole('row', { name: /^total/i })).toHaveTextContent(/14\.600,00/)
  })

  it('dice como se pago, con cuanto y el vuelto', async () => {
    const { detalle } = await abrirDetalle()
    const pago = within(detalle).getByRole('region', { name: 'Pago' })

    expect(pago).toHaveTextContent('Efectivo')
    expect(pago).toHaveTextContent(/Recibido\s*\$\s*20\.000,00/)
    expect(pago).toHaveTextContent(/Vuelto\s*\$\s*5\.400,00/)
  })

  it('dice quien cobro y la fecha con la hora del local', async () => {
    const { detalle } = await abrirDetalle()
    expect(detalle).toHaveTextContent('Lucia Bravo')
    expect(detalle).toHaveTextContent(/20 de octubre de 2026.*09:10/)
  })

  it('lleva a la venta en el historial, donde se anula', async () => {
    const { detalle } = await abrirDetalle()
    expect(
      within(detalle).getByRole('link', { name: 'Abrir en el historial de ventas' }),
    ).toHaveAttribute('href', '/ventas?venta=101')
  })

  it('"Todas las ventas de hoy" vuelve a la lista, con el foco en esa venta', async () => {
    const { usuario } = await abrirDetalle()
    await usuario.click(screen.getByRole('button', { name: /todas las ventas de hoy/i }))

    const lista = await screen.findByRole('list', { name: 'Ventas de hoy' })
    await waitFor(() => {
      expect(document.activeElement?.textContent).toContain('#101')
    })
    expect(within(lista).getAllByRole('button')).toHaveLength(3)
  })
})

describe('El medio de una venta, en palabras', () => {
  it('un medio, dos medios, Mercado Pago y fiado', () => {
    const venta = parseVenta(RESPUESTA.data[0])
    expect(medioDeLaVenta(venta)).toBe('Efectivo + Mercado Pago')
    expect(medioDeLaVenta({ ...venta, pagos: [] })).toBe('Efectivo')
    expect(
      medioDeLaVenta({
        ...venta,
        pagos: [
          {
            method: 'ACCOUNT',
            amount: '1.00',
            cashReceived: null,
            changeGiven: null,
            reference: null,
          },
        ],
      }),
    ).toBe('Fiado')
  })

  it('la cantidad en texto se lee como numero, y una invalida no rompe la lista', () => {
    const pagina = parsePaginaVentas({
      data: [
        {
          ...RESPUESTA.data[2],
          items: [{ ...RESPUESTA.data[2]?.items[0], quantity: 'no es un numero' }],
        },
      ],
    })
    expect(pagina.data[0]?.items[0]?.quantity).toBe(0)
    expect(parseVenta(RESPUESTA.data[2]).items.map((i) => i.quantity)).toEqual([2, 0.5])
  })
})

describe('La guia de etapas', () => {
  it('marca lo hecho, la etapa actual y lo que falta', () => {
    render(<GuiaDeTeclado etapa="carrito" className="flex" />)

    const actual = document.querySelector('[aria-current="step"]')
    expect(actual).toHaveTextContent('Carrito')
    expect(actual).toHaveAttribute('data-paso', 'actual')
    expect(screen.getByText('Productos').closest('[data-paso]')).toHaveAttribute(
      'data-paso',
      'hecho',
    )
    expect(screen.getByText('Cobro').closest('[data-paso]')).toHaveAttribute(
      'data-paso',
      'pendiente',
    )
  })

  it('cada paso se anuncia con su numero', () => {
    render(<GuiaDeTeclado etapa="productos" className="flex" />)
    expect(screen.getByRole('list', { name: 'Etapas de la venta' })).toHaveTextContent(
      /Paso 1:.*Productos.*Paso 2:.*Carrito.*Paso 3:.*Cobro/,
    )
  })
})
