'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Alert, Button, Field, Input } from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { PASSWORD_MIN } from '@/modules/users/schemas'
import { useCartStore } from '@/store/cart'
import { useSession } from '@/components/shell/SessionProvider'

/**
 * Lo unico que se ve con una contrasena temporal.
 *
 * La contrasena la eligio otra persona --quien dio el alta o quien la
 * reseteo--, asi que la conocen dos. Hasta que el empleado elija la suya no
 * hay menu ni pantallas: el servidor contesta PASSWORD_CHANGE_REQUIRED a todo
 * menos a esto, y dibujar la aplicacion solo mostraria errores. Ver
 * `User.mustChangePassword`.
 *
 * Son dos campos y un boton a proposito: quien llega aca recien empieza. No
 * pide la temporal porque la acaba de escribir (`elegirClaveDefinitiva`).
 */
export function CambioDeClaveObligatorio() {
  const router = useRouter()
  const { session, comercio } = useSession()
  const vaciarCarrito = useCartStore((s) => s.clear)
  const [nueva, setNueva] = useState('')
  const [repetida, setRepetida] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saliendo, setSaliendo] = useState(false)

  const noCoincide = repetida.length > 0 && nueva !== repetida
  const valido = nueva.length >= PASSWORD_MIN && nueva === repetida

  async function guardar(e: FormEvent) {
    e.preventDefault()
    if (enviando || !valido) return
    setEnviando(true)
    setError(null)
    try {
      await apiRequest('/api/auth/password/temporal', {
        method: 'POST',
        body: { claveNueva: nueva, claveConfirmacion: repetida },
        parse: () => null,
      })
      // `refresh` vuelve a pedir la sesion al servidor, que ya no la marca.
      router.replace('/')
      router.refresh()
    } catch (err) {
      setError(mensajeDeError(err, 'No se pudo guardar la contraseña.'))
      setEnviando(false)
    }
  }

  async function salir() {
    if (saliendo) return
    setSaliendo(true)
    vaciarCarrito()
    try {
      await apiRequest('/api/auth/logout', { method: 'POST', parse: () => null })
    } catch {
      // La proxima peticion, que valida contra la base, decide igual.
    } finally {
      router.replace('/login')
      router.refresh()
    }
  }

  const sucursal = session?.branchName ?? comercio

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center bg-bg px-4 py-10"
      data-cambio-de-clave-obligatorio
    >
      <main className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-ink-on-solid"
          >
            {sucursal.trim().charAt(0).toUpperCase()}
          </span>
          <div>
            <h1 className="text-2xl font-semibold text-ink">Cambiá tu contraseña</h1>
            <p className="mt-2 text-sm text-ink-muted">
              {session ? `Hola, ${session.name}. ` : ''}Elegí una que sepas solo vos.
            </p>
          </div>
        </div>

        <form
          className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-6"
          onSubmit={(e) => void guardar(e)}
          noValidate
        >
          {error && (
            <Alert tone="danger" title="No se guardó">
              {error}
            </Alert>
          )}

          <Field
            label="Nueva contraseña"
            required
            hint={`Al menos ${String(PASSWORD_MIN)} caracteres.`}
          >
            <Input
              type="password"
              name="claveNueva"
              autoComplete="new-password"
              value={nueva}
              disabled={enviando}
              onChange={(e) => {
                setNueva(e.target.value)
              }}
            />
          </Field>

          <Field
            label="Repetir contraseña"
            required
            error={noCoincide ? 'No coincide con la anterior.' : null}
          >
            <Input
              type="password"
              name="claveConfirmacion"
              autoComplete="new-password"
              value={repetida}
              disabled={enviando}
              onChange={(e) => {
                setRepetida(e.target.value)
              }}
            />
          </Field>

          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={enviando}
            disabled={!valido}
          >
            Guardar contraseña
          </Button>
        </form>

        <div className="mt-5 flex justify-center">
          <Button variant="ghost" size="sm" loading={saliendo} onClick={() => void salir()}>
            Salir
          </Button>
        </div>
      </main>
    </div>
  )
}
