/**
 * @vitest-environment jsdom
 *
 * Contrasenas y Configuracion, del lado de la pantalla (P0-A).
 *
 * El servidor es el que decide --eso lo prueba
 * `tests/integration/users-password.test.ts`--. Aca se prueba lo que ve y
 * manda la interfaz: que no se pueda mandar un formulario que el servidor va
 * a rechazar, que la clave temporal se muestre una vez y se olvide al cerrar,
 * y que Configuracion no diga cosas falsas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { CambiarMiClave } from '@/components/usuarios/CambiarMiClave'
import { ResetearClave } from '@/components/usuarios/ResetearClave'
import ConfiguracionPage from '@/app/configuracion/page'
import type { UsuarioDTO } from '@/modules/users/dto'
import { SESION_ADMIN } from './helpers'

const peticion = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return { ...real, apiRequest: peticion }
})

beforeEach(() => {
  peticion.mockReset()
  peticion.mockResolvedValue(null)
})

const LUCIA: UsuarioDTO = {
  id: 7,
  username: 'lucia',
  name: 'Lucia Bravo',
  isActive: true,
  createdAt: '2026-08-06T14:00:00.000Z',
  role: { id: 5, name: 'cajero' },
  branch: { id: 1, name: 'Casa central' },
}

describe('Cambiar la contrasena propia', () => {
  async function completar(actual: string, nueva: string, confirmacion: string) {
    const u = userEvent.setup()
    render(<CambiarMiClave />)
    await u.type(screen.getByLabelText(/Contraseña actual/), actual)
    await u.type(screen.getByLabelText(/^Contraseña nueva/), nueva)
    await u.type(screen.getByLabelText(/Repetí la contraseña nueva/), confirmacion)
    return u
  }

  it('el boton no se habilita si la confirmacion no coincide, y lo dice', async () => {
    await completar('vieja-clave-1', 'nueva-clave-22', 'nueva-clave-2X')
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeDisabled()
    expect(screen.getByText('No coincide con la nueva.')).toBeInTheDocument()
  })

  it('ni con una nueva mas corta que la politica', async () => {
    await completar('vieja-clave-1', 'corta', 'corta')
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeDisabled()
  })

  it('manda las tres y limpia el formulario al terminar', async () => {
    const u = await completar('vieja-clave-1', 'nueva-clave-22', 'nueva-clave-22')
    await u.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    await waitFor(() => {
      expect(peticion).toHaveBeenCalledTimes(1)
    })
    const [ruta, opciones] = peticion.mock.calls[0] as [string, { method: string; body: unknown }]
    expect(ruta).toBe('/api/auth/password')
    expect(opciones.method).toBe('POST')
    expect(opciones.body).toEqual({
      claveActual: 'vieja-clave-1',
      claveNueva: 'nueva-clave-22',
      claveConfirmacion: 'nueva-clave-22',
    })

    await waitFor(() => {
      expect(screen.getByLabelText(/Contraseña actual/)).toHaveValue('')
    })
  })

  it('si el servidor dice que la actual no es, lo muestra y no borra lo escrito', async () => {
    const { ApiError } =
      await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
    peticion.mockRejectedValueOnce(
      new ApiError({
        status: 400,
        code: 'VALIDATION',
        message: 'La contraseña actual no es correcta',
        requestId: 'req-1',
      }),
    )

    const u = await completar('mal-escrita-1', 'nueva-clave-22', 'nueva-clave-22')
    await u.click(screen.getByRole('button', { name: 'Cambiar contraseña' }))

    expect(await screen.findByText('La contraseña actual no es correcta')).toBeInTheDocument()
    expect(screen.getByLabelText(/^Contraseña nueva/)).toHaveValue('nueva-clave-22')
  })
})

describe('Resetear la contrasena de un empleado', () => {
  it('por omision genera una temporal, la muestra una vez y la olvida al cerrar', async () => {
    peticion.mockResolvedValueOnce({ claveTemporal: 'k7mq-4tzp-w9ha' })
    const u = userEvent.setup()
    const onCerrar = vi.fn()
    const { rerender } = render(<ResetearClave usuario={LUCIA} onCerrar={onCerrar} />)

    await screen.findByRole('dialog')
    expect(screen.getByText(/se cierran en el acto las sesiones abiertas/)).toBeInTheDocument()

    await u.click(screen.getByRole('button', { name: 'Resetear' }))

    expect(await screen.findByTestId('clave-temporal')).toHaveTextContent('k7mq-4tzp-w9ha')
    expect(screen.getByText('No se vuelve a mostrar')).toBeInTheDocument()

    const [ruta, opciones] = peticion.mock.calls[0] as [string, { body: unknown }]
    expect(ruta).toBe('/api/users/7/password')
    expect(opciones.body).toEqual({})

    await u.click(screen.getByRole('button', { name: 'Listo' }))
    expect(onCerrar).toHaveBeenCalled()

    // Si el dialogo se vuelve a abrir, la clave anterior ya no esta.
    rerender(<ResetearClave usuario={null} onCerrar={onCerrar} />)
    rerender(<ResetearClave usuario={LUCIA} onCerrar={onCerrar} />)
    await screen.findByRole('dialog')
    expect(screen.queryByText('k7mq-4tzp-w9ha')).not.toBeInTheDocument()
  })

  it('escribirla a mano exige el largo minimo y la manda', async () => {
    // Lo que devuelve `parseReseteo` cuando el servidor no genero ninguna.
    peticion.mockResolvedValueOnce({ claveTemporal: null })
    const u = userEvent.setup()
    render(<ResetearClave usuario={LUCIA} onCerrar={() => undefined} />)
    await screen.findByRole('dialog')

    await u.click(screen.getByLabelText(/Escribirla yo/))
    const resetear = screen.getByRole('button', { name: 'Resetear' })
    expect(resetear).toBeDisabled()

    await u.type(screen.getByLabelText(/^Contraseña nueva/), 'otra-clave-99')
    expect(resetear).toBeEnabled()
    await u.click(resetear)

    await waitFor(() => {
      expect(peticion).toHaveBeenCalledTimes(1)
    })
    const [, opciones] = peticion.mock.calls[0] as [string, { body: unknown }]
    expect(opciones.body).toEqual({ claveNueva: 'otra-clave-99' })
    expect(await screen.findByText('Contraseña cambiada')).toBeInTheDocument()
  })
})

describe('Configuracion', () => {
  function conComercio({ children }: { children: ReactNode }) {
    return (
      <SessionProvider session={SESION_ADMIN} comercio="Almacén Don Pepe">
        {children}
      </SessionProvider>
    )
  }

  it('muestra el nombre que manda el servidor, no uno congelado en el build', () => {
    render(<ConfiguracionPage />, { wrapper: conComercio })
    expect(screen.getByText('Almacén Don Pepe')).toBeInTheDocument()
    expect(screen.getByText(/COMMERCE_NAME/)).toBeInTheDocument()
    expect(screen.queryByText(/NEXT_PUBLIC_COMMERCE_NAME/)).not.toBeInTheDocument()
  })

  it('tiene donde cambiar la contrasena propia', () => {
    render(<ConfiguracionPage />, { wrapper: conComercio })
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeInTheDocument()
  })

  it('"Lo que todavia no esta" ya no nombra lo que existe', () => {
    render(<ConfiguracionPage />, { wrapper: conComercio })
    for (const falso of [
      /Turnos de caja con apertura y cierre/,
      /Compras, proveedores y clientes/,
      /Cambio de contraseña desde la aplicación/,
    ]) {
      expect(screen.queryByText(falso)).not.toBeInTheDocument()
    }
    expect(screen.getByText(/Venta sin conexión/)).toBeInTheDocument()
  })
})
