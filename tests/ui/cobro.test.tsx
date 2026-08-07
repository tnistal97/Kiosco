/**
 * @vitest-environment jsdom
 *
 * El cobro.
 *
 * Casos obligatorios de la fase:
 *
 *   - F12 no cobra dos veces;
 *   - una respuesta 403 no muestra exito.
 *
 * Lo primero es dinero de verdad: dos ventas por un mismo cliente descuadran
 * la caja y el stock. Lo segundo es peor de otra manera: si un error se
 * pinta como exito, el cajero cobra y entrega la mercaderia por una venta
 * que no existe.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DialogoCobro } from '@/components/venta/DialogoCobro'
import type { CartLine } from '@/store/cart'
import { multiplicarMonto, sumarMontos } from '@/lib/money'

const LINEAS: CartLine[] = [
  {
    productId: 1,
    name: 'Yerba mate 1 kg',
    barcode: '7790001000011',
    price: '4850.00',
    stock: 24,
    quantity: 2,
  },
  {
    productId: 2,
    name: 'Leche entera 1 L',
    barcode: '7790003000017',
    price: '1690.00',
    stock: 30,
    quantity: 1,
  },
]

// El total se arma con los mismos helpers que usa la caja: si la cuenta
// del navegador cambiara, esta prueba se entera.
const TOTAL = sumarMontos(multiplicarMonto('4850.00', 2), '1690.00')

function abrirCobro(onCobrar: (medio: string) => Promise<number>) {
  return render(
    <DialogoCobro
      abierto
      lineas={LINEAS}
      total={TOTAL}
      onCerrar={() => undefined}
      onCobrar={onCobrar as (m: 'efectivo' | 'tarjeta' | 'mercado_pago') => Promise<number>}
      onNuevaVenta={() => undefined}
    />,
  )
}

describe('Resumen y vuelto', () => {
  it('muestra las lineas y el total', async () => {
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(screen.getByText('Yerba mate 1 kg')).toBeInTheDocument()
    expect(screen.getByText('Leche entera 1 L')).toBeInTheDocument()
    expect(screen.getAllByText(/11\.390/).length).toBeGreaterThan(0)
  })

  it('calcula el vuelto', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/con cuánto paga/i), '15000')

    // 15.000 − 11.390 = 3.610
    await waitFor(() => {
      expect(screen.getByText(/3\.610/)).toBeInTheDocument()
    })
  })

  it('avisa cuando el monto recibido no alcanza', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/con cuánto paga/i), '5000')

    await waitFor(() => {
      expect(screen.getByText(/faltan/i)).toBeInTheDocument()
    })
  })

  it('el monto recibido solo aparece con efectivo', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(screen.getByLabelText(/con cuánto paga/i)).toBeInTheDocument()

    await usuario.click(screen.getByRole('radio', { name: /tarjeta/i }))
    expect(screen.queryByLabelText(/con cuánto paga/i)).toBeNull()
  })
})

describe('Proteccion contra el doble cobro', () => {
  it('varios clics registran UNA sola venta', async () => {
    const usuario = userEvent.setup()
    let resolver: (id: number) => void = () => undefined
    const cobrar = vi.fn(
      () =>
        new Promise<number>((r) => {
          resolver = r
        }),
    )

    abrirCobro(cobrar)
    const boton = await screen.findByRole('button', { name: /^cobrar/i })

    await usuario.click(boton)
    await usuario.click(boton)
    await usuario.click(boton)
    await usuario.click(boton)

    expect(cobrar, 'se registro la venta mas de una vez').toHaveBeenCalledTimes(1)
    resolver(42)
  })

  it('despues de una venta correcta el boton de cobrar ya no esta', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(42))

    abrirCobro(cobrar)
    await usuario.click(await screen.findByRole('button', { name: /^cobrar/i }))

    await screen.findByText(/venta registrada/i)
    expect(screen.queryByRole('button', { name: /^cobrar/i })).toBeNull()
    expect(cobrar).toHaveBeenCalledTimes(1)
  })

  it('mientras la venta esta en vuelo el dialogo no se cierra con Escape', async () => {
    const usuario = userEvent.setup()
    let resolver: (id: number) => void = () => undefined
    abrirCobro(
      () =>
        new Promise<number>((r) => {
          resolver = r
        }),
    )

    await usuario.click(await screen.findByRole('button', { name: /^cobrar/i }))
    await usuario.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    resolver(42)
  })
})

describe('Una venta correcta', () => {
  it('muestra numero, total, medio y vuelto', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(128))
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/con cuánto paga/i), '15000')
    await usuario.click(screen.getByRole('button', { name: /^cobrar/i }))

    await screen.findByText(/venta registrada/i)
    expect(screen.getByText(/#128/)).toBeInTheDocument()
    expect(screen.getByText('Efectivo')).toBeInTheDocument()
    expect(screen.getByText(/vuelto/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /nueva venta/i })).toBeInTheDocument()
  })
})

describe('Una venta rechazada', () => {
  it('un 403 NO se muestra como exito', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.reject(new Error('No tiene permiso para registrar ventas')))

    abrirCobro(cobrar)
    await usuario.click(await screen.findByRole('button', { name: /^cobrar/i }))

    await screen.findByRole('alert')
    expect(screen.getByText(/no se registró la venta/i)).toBeInTheDocument()
    expect(screen.getByText(/no tiene permiso para registrar ventas/i)).toBeInTheDocument()

    expect(
      screen.queryByText(/venta registrada/i),
      'un rechazo del servidor se pinto como una venta correcta',
    ).toBeNull()
  })

  it('un fallo deja reintentar', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('Stock insuficiente'))
      .mockResolvedValueOnce(77)

    abrirCobro(cobrar)
    const boton = await screen.findByRole('button', { name: /^cobrar/i })

    await usuario.click(boton)
    await screen.findByRole('alert')

    await usuario.click(screen.getByRole('button', { name: /^cobrar/i }))
    await screen.findByText(/venta registrada/i)

    expect(cobrar).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/#77/)).toBeInTheDocument()
  })

  it('el mensaje del servidor se muestra tal cual', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.reject(new Error('Stock insuficiente de Yerba mate 1 kg')))

    await usuario.click(await screen.findByRole('button', { name: /^cobrar/i }))
    await screen.findByRole('alert')

    // El cajero necesita saber QUE falto para resolverlo en el mostrador.
    expect(screen.getByText(/stock insuficiente de yerba mate/i)).toBeInTheDocument()
  })
})
