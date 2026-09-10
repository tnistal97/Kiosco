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
 *
 * Desde UX V2 Fase 1 los medios son botones, "paga con" tiene el foco al
 * abrir, hay importes rapidos y Enter cobra: eso tambien se prueba aca.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DialogoCobro, type PagoParaEnviar } from '@/components/venta/DialogoCobro'
import { pagoDeclarado } from '@/components/venta/cobro'
import type { CartLine } from '@/store/cart'
import { sumarMontos } from '@/lib/money'
import { precioPorCantidad } from '@/lib/cantidad'
import { esperar } from './helpers'

const LINEAS: CartLine[] = [
  {
    productId: 1,
    name: 'Yerba mate 1 kg',
    barcode: '7790001000011',
    price: '4850.00',
    stock: '24.000',
    quantity: '2.000',
    saleUnit: 'UNIT' as const,
  },
  {
    productId: 2,
    name: 'Leche entera 1 L',
    barcode: '7790003000017',
    price: '1690.00',
    stock: '30.000',
    quantity: '1.000',
    saleUnit: 'UNIT' as const,
  },
]

// El total se arma con los mismos helpers que usa la caja: si la cuenta
// del navegador cambiara, esta prueba se entera.
const TOTAL = sumarMontos(precioPorCantidad('4850.00', '2.000'), '1690.00')

function abrirCobro(onCobrar: (pagos: PagoParaEnviar[]) => Promise<number>) {
  return render(
    <DialogoCobro
      abierto
      lineas={LINEAS}
      total={TOTAL}
      onCerrar={() => undefined}
      onCobrar={onCobrar}
      onNuevaVenta={() => undefined}
    />,
  )
}

const pagaCon = () => screen.getByLabelText(/^paga con/i)

describe('Cuando el pago esta declarado', () => {
  const efectivo = { method: 'CASH' as const, importe: '', recibido: '' }
  const efectivoVacio = [efectivo]

  it('el arranque --efectivo, sin importe-- es una suposicion, no una declaracion', () => {
    expect(pagoDeclarado(efectivoVacio, false)).toBe(false)
  })

  it('escribir con cuanto paga, o el importe, alcanza', () => {
    expect(pagoDeclarado([{ ...efectivo, recibido: '15000' }], false)).toBe(true)
    expect(pagoDeclarado([{ ...efectivo, importe: '11390' }], false)).toBe(true)
  })

  it('elegir un medio distinto tambien: nadie lo puso ahi por casualidad', () => {
    expect(pagoDeclarado([{ method: 'TRANSFER', importe: '', recibido: '' }], false)).toBe(true)
  })

  it('y volver a efectivo despues de haber elegido sigue siendo una eleccion', () => {
    expect(pagoDeclarado(efectivoVacio, true)).toBe(true)
  })
})

describe('Resumen y vuelto', () => {
  it('muestra las lineas y el total', async () => {
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    // Dos veces cada uno: plegados para el telefono y a la vista en
    // escritorio. Lo que importa es que en escritorio NO haya que desplegar
    // nada para ver lo que se esta por cobrar (V3).
    expect(screen.getAllByText('Yerba mate 1 kg')).toHaveLength(2)
    expect(screen.getAllByText('Leche entera 1 L')).toHaveLength(2)
    expect(screen.getAllByText('2 artículos')).toHaveLength(2)
    expect(screen.getAllByText(/11\.390/).length).toBeGreaterThan(0)
  })

  it('arranca en efectivo, con el foco en "paga con"', async () => {
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeChecked()
    await waitFor(() => {
      expect(document.activeElement).toBe(pagaCon())
    })
  })

  it('calcula el vuelto y lo muestra en grande', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.type(pagaCon(), '15000')

    // 15.000 − 11.390 = 3.610
    await waitFor(() => {
      expect(screen.getByText(/3\.610/)).toBeInTheDocument()
    })
    expect(screen.getByText(/3\.610/).className).toMatch(/text-3xl/)
  })

  it('avisa cuando el monto recibido no alcanza', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.type(pagaCon(), '5000')

    await waitFor(() => {
      expect(screen.getByText(/se recibió menos/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: /^cobrar/i })).toBeDisabled()
  })

  it('el monto recibido solo aparece con efectivo', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(pagaCon()).toBeInTheDocument()

    await usuario.click(screen.getByRole('radio', { name: 'Débito' }))
    expect(screen.queryByLabelText(/^paga con/i)).toBeNull()
  })

  it('propone billetes por encima del total, y "Justo"', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    // 11.390 → 12.000, 15.000 y 20.000: nunca uno por debajo del total.
    expect(screen.getByRole('button', { name: /12\.000/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /15\.000/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /20\.000/ })).toBeInTheDocument()

    await usuario.click(screen.getByRole('button', { name: /20\.000/ }))
    expect(pagaCon()).toHaveValue('20.000,00')

    await usuario.click(screen.getByRole('button', { name: /^justo/i }))
    expect(pagaCon()).toHaveValue('11.390,00')
  })

  it('acepta "15.000" con punto de miles como quince mil', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.type(pagaCon(), '15.000')
    await waitFor(() => {
      expect(screen.getByText(/3\.610/)).toBeInTheDocument()
    })
  })
})

describe('Teclado del cobro', () => {
  it('una letra elige el medio, aunque el foco este en "paga con"', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(document.activeElement).toBe(pagaCon())
    })

    await usuario.keyboard('t')
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    expect(screen.queryByLabelText(/^paga con/i)).toBeNull()

    await usuario.keyboard('e')
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeChecked()
    await waitFor(() => {
      expect(document.activeElement).toBe(pagaCon())
    })
  })

  it('J pone el importe justo', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(document.activeElement).toBe(pagaCon())
    })

    await usuario.keyboard('j')
    expect(pagaCon()).toHaveValue('11.390,00')
  })

  it('Enter en "paga con" cobra', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')

    await usuario.type(pagaCon(), '15000')
    // Los primeros 300 ms no cobran: es lo que separa un Enter a proposito
    // de uno que rebota desde el ticket.
    await esperar(350)
    await usuario.keyboard('{Enter}')

    await screen.findByText(/venta registrada/i)
    expect(cobrar).toHaveBeenCalledTimes(1)
    const [pagos] = cobrar.mock.calls[0] as unknown as [PagoParaEnviar[]]
    expect(pagos).toEqual([{ method: 'CASH', amount: TOTAL, cashReceived: '15000.00' }])
  })

  it('Enter no cobra en los primeros 300 ms', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await waitFor(() => {
      expect(document.activeElement).toBe(pagaCon())
    })

    await usuario.keyboard('{Enter}')
    expect(cobrar).not.toHaveBeenCalled()
  })

  it('Enter NO cobra mientras nadie dijo con cuanto paga', async () => {
    // El caso que mas importa de la V3: dos Enter distraidos desde el
    // buscador no pueden terminar en una venta registrada. El campo esta
    // vacio --lo que se ve en gris es un placeholder-- asi que no hay pago
    // declarado, y Enter no vende por mucho que se espere.
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await esperar(350)

    await usuario.keyboard('{Enter}')
    await usuario.keyboard('{Enter}')
    expect(cobrar).not.toHaveBeenCalled()
    expect(screen.getByText(/falta decir cómo se paga/i)).toBeInTheDocument()

    // Y en cuanto se declara --J pone el importe justo--, cobra.
    await usuario.keyboard('j')
    await usuario.keyboard('{Enter}')
    await screen.findByText(/venta registrada/i)
    expect(cobrar).toHaveBeenCalledTimes(1)
  })

  it('el campo "paga con" no propone el total como si estuviera cargado', async () => {
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(pagaCon()).toHaveValue('')
    expect(pagaCon().getAttribute('placeholder')).not.toMatch(/11\.390/)
    expect(screen.getByText(/sin declarar/i)).toBeInTheDocument()
  })

  it('elegir un medio ya es declarar como se paga: Enter confirma', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await esperar(350)

    await usuario.keyboard('t')
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    await usuario.keyboard('{Enter}')

    await screen.findByText(/venta registrada/i)
    expect(cobrar).toHaveBeenCalledTimes(1)
  })
})

describe('Pago dividido', () => {
  it('muestra un renglon por medio y el pendiente', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.click(screen.getByRole('button', { name: /dividir el pago/i }))

    expect(screen.getByRole('radiogroup', { name: 'Medio del pago 1' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Medio del pago 2' })).toBeInTheDocument()

    // El primero se lleva lo que reste: la venta ya esta cubierta.
    expect(screen.getByText(/cubierto/i)).toBeInTheDocument()

    // Con un importe en el primero, el segundo (sin importe) toma el resto.
    await usuario.type(screen.getByLabelText('Importe del pago 1'), '10000')
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^cobrar/i })).toBeEnabled()
    })
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

    await usuario.type(pagaCon(), '15000')
    await usuario.click(screen.getByRole('button', { name: /^cobrar/i }))

    await screen.findByText(/venta registrada/i)
    expect(screen.getByText(/#128/)).toBeInTheDocument()
    expect(screen.getByText('Efectivo')).toBeInTheDocument()
    expect(screen.getByText(/vuelto/i)).toBeInTheDocument()
    // El vuelto es lo que se lee en voz alta: va en el tamanio mas grande.
    expect(screen.getByText(/3\.610/).className).toMatch(/text-4xl/)
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
