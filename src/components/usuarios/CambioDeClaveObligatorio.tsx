'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'
import { apiRequest } from '@/lib/api-client'
import { useCartStore } from '@/store/cart'
import { useSession } from '@/components/shell/SessionProvider'
import { CambiarMiClave } from './CambiarMiClave'

/**
 * Lo unico que se ve con una contrasena temporal.
 *
 * La contrasena la eligio otra persona --quien dio el alta o quien la
 * reseteo--, asi que la conocen dos. Hasta que el empleado elija la suya no
 * hay menu ni pantallas: el servidor contesta PASSWORD_CHANGE_REQUIRED a todo
 * menos al cambio de contrasena, y dibujar la aplicacion solo mostraria
 * errores. Ver `User.mustChangePassword`.
 */
export function CambioDeClaveObligatorio() {
  const router = useRouter()
  const { session, comercio } = useSession()
  const vaciarCarrito = useCartStore((s) => s.clear)
  const [saliendo, setSaliendo] = useState(false)

  function entrar() {
    // `refresh` vuelve a pedir la sesion al servidor, que ya no la marca.
    router.replace('/')
    router.refresh()
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
            <h1 className="text-2xl font-semibold text-ink">Elegí tu contraseña</h1>
            <p className="mt-2 text-sm text-ink-muted">
              {session ? `Hola, ${session.name}. ` : ''}Entraste con una contraseña temporal. Antes
              de empezar, elegí una nueva que sepas solo vos.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-line bg-surface p-6">
          <CambiarMiClave primerIngreso alCambiar={entrar} />
        </div>

        <div className="mt-5 flex justify-center">
          <Button variant="ghost" size="sm" loading={saliendo} onClick={() => void salir()}>
            Salir
          </Button>
        </div>
      </main>
    </div>
  )
}
