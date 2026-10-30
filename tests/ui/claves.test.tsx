/**
 * @vitest-environment jsdom
 *
 * Contrasenas y Configuracion, del lado de la pantalla (P0-A).
 *
 * El servidor es el que decide --eso lo prueba
 * `tests/integration/users-password.test.ts`--. Aca se prueba lo que ve y
 * manda la interfaz: que no se pueda mandar un formulario que el servidor va
 * a rechazar, y que Configuracion no diga cosas falsas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { SessionProvider } from '@/components/shell/SessionProvider'
import { CambiarMiClave } from '@/components/usuarios/CambiarMiClave'
import { CambioDeClaveObligatorio } from '@/components/usuarios/CambioDeClaveObligatorio'
import { ResetearClave } from '@/components/usuarios/ResetearClave'
import ConfiguracionPage from '@/app/configuracion/page'
import type { UsuarioDTO } from '@/modules/users/dto'
import { SESION_ADMIN } from './helpers'

const peticion = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', async () => {
  const real = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client')
  return { ...real, apiRequest: peticion }
})

const navegar = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: navegar, refresh: vi.fn() }),
}))

beforeEach(() => {
  peticion.mockReset()
  peticion.mockResolvedValue(null)
  navegar.mockReset()
})

const LUCIA: UsuarioDTO = {
  id: 7,
  username: 'lucia',
  name: 'Lucia Bravo',
  isActive: true,
  mustChangePassword: false,
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
  it('pide la temporal dos veces, con el largo minimo, y la manda', async () => {
    peticion.mockResolvedValueOnce(null)
    const u = userEvent.setup()
    const onCerrar = vi.fn()
    render(<ResetearClave usuario={LUCIA} onCerrar={onCerrar} />)
    await screen.findByRole('dialog')

    const restablecer = screen.getByRole('button', { name: 'Restablecer' })
    expect(restablecer).toBeDisabled()

    await u.type(screen.getByLabelText(/^Nueva contraseña temporal/), 'corta')
    await u.type(screen.getByLabelText(/^Repetir contraseña/), 'corta')
    expect(restablecer).toBeDisabled()

    await u.clear(screen.getByLabelText(/^Nueva contraseña temporal/))
    await u.clear(screen.getByLabelText(/^Repetir contraseña/))
    await u.type(screen.getByLabelText(/^Nueva contraseña temporal/), 'temporal1')
    await u.type(screen.getByLabelText(/^Repetir contraseña/), 'temporal2')
    expect(restablecer).toBeDisabled()
    expect(screen.getByText('No coincide con la anterior.')).toBeInTheDocument()

    await u.clear(screen.getByLabelText(/^Repetir contraseña/))
    await u.type(screen.getByLabelText(/^Repetir contraseña/), 'temporal1')
    expect(restablecer).toBeEnabled()
    await u.click(restablecer)

    await waitFor(() => {
      expect(onCerrar).toHaveBeenCalled()
    })
    const [ruta, opciones] = peticion.mock.calls[0] as [string, { body: unknown }]
    expect(ruta).toBe('/api/users/7/password')
    expect(opciones.body).toEqual({ claveNueva: 'temporal1', claveConfirmacion: 'temporal1' })
  })

  it('si el servidor rechaza, lo muestra y no cierra', async () => {
    peticion.mockRejectedValueOnce(new Error('No se pudo'))
    const u = userEvent.setup()
    const onCerrar = vi.fn()
    render(<ResetearClave usuario={LUCIA} onCerrar={onCerrar} />)
    await screen.findByRole('dialog')

    await u.type(screen.getByLabelText(/^Nueva contraseña temporal/), 'temporal1')
    await u.type(screen.getByLabelText(/^Repetir contraseña/), 'temporal1')
    await u.click(screen.getByRole('button', { name: 'Restablecer' }))

    expect(await screen.findByText('No se restableció')).toBeInTheDocument()
    expect(onCerrar).not.toHaveBeenCalled()
  })
})

describe('Cambio obligatorio de la contrasena temporal', () => {
  function dibujar() {
    render(
      <SessionProvider session={{ ...SESION_ADMIN, debeCambiarClave: true }} comercio="House">
        <CambioDeClaveObligatorio />
      </SessionProvider>,
    )
    return userEvent.setup()
  }

  it('son dos campos y un boton: no pide la temporal otra vez', () => {
    dibujar()
    expect(screen.getByRole('heading', { name: 'Cambiá tu contraseña' })).toBeInTheDocument()
    expect(screen.getByLabelText(/^Nueva contraseña/)).toBeInTheDocument()
    expect(screen.getByLabelText(/^Repetir contraseña/)).toBeInTheDocument()
    expect(screen.queryByLabelText(/temporal/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar contraseña' })).toBeDisabled()
  })

  it('no se habilita con una corta ni si no coinciden, y avisa', async () => {
    const u = dibujar()
    const guardar = screen.getByRole('button', { name: 'Guardar contraseña' })

    await u.type(screen.getByLabelText(/^Nueva contraseña/), 'corta')
    await u.type(screen.getByLabelText(/^Repetir contraseña/), 'corta')
    expect(guardar).toBeDisabled()

    await u.clear(screen.getByLabelText(/^Nueva contraseña/))
    await u.clear(screen.getByLabelText(/^Repetir contraseña/))
    await u.type(screen.getByLabelText(/^Nueva contraseña/), 'mi-clave-propia')
    await u.type(screen.getByLabelText(/^Repetir contraseña/), 'mi-clave-distinta')
    expect(guardar).toBeDisabled()
    expect(screen.getByText('No coincide con la anterior.')).toBeInTheDocument()
  })

  it('al guardar manda las dos y entra al sistema', async () => {
    const u = dibujar()
    await u.type(screen.getByLabelText(/^Nueva contraseña/), 'mi-clave-propia')
    await u.type(screen.getByLabelText(/^Repetir contraseña/), 'mi-clave-propia')
    await u.click(screen.getByRole('button', { name: 'Guardar contraseña' }))

    await waitFor(() => {
      expect(navegar).toHaveBeenCalledWith('/')
    })
    const [ruta, opciones] = peticion.mock.calls[0] as [string, { body: unknown }]
    expect(ruta).toBe('/api/auth/password/temporal')
    expect(opciones.body).toEqual({
      claveNueva: 'mi-clave-propia',
      claveConfirmacion: 'mi-clave-propia',
    })
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
    // V5: sin nombres de variables de entorno en pantalla: quien atiende no
    // sabe que es eso. Se dice quien lo configura.
    expect(screen.queryByText(/COMMERCE_NAME/)).not.toBeInTheDocument()
    expect(screen.getByText(/los configura quien instaló el sistema/)).toBeInTheDocument()
  })

  it('tiene donde cambiar la contrasena propia', () => {
    render(<ConfiguracionPage />, { wrapper: conComercio })
    expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeInTheDocument()
  })

  it('no nombra como faltante lo que ya existe, ni muestra codigos de permisos', () => {
    render(<ConfiguracionPage />, { wrapper: conComercio })
    for (const falso of [
      /Turnos de caja con apertura y cierre/,
      /Compras, proveedores y clientes/,
      /Cambio de contraseña desde la aplicación/,
      /sales\.create/,
    ]) {
      expect(screen.queryByText(falso)).not.toBeInTheDocument()
    }
  })
})
