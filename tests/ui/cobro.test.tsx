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
 * UX V5: TOTAL, "¿Cómo paga?" con seis botones grandes, RECIBIDO y VUELTO, y
 * CONFIRMAR VENTA. El foco arranca en la forma de pago: las flechas la
 * cambian y Enter la elige y pasa a "Recibido" (o a Confirmar). Sin vuelto
 * que dar, la venta termina sola; con vuelto, se muestra grande.
 *
 * V6: Enter en "Recibido" ya no cobra: pasa a "Confirmar venta", y recien el
 * Enter siguiente registra la venta. Un Enter sostenido o demasiado pegado
 * al anterior no avanza otro paso.
 */

import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DialogoCobro, type PagoParaEnviar } from '@/components/venta/DialogoCobro'
import { pagoDeclarado } from '@/components/venta/cobro'
import { PAUSA_ENTRE_ETAPAS_MS } from '@/components/venta/teclado'
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

function abrirCobro(
  onCobrar: (pagos: PagoParaEnviar[]) => Promise<number>,
  onNuevaVenta: () => void = () => undefined,
) {
  return render(
    <DialogoCobro
      abierto
      lineas={LINEAS}
      total={TOTAL}
      onCerrar={() => undefined}
      onCobrar={onCobrar}
      onNuevaVenta={onNuevaVenta}
    />,
  )
}

/** Lo que hay que esperar entre dos Enter para que el segundo avance otro paso. */
const PAUSA = PAUSA_ENTRE_ETAPAS_MS + 50

const recibido = () => screen.getByLabelText(/^recibido/i)
const confirmar = () => screen.getByRole('button', { name: /^confirmar venta/i })

/** Al abrir, el foco va a la forma de pago (en el cuadro siguiente). */
async function esperarFocoInicial() {
  await waitFor(() => {
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Efectivo' }))
  })
}

describe('Cuando el pago esta declarado', () => {
  const efectivo = { method: 'CASH' as const, importe: '', recibido: '' }
  const efectivoVacio = [efectivo]

  it('el arranque --efectivo, sin importe-- es una suposicion, no una declaracion', () => {
    expect(pagoDeclarado(efectivoVacio, false)).toBe(false)
  })

  it('escribir cuanto recibio, o el importe, alcanza', () => {
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

describe('Lo que se ve', () => {
  it('TOTAL grande y los articulos a un toque', async () => {
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(screen.getByText('TOTAL')).toBeInTheDocument()
    expect(screen.getAllByText(/11\.390/).length).toBeGreaterThan(0)
    expect(screen.getByText('Ver los 2 artículos')).toBeInTheDocument()
    expect(screen.getByText('Yerba mate 1 kg')).toBeInTheDocument()
  })

  it('seis formas de pago grandes, con Mercado Pago y Fiado', async () => {
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    for (const nombre of [
      'Efectivo',
      'Transferencia',
      'Mercado Pago',
      'Débito',
      'Crédito',
      'Fiado',
    ]) {
      expect(screen.getByRole('radio', { name: nombre })).toBeInTheDocument()
    }
    // "Otro" existe pero no ocupa lugar: esta en "Más opciones".
    expect(screen.queryByRole('radio', { name: 'Otro' })).toBeNull()
  })

  it('arranca en efectivo, con el foco en la forma de pago', async () => {
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    const efectivo = screen.getByRole('radio', { name: 'Efectivo' })
    expect(efectivo).toBeChecked()
    await waitFor(() => {
      expect(document.activeElement).toBe(efectivo)
    })
  })

  it('calcula el VUELTO y lo muestra en grande', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.type(recibido(), '15000')

    // 15.000 − 11.390 = 3.610
    await waitFor(() => {
      expect(screen.getByText(/3\.610/)).toBeInTheDocument()
    })
    expect(screen.getByText('VUELTO')).toBeInTheDocument()
    expect(screen.getByText(/3\.610/).className).toMatch(/text-4xl/)
  })

  it('avisa cuando lo recibido no alcanza', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.type(recibido(), '5000')

    await waitFor(() => {
      expect(screen.getByText(/te dio menos que el total/i)).toBeInTheDocument()
    })
    expect(confirmar()).toBeDisabled()
  })

  it('"Recibido" solo aparece con efectivo', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(recibido()).toBeInTheDocument()

    await usuario.click(screen.getByRole('radio', { name: 'Débito' }))
    expect(screen.queryByLabelText(/^recibido/i)).toBeNull()
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
    expect(recibido()).toHaveValue('20.000,00')

    await usuario.click(screen.getByRole('button', { name: /^justo/i }))
    expect(recibido()).toHaveValue('11.390,00')
  })

  it('acepta "15.000" con punto de miles como quince mil', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    await usuario.type(recibido(), '15.000')
    await waitFor(() => {
      expect(screen.getByText(/3\.610/)).toBeInTheDocument()
    })
  })

  it('el cliente aparece solo con Fiado', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(screen.queryByText(/^Cliente/)).toBeNull()
    await usuario.click(screen.getByRole('radio', { name: 'Fiado' }))
    expect(screen.getByText(/^Cliente/)).toBeInTheDocument()
  })
})

describe('Teclado del cobro: flechas recorren, Enter avanza UN paso (V6)', () => {
  it('las flechas cambian la forma de pago y Enter la elige y pasa a "Recibido"', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')
    await esperarFocoInicial()
    await esperar(PAUSA)

    await usuario.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    await usuario.keyboard('{ArrowLeft}')
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeChecked()

    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(document.activeElement).toBe(recibido())
    })
  })

  it('Enter sobre una forma que no es efectivo pasa a Confirmar', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')
    await esperarFocoInicial()
    await esperar(PAUSA)

    await usuario.keyboard('{ArrowRight}')
    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(document.activeElement).toBe(confirmar())
    })
  })

  it('una letra elige la forma de pago, aunque el foco este en "Recibido"', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')
    await esperarFocoInicial()
    recibido().focus()

    await usuario.keyboard('t')
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    expect(screen.queryByLabelText(/^recibido/i)).toBeNull()
    // "Recibido" desaparecio con el foco adentro: el cobro lo lleva a
    // "Confirmar venta" en el cuadro siguiente. Recien ahi la proxima letra
    // tiene donde caer.
    await waitFor(() => {
      expect(document.activeElement).toBe(confirmar())
    })

    await usuario.keyboard('m')
    expect(screen.getByRole('radio', { name: 'Mercado Pago' })).toBeChecked()

    await usuario.keyboard('e')
    expect(screen.getByRole('radio', { name: 'Efectivo' })).toBeChecked()
  })

  it('J pone el importe justo', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')
    await esperarFocoInicial()
    recibido().focus()

    await usuario.keyboard('j')
    expect(recibido()).toHaveValue('11.390,00')
  })

  it('Enter en "Recibido" NO cobra: muestra el vuelto y pasa a "Confirmar venta"', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')

    await usuario.type(recibido(), '15000')
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')

    await waitFor(() => {
      expect(document.activeElement).toBe(confirmar())
    })
    expect(cobrar).not.toHaveBeenCalled()
    expect(screen.getByText(/3\.610/)).toBeInTheDocument()

    // El Enter siguiente, sobre "Confirmar venta", registra la venta.
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')
    await screen.findByText(/venta registrada/i)
    expect(cobrar).toHaveBeenCalledTimes(1)
    const [pagos] = cobrar.mock.calls[0] as unknown as [PagoParaEnviar[]]
    expect(pagos).toEqual([{ method: 'CASH', amount: TOTAL, cashReceived: '15000.00' }])
  })

  it('Enter en "Recibido" vacio pone el importe justo, a la vista, y pasa a Confirmar', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await esperarFocoInicial()
    await esperar(PAUSA)

    // Enter elige Efectivo (eso ya declara el pago) y lleva a Recibido.
    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(document.activeElement).toBe(recibido())
    })
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')

    await waitFor(() => {
      expect(document.activeElement).toBe(confirmar())
    })
    expect(recibido()).toHaveValue('11.390,00')
    expect(cobrar).not.toHaveBeenCalled()
  })

  it('con un importe que no alcanza, Enter no avanza', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')

    await usuario.type(recibido(), '5000')
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')
    await esperar(50)

    expect(document.activeElement).toBe(recibido())
    expect(cobrar).not.toHaveBeenCalled()
  })

  it('Enter no hace nada en los primeros 300 ms', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await esperarFocoInicial()

    // Recien abierto: el Enter que llega pegado al que abrio el cobro no
    // elige la forma de pago.
    await usuario.keyboard('{Enter}')
    await esperar(50)
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Efectivo' }))
    expect(cobrar).not.toHaveBeenCalled()
  })

  it('doble Enter rapido: elige la forma de pago y NO avanza otro paso (caso 19)', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await esperarFocoInicial()
    await esperar(PAUSA)

    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(document.activeElement).toBe(recibido())
    })
    // Pegado al anterior: no pasa a Confirmar ni pone el justo.
    await usuario.keyboard('{Enter}')
    await esperar(50)
    expect(document.activeElement).toBe(recibido())
    expect(recibido()).toHaveValue('')
    expect(cobrar).not.toHaveBeenCalled()
  })

  it('Enter sostenido sobre "Confirmar venta" registra UNA venta (caso 17)', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await usuario.type(recibido(), '15000')
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(document.activeElement).toBe(confirmar())
    })
    await esperar(PAUSA)

    // La tecla apretada: el primer Enter y despues las repeticiones.
    await usuario.keyboard('{Enter}')
    for (let i = 0; i < 5; i++) {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Enter', repeat: true })
    }
    await screen.findByText(/venta registrada/i)
    expect(cobrar).toHaveBeenCalledTimes(1)
  })

  it('el Enter que confirmo no cierra el VUELTO si rebota', async () => {
    const usuario = userEvent.setup()
    const nueva = vi.fn()
    abrirCobro(() => Promise.resolve(9), nueva)
    await screen.findByRole('dialog')
    await usuario.type(recibido(), '15000')
    await usuario.click(confirmar())
    const boton = await screen.findByRole('button', { name: /nueva venta/i })
    boton.focus()

    // Pegado a la confirmacion: el vuelto se queda en pantalla.
    await usuario.keyboard('{Enter}')
    expect(nueva).not.toHaveBeenCalled()
    expect(screen.getByText('VUELTO')).toBeInTheDocument()

    // Pasada la pausa, Enter es "Nueva venta".
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')
    expect(nueva).toHaveBeenCalledOnce()
  })

  it('Enter NO avanza mientras nadie dijo como se paga', async () => {
    // Dos Enter distraidos no pueden terminar en una venta: con el cursor en
    // "Recibido" vacio y sin haber elegido forma de pago, no hay pago
    // declarado, y Enter no avanza por mucho que se espere.
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await esperarFocoInicial()
    recibido().focus()
    await esperar(PAUSA)

    await usuario.keyboard('{Enter}')
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')
    expect(cobrar).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(recibido())
    expect(screen.getByText(/falta decir cómo paga/i)).toBeInTheDocument()

    // En cuanto se declara --J pone el importe justo--, Enter pasa a
    // Confirmar, y el siguiente cobra.
    await usuario.keyboard('j')
    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(document.activeElement).toBe(confirmar())
    })
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(cobrar).toHaveBeenCalledTimes(1)
    })
  })

  it('la ayuda de arriba dice lo que hace Enter en cada paso', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    const dialogo = await screen.findByRole('dialog')
    await esperarFocoInicial()
    const ayuda = () => dialogo.querySelector('[data-ayuda-cobro]')?.textContent ?? ''

    await waitFor(() => {
      expect(ayuda()).toMatch(/forma de pago/)
    })
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(ayuda()).toMatch(/con cuánto paga/)
    })
    await usuario.type(recibido(), '15000')
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(ayuda()).toMatch(/confirmar la venta/)
    })
    expect(ayuda()).toMatch(/volver al carrito/)
  })

  it('el campo "Recibido" no propone el total como si estuviera cargado', async () => {
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(recibido()).toHaveValue('')
    expect(recibido().getAttribute('placeholder')).not.toMatch(/11\.390/)
  })

  it('elegir Mercado Pago lo manda como transferencia con referencia', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    const nueva = vi.fn()
    abrirCobro(cobrar, nueva)
    await screen.findByRole('dialog')
    await esperar(PAUSA)

    await usuario.click(screen.getByRole('radio', { name: 'Mercado Pago' }))
    await usuario.click(confirmar())

    await waitFor(() => {
      expect(cobrar).toHaveBeenCalledTimes(1)
    })
    const [pagos] = cobrar.mock.calls[0] as unknown as [PagoParaEnviar[]]
    expect(pagos).toEqual([{ method: 'TRANSFER', amount: TOTAL, reference: 'Mercado Pago' }])
  })

  it('sin vuelto que dar la venta termina sola: no hay otra pantalla que cerrar', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(9))
    const nueva = vi.fn()
    abrirCobro(cobrar, nueva)
    await screen.findByRole('dialog')
    await esperarFocoInicial()
    await esperar(PAUSA)

    // T elige Transferencia; Enter la confirma y pasa a "Confirmar venta";
    // el segundo Enter confirma la venta.
    await usuario.keyboard('t')
    expect(screen.getByRole('radio', { name: 'Transferencia' })).toBeChecked()
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Transferencia' }))
    })
    await usuario.keyboard('{Enter}')
    await waitFor(() => {
      expect(document.activeElement).toBe(confirmar())
    })
    await esperar(PAUSA)
    await usuario.keyboard('{Enter}')

    await waitFor(() => {
      expect(nueva).toHaveBeenCalledOnce()
    })
    expect(cobrar).toHaveBeenCalledTimes(1)
    expect(screen.queryByText(/^vuelto$/i)).toBeNull()
  })
})

describe('Pago dividido', () => {
  it('esta en "Más opciones" y muestra un renglon por medio', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(1))
    await screen.findByRole('dialog')

    expect(screen.queryByRole('button', { name: /dividir el pago/i })).toBeNull()
    await usuario.click(screen.getByRole('button', { name: /más opciones/i }))
    await usuario.click(screen.getByRole('button', { name: /dividir el pago/i }))

    expect(screen.getByRole('radiogroup', { name: 'Medio del pago 1' })).toBeInTheDocument()
    expect(screen.getByRole('radiogroup', { name: 'Medio del pago 2' })).toBeInTheDocument()

    // El primero se lleva lo que reste: la venta ya esta cubierta.
    expect(screen.getByText(/cubre el total/i)).toBeInTheDocument()

    // Con un importe en el primero, el segundo (sin importe) toma el resto.
    await usuario.type(screen.getByLabelText('Importe del pago 1'), '10000')
    await waitFor(() => {
      expect(confirmar()).toBeEnabled()
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
    const boton = await screen.findByRole('button', { name: /^confirmar venta/i })

    await usuario.click(boton)
    await usuario.click(boton)
    await usuario.click(boton)
    await usuario.click(boton)

    expect(cobrar, 'se registro la venta mas de una vez').toHaveBeenCalledTimes(1)
    resolver(42)
  })

  it('despues de una venta con vuelto el boton de confirmar ya no esta', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi.fn(() => Promise.resolve(42))

    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await usuario.type(recibido(), '15000')
    await usuario.click(confirmar())

    await screen.findByText(/venta registrada/i)
    expect(screen.queryByRole('button', { name: /^confirmar venta/i })).toBeNull()
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

    await usuario.click(await screen.findByRole('button', { name: /^confirmar venta/i }))
    await usuario.keyboard('{Escape}')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    resolver(42)
  })
})

describe('Una venta correcta con vuelto', () => {
  it('muestra numero, total, medio y VUELTO grande', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.resolve(128))
    await screen.findByRole('dialog')

    await usuario.type(recibido(), '15000')
    await usuario.click(confirmar())

    await screen.findByText(/venta registrada/i)
    expect(screen.getByText(/#128/)).toBeInTheDocument()
    expect(screen.getByText('Efectivo')).toBeInTheDocument()
    expect(screen.getByText('VUELTO')).toBeInTheDocument()
    // El vuelto es lo que se lee en voz alta: va en el tamanio mas grande.
    expect(screen.getByText(/3\.610/).className).toMatch(/text-4xl/)
    expect(screen.getByRole('button', { name: /nueva venta/i })).toBeInTheDocument()
  })
})

describe('Una venta rechazada', () => {
  it('un 403 NO se muestra como exito', async () => {
    const usuario = userEvent.setup()
    const nueva = vi.fn()
    const cobrar = vi.fn(() => Promise.reject(new Error('No tiene permiso para registrar ventas')))

    abrirCobro(cobrar, nueva)
    await usuario.click(await screen.findByRole('button', { name: /^confirmar venta/i }))

    await screen.findByRole('alert')
    expect(screen.getByText(/no se registró la venta/i)).toBeInTheDocument()
    expect(screen.getByText(/no tiene permiso para registrar ventas/i)).toBeInTheDocument()

    expect(
      screen.queryByText(/venta registrada/i),
      'un rechazo del servidor se pinto como una venta correcta',
    ).toBeNull()
    expect(nueva, 'un rechazo dejo la caja lista para otra venta').not.toHaveBeenCalled()
  })

  it('un fallo deja reintentar', async () => {
    const usuario = userEvent.setup()
    const cobrar = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('Stock insuficiente'))
      .mockResolvedValueOnce(77)

    abrirCobro(cobrar)
    await screen.findByRole('dialog')
    await usuario.type(recibido(), '15000')
    await usuario.click(confirmar())
    await screen.findByRole('alert')

    await usuario.click(confirmar())
    await screen.findByText(/venta registrada/i)

    expect(cobrar).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/#77/)).toBeInTheDocument()
  })

  it('el mensaje del servidor se muestra tal cual', async () => {
    const usuario = userEvent.setup()
    abrirCobro(() => Promise.reject(new Error('Stock insuficiente de Yerba mate 1 kg')))

    await usuario.click(await screen.findByRole('button', { name: /^confirmar venta/i }))
    await screen.findByRole('alert')

    // El cajero necesita saber QUE falto para resolverlo en el mostrador.
    expect(screen.getByText(/stock insuficiente de yerba mate/i)).toBeInTheDocument()
  })
})
