/**
 * @vitest-environment jsdom
 *
 * Foco y teclado.
 *
 * Casos obligatorios de la fase:
 *
 *   - todos los dialogos restauran correctamente el foco;
 *   - el buscador no roba el foco de un formulario;
 *   - la caja se puede usar con el teclado.
 *
 * Un dialogo que no atrapa el foco deja al usuario de teclado tabulando por
 * detras, sobre controles que no ve, mientras cree estar dentro del dialogo.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { Dialog, ConfirmationDialog } from '@/components/ui/Dialog'
import { Drawer } from '@/components/ui/Drawer'
import { QuantityInput } from '@/components/ui/QuantityInput'
import { SearchInput } from '@/components/ui/SearchInput'
import { Field, Input } from '@/components/ui/Field'

function ConDialogo({ dismissible = true }: { dismissible?: boolean }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={() => {
          setAbierto(true)
        }}
      >
        Abrir
      </button>
      <button type="button">Otro boton</button>
      <Dialog
        open={abierto}
        dismissible={dismissible}
        onClose={() => {
          setAbierto(false)
        }}
        title="Confirmar el cobro"
        footer={<button type="button">Aceptar</button>}
      >
        <input aria-label="Monto recibido" />
      </Dialog>
    </div>
  )
}

describe('Dialogos', () => {
  it('devuelve el foco al boton que lo abrio', async () => {
    const usuario = userEvent.setup()
    render(<ConDialogo />)

    const abrir = screen.getByRole('button', { name: 'Abrir' })
    await usuario.click(abrir)
    await screen.findByRole('dialog')

    await usuario.keyboard('{Escape}')
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      expect(document.activeElement).toBe(abrir)
    })
  })

  it('atrapa el foco: tabular no sale del dialogo', async () => {
    const usuario = userEvent.setup()
    render(<ConDialogo />)

    await usuario.click(screen.getByRole('button', { name: 'Abrir' }))
    const dialogo = await screen.findByRole('dialog')

    // Seis tabulaciones: mas que los controles que hay adentro.
    for (let i = 0; i < 6; i++) await usuario.tab()

    expect(
      dialogo.contains(document.activeElement),
      'el foco salio del dialogo: el usuario de teclado quedaria navegando por detras',
    ).toBe(true)
  })

  it('se cierra con Escape', async () => {
    const usuario = userEvent.setup()
    render(<ConDialogo />)

    await usuario.click(screen.getByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog')
    await usuario.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('no se cierra con Escape cuando la operacion esta en curso', async () => {
    const usuario = userEvent.setup()
    render(<ConDialogo dismissible={false} />)

    await usuario.click(screen.getByRole('button', { name: 'Abrir' }))
    await screen.findByRole('dialog')
    await usuario.keyboard('{Escape}')

    // Una venta ya enviada no se abandona a medias.
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('tiene titulo accesible', async () => {
    const usuario = userEvent.setup()
    render(<ConDialogo />)

    await usuario.click(screen.getByRole('button', { name: 'Abrir' }))
    expect(await screen.findByRole('dialog', { name: /confirmar el cobro/i })).toBeInTheDocument()
  })
})

describe('Confirmacion de acciones destructivas', () => {
  function ConConfirmacion({ onConfirm }: { onConfirm: () => Promise<void> }) {
    const [abierto, setAbierto] = useState(true)
    return (
      <ConfirmationDialog
        open={abierto}
        onClose={() => {
          setAbierto(false)
        }}
        onConfirm={onConfirm}
        title="Anular la venta"
        message="No se puede deshacer."
        confirmLabel="Anular"
      />
    )
  }

  it('el foco arranca en Cancelar, no en el boton que destruye', async () => {
    render(<ConConfirmacion onConfirm={() => Promise.resolve()} />)
    await screen.findByRole('dialog')

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }))
    })
  })

  it('un Enter reflejo no destruye nada', async () => {
    const usuario = userEvent.setup()
    const confirmar = vi.fn(() => Promise.resolve())
    render(<ConConfirmacion onConfirm={confirmar} />)
    await screen.findByRole('dialog')

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }))
    })
    await usuario.keyboard('{Enter}')

    expect(confirmar).not.toHaveBeenCalled()
  })

  it('bloquea el doble clic mientras la accion corre', async () => {
    const usuario = userEvent.setup()
    let resolver: () => void = () => undefined
    const confirmar = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolver = r
        }),
    )

    render(<ConConfirmacion onConfirm={confirmar} />)
    const boton = await screen.findByRole('button', { name: 'Anular' })

    await usuario.click(boton)
    await usuario.click(boton)
    await usuario.click(boton)

    expect(confirmar, 'la accion destructiva se disparo mas de una vez').toHaveBeenCalledTimes(1)
    resolver()
  })
})

describe('Cajon lateral', () => {
  it('se cierra con Escape y devuelve el foco', async () => {
    const usuario = userEvent.setup()

    function ConCajon() {
      const [abierto, setAbierto] = useState(false)
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              setAbierto(true)
            }}
          >
            Menu
          </button>
          <Drawer
            open={abierto}
            onClose={() => {
              setAbierto(false)
            }}
            title="Menú"
          >
            <a href="/venta">Venta</a>
          </Drawer>
        </div>
      )
    }

    render(<ConCajon />)
    const abrir = screen.getByRole('button', { name: 'Menu' })
    await usuario.click(abrir)
    await screen.findByRole('dialog', { name: 'Menú' })

    await usuario.keyboard('{Escape}')
    await waitFor(() => {
      expect(document.activeElement).toBe(abrir)
    })
  })
})

describe('El buscador no interfiere con otros campos', () => {
  it('escribir en un formulario no mueve el foco al buscador', async () => {
    const usuario = userEvent.setup()

    render(
      <div>
        <SearchInput label="Buscar productos" value="" onChange={() => undefined} />
        <Field label="Motivo del ajuste">
          <Input />
        </Field>
      </div>,
    )

    const motivo = screen.getByLabelText(/motivo del ajuste/i)
    await usuario.click(motivo)
    await usuario.type(motivo, 'rotura de mercaderia')

    expect(document.activeElement).toBe(motivo)
    expect(motivo).toHaveValue('rotura de mercaderia')
  })
})

describe('Cantidad con el teclado', () => {
  function ConCantidad() {
    const [valor, setValor] = useState(3)
    const editando = useRef(false)
    return (
      <div>
        <QuantityInput
          value={valor}
          max={10}
          onChange={setValor}
          onEditingChange={(e) => {
            editando.current = e
          }}
        />
        <output>{valor}</output>
      </div>
    )
  }

  it('las flechas suben y bajan la cantidad', async () => {
    const usuario = userEvent.setup()
    render(<ConCantidad />)

    const campo = screen.getByLabelText('Cantidad')
    await usuario.click(campo)
    await usuario.keyboard('{ArrowUp}')
    expect(screen.getByRole('status')).toHaveTextContent('4')

    await usuario.keyboard('{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('status')).toHaveTextContent('2')
  })

  it('no baja de uno ni sube del stock', async () => {
    const usuario = userEvent.setup()
    render(<ConCantidad />)

    const campo = screen.getByLabelText('Cantidad')
    await usuario.click(campo)
    await usuario.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(screen.getByRole('status')).toHaveTextContent('1')

    for (let i = 0; i < 20; i++) await usuario.keyboard('{ArrowUp}')
    expect(screen.getByRole('status')).toHaveTextContent('10')
  })

  it('los botones tienen nombre accesible', () => {
    render(<ConCantidad />)
    expect(screen.getByRole('button', { name: /agregar una unidad/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /quitar una unidad/i })).toBeInTheDocument()
  })
})
