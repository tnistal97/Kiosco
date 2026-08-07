/**
 * @vitest-environment jsdom
 *
 * Anular una venta desde la pantalla.
 *
 * Una anulacion mueve stock y dinero a la vez y no se deshace. Lo que esta
 * pantalla tiene que garantizar:
 *
 *   - explica el efecto ANTES de confirmar;
 *   - exige motivo;
 *   - no se dispara dos veces.
 *
 * Que la anulacion en si sea correcta --stock devuelto, contramovimiento en
 * la caja, la venta que no desaparece-- lo comprueba
 * `tests/integration/sale-cancel.test.ts` contra la base.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DialogoAnular } from '@/components/ventas/DialogoAnular'
import type { VentaDTO } from '@/modules/sales/dto'

const VENTA: VentaDTO = {
  id: 128,
  date: '2026-08-06T14:00:00.000Z',
  status: 'completed',
  total: 11390,
  paymentMethod: 'efectivo',
  canceledAt: null,
  cancelReason: null,
  user: { id: 3, name: 'Lucia Bravo' },
  canceledBy: null,
  items: [
    { id: 1, quantity: 2, price: 4850, product: { id: 1, name: 'Yerba mate 1 kg' } },
    { id: 2, quantity: 1, price: 1690, product: { id: 2, name: 'Leche entera 1 L' } },
  ],
}

/**
 * `apiRequest` se simula: lo que se prueba aca es la pantalla, no el
 * servidor. La peticion de verdad la cubren las pruebas de integracion.
 */
const peticion = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return { ...real, apiRequest: peticion }
})

beforeEach(() => {
  peticion.mockReset()
  peticion.mockResolvedValue(null)
})

describe('Antes de confirmar', () => {
  it('explica que va a pasar', async () => {
    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={() => undefined} />)
    await screen.findByRole('dialog')

    expect(screen.getByText(/queda marcada como anulada/i)).toBeInTheDocument()
    expect(screen.getByText(/vuelve el stock/i)).toBeInTheDocument()
    expect(screen.getByText(/contramovimiento en la caja/i)).toBeInTheDocument()
    expect(screen.getByText(/deja de contar en la recaudación/i)).toBeInTheDocument()
  })

  it('muestra el total que se va a revertir', async () => {
    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={() => undefined} />)
    await screen.findByRole('dialog')
    expect(screen.getByText(/11\.390/)).toBeInTheDocument()
  })

  it('el boton de anular arranca bloqueado: falta el motivo', async () => {
    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={() => undefined} />)
    await screen.findByRole('dialog')

    expect(screen.getByRole('button', { name: /anular la venta/i })).toBeDisabled()
  })

  it('un motivo de una letra no alcanza', async () => {
    const usuario = userEvent.setup()
    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={() => undefined} />)
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/motivo/i), 'x')

    expect(screen.getByRole('button', { name: /anular la venta/i })).toBeDisabled()
    expect(screen.getByText(/escribí al menos unas palabras/i)).toBeInTheDocument()
  })

  it('con motivo suficiente se habilita', async () => {
    const usuario = userEvent.setup()
    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={() => undefined} />)
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/motivo/i), 'El cliente devolvió la mercadería')

    expect(screen.getByRole('button', { name: /anular la venta/i })).toBeEnabled()
  })
})

describe('Al confirmar', () => {
  it('manda el motivo al servidor', async () => {
    const usuario = userEvent.setup()
    const anulada = vi.fn()
    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={anulada} />)
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/motivo/i), 'El cliente devolvió la mercadería')
    await usuario.click(screen.getByRole('button', { name: /anular la venta/i }))

    await waitFor(() => {
      expect(anulada).toHaveBeenCalled()
    })

    expect(peticion).toHaveBeenCalledWith(
      '/api/sales/128/cancel',
      expect.objectContaining({
        method: 'POST',
        body: { reason: 'El cliente devolvió la mercadería' },
      }),
    )
  })

  it('varios clics anulan UNA sola vez', async () => {
    const usuario = userEvent.setup()
    let resolver: () => void = () => undefined
    peticion.mockImplementation(
      () =>
        new Promise<null>((r) => {
          resolver = () => {
            r(null)
          }
        }),
    )

    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={() => undefined} />)
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/motivo/i), 'Error de cobro')
    const boton = screen.getByRole('button', { name: /anular la venta/i })

    await usuario.click(boton)
    await usuario.click(boton)
    await usuario.click(boton)

    expect(peticion, 'la venta se anulo mas de una vez').toHaveBeenCalledTimes(1)
    resolver()
  })

  it('si el servidor rechaza, se muestra el motivo y no se avisa de exito', async () => {
    const usuario = userEvent.setup()
    const anulada = vi.fn()
    peticion.mockRejectedValue(new Error('No tiene permiso para anular ventas'))

    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={anulada} />)
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/motivo/i), 'Error de cobro')
    await usuario.click(screen.getByRole('button', { name: /anular la venta/i }))

    await screen.findByText(/no tiene permiso para anular ventas/i)
    expect(anulada, 'se aviso de una anulacion que el servidor rechazo').not.toHaveBeenCalled()
  })

  it('tras un rechazo se puede reintentar', async () => {
    const usuario = userEvent.setup()
    peticion.mockRejectedValueOnce(new Error('Sin conexión')).mockResolvedValueOnce(null)
    const anulada = vi.fn()

    render(<DialogoAnular venta={VENTA} onCerrar={() => undefined} onAnulada={anulada} />)
    await screen.findByRole('dialog')

    await usuario.type(screen.getByLabelText(/motivo/i), 'Error de cobro')
    await usuario.click(screen.getByRole('button', { name: /anular la venta/i }))
    await screen.findByText(/sin conexión/i)

    await usuario.click(screen.getByRole('button', { name: /anular la venta/i }))
    await waitFor(() => {
      expect(anulada).toHaveBeenCalled()
    })
  })
})

describe('Sin venta seleccionada', () => {
  it('el dialogo no se muestra', () => {
    render(<DialogoAnular venta={null} onCerrar={() => undefined} onAnulada={() => undefined} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
