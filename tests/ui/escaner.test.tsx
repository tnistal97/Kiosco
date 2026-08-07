/**
 * @vitest-environment jsdom
 *
 * El escaner de codigo de barras.
 *
 * El caso obligatorio de la fase: **el escaner no agrega productos con un
 * dialogo abierto**. Era un bug real — se escaneaba detras de la pantalla de
 * cobro mientras el usuario creia estar confirmando otra cosa — y estas
 * pruebas existen para que no vuelva.
 *
 * Lo otro que se comprueba es lo contrario: que si escuche cuando
 * corresponde, y que no confunda a una persona escribiendo con un lector.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { useBarcodeScanner } from '@/hooks/useBarcodeScanner'
import { Dialog } from '@/components/ui/Dialog'
import { useOverlays, useHayCapaAbierta } from '@/store/overlays'
import { escanear, tipearComoPersona } from './helpers'

beforeEach(() => {
  // El contador de capas es un store global: sin reiniciarlo, una prueba que
  // deja un dialogo abierto rompe la siguiente.
  useOverlays.setState({ abiertas: 0 })
})

/** Pantalla minima con la misma regla que la caja. */
function CajaDePrueba({ onScan }: { onScan: (codigo: string) => void }) {
  const hayCapa = useHayCapaAbierta()
  const [dialogoAbierto, setDialogoAbierto] = useState(false)
  const [editandoCantidad, setEditandoCantidad] = useState(false)

  useBarcodeScanner({ onScan, enabled: !hayCapa && !editandoCantidad })

  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setDialogoAbierto(true)
        }}
      >
        Abrir cobro
      </button>
      <button
        type="button"
        onClick={() => {
          setEditandoCantidad((v) => !v)
        }}
      >
        Alternar edicion
      </button>
      <input aria-label="Otro campo" />

      <Dialog
        open={dialogoAbierto}
        onClose={() => {
          setDialogoAbierto(false)
        }}
        title="Cobrar"
      >
        <p>Confirmá el cobro</p>
      </Dialog>
    </div>
  )
}

describe('El escaner escucha cuando corresponde', () => {
  it('lee un codigo completo', async () => {
    const leido = vi.fn()
    render(<CajaDePrueba onScan={leido} />)

    await act(async () => {
      await escanear('7790001000011')
    })

    expect(leido).toHaveBeenCalledTimes(1)
    expect(leido).toHaveBeenCalledWith('7790001000011')
  })

  it('entrega el codigo una sola vez', async () => {
    const leido = vi.fn()
    render(<CajaDePrueba onScan={leido} />)

    await act(async () => {
      await escanear('7790001000011')
      await escanear('7790001000011')
    })

    expect(leido).toHaveBeenCalledTimes(2)
    // Dos escaneos, dos lecturas: el buffer se vacia al entregar. Si no se
    // vaciara, el segundo llegaria con el codigo duplicado.
    expect(leido.mock.calls[1]?.[0]).toBe('7790001000011')
  })

  it('no confunde a una persona escribiendo con un lector', async () => {
    const leido = vi.fn()
    render(<CajaDePrueba onScan={leido} />)

    await act(async () => {
      await tipearComoPersona('7790001000011')
    })

    expect(leido).not.toHaveBeenCalled()
  })

  it('ignora una rafaga demasiado corta para ser un codigo', async () => {
    const leido = vi.fn()
    render(<CajaDePrueba onScan={leido} />)

    await act(async () => {
      await escanear('12')
    })

    expect(leido).not.toHaveBeenCalled()
  })
})

describe('El escaner se calla cuando molestaria', () => {
  it('NO agrega productos con un dialogo abierto', async () => {
    const usuario = userEvent.setup()
    const leido = vi.fn()
    render(<CajaDePrueba onScan={leido} />)

    await usuario.click(screen.getByRole('button', { name: 'Abrir cobro' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()

    await act(async () => {
      await escanear('7790001000011')
    })

    expect(
      leido,
      'el escaner agrego un producto detras del dialogo de cobro',
    ).not.toHaveBeenCalled()
  })

  it('vuelve a escuchar al cerrar el dialogo', async () => {
    const usuario = userEvent.setup()
    const leido = vi.fn()
    render(<CajaDePrueba onScan={leido} />)

    await usuario.click(screen.getByRole('button', { name: 'Abrir cobro' }))
    await screen.findByRole('dialog')
    await usuario.keyboard('{Escape}')

    // El dialogo se va con una transicion; se espera a que desaparezca.
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    await act(async () => {
      await escanear('7790002000014')
    })

    expect(leido).toHaveBeenCalledWith('7790002000014')
  })

  it('no escucha mientras se edita una cantidad', async () => {
    const usuario = userEvent.setup()
    const leido = vi.fn()
    render(<CajaDePrueba onScan={leido} />)

    await usuario.click(screen.getByRole('button', { name: 'Alternar edicion' }))

    await act(async () => {
      await escanear('7790001000011')
    })

    expect(leido).not.toHaveBeenCalled()
  })

  it('no roba las teclas de otro campo de texto', async () => {
    const leido = vi.fn()
    render(<CajaDePrueba onScan={leido} />)

    const campo = screen.getByLabelText('Otro campo')
    campo.focus()

    await act(async () => {
      await escanear('7790001000011', { destino: campo })
    })

    expect(leido, 'el escaner leyo lo que se estaba escribiendo en un campo').not.toHaveBeenCalled()
  })
})

describe('El contador de capas soporta capas anidadas', () => {
  it('con dos capas abiertas, cerrar una no reactiva el escaner', () => {
    const { registrar } = useOverlays.getState()

    const cerrarPrimera = registrar()
    const cerrarSegunda = registrar()
    expect(useOverlays.getState().abiertas).toBe(2)

    cerrarSegunda()
    // Con un booleano en vez de un contador, aca ya estaria en "sin capas" y
    // el escaner volveria a escuchar con el cajon todavia abierto.
    expect(useOverlays.getState().abiertas).toBe(1)

    cerrarPrimera()
    expect(useOverlays.getState().abiertas).toBe(0)
  })

  it('liberar dos veces la misma capa no deja el contador en negativo', () => {
    const { registrar } = useOverlays.getState()
    const cerrar = registrar()

    cerrar()
    cerrar()

    expect(useOverlays.getState().abiertas).toBe(0)
  })
})
