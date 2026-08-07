'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import {
  Button,
  DropdownItem,
  DropdownLabel,
  DropdownMenu,
  DropdownSeparator,
  aviso,
} from '@/components/ui'
import { apiRequest, mensajeDeError } from '@/lib/api-client'
import { useCartStore } from '@/store/cart'
import type { SesionCliente } from './SessionProvider'

/** Nombre legible del rol. La base guarda el identificador. */
const ROL_LEGIBLE: Record<string, string> = {
  duenio: 'Dueño',
  admin: 'Administrador',
  encargado: 'Encargado',
  supervisor: 'Supervisor',
  cajero: 'Cajero',
  vendedor: 'Cajero',
  repositor: 'Repositor',
  compras: 'Compras',
  auditor: 'Auditor',
}

export function rolLegible(rol: string): string {
  return ROL_LEGIBLE[rol] ?? rol
}

/**
 * Menu del usuario.
 *
 * Es donde vive "cerrar sesion", que antes era un boton rojo permanente al
 * lado de "Caja": una accion que se usa una vez por turno no puede competir
 * con la que se usa cien veces.
 *
 * Al cerrar sesion se vacia el carrito guardado. Es el requisito explicito de
 * la fase, y ademas evita que el turno siguiente encuentre el ticket a medias
 * del anterior.
 */
export function UserMenu({ session }: { session: SesionCliente }) {
  const router = useRouter()
  const vaciarCarrito = useCartStore((s) => s.clear)
  const [saliendo, setSaliendo] = useState(false)

  async function cerrarSesion() {
    if (saliendo) return
    setSaliendo(true)

    // Se vacia antes de la peticion: si la red falla, el carrito tiene que
    // haber desaparecido igual. Lo que no puede pasar es quedarse con el
    // ticket de otro.
    vaciarCarrito()

    try {
      await apiRequest('/api/auth/logout', { method: 'POST', parse: () => null })
    } catch (error) {
      // La cookie es HttpOnly: solo el servidor puede borrarla. Si el pedido
      // no llego, lo correcto es sacar al usuario igual y que la proxima
      // peticion --que si valida contra la base-- decida.
      aviso.error(mensajeDeError(error, 'No se pudo cerrar la sesión en el servidor.'))
    } finally {
      router.replace('/login')
      router.refresh()
    }
  }

  const iniciales = session.name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase())
    .join('')

  return (
    <DropdownMenu
      trigger={
        <button
          type="button"
          className="flex h-touch items-center gap-2 rounded-md pl-1.5 pr-2.5 text-sm transition-colors hover:bg-raised"
          aria-label={`Cuenta de ${session.name}`}
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-raised text-xs font-semibold text-ink"
          >
            {iniciales || '?'}
          </span>
          <span className="hidden max-w-32 truncate text-ink sm:inline">{session.name}</span>
          <svg
            className="hidden h-4 w-4 text-ink-faint sm:block"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      }
    >
      <DropdownLabel>
        {session.name} · {rolLegible(session.role)}
      </DropdownLabel>
      <DropdownLabel>{session.branchName}</DropdownLabel>
      <DropdownSeparator />
      <DropdownItem href="/configuracion">Configuración</DropdownItem>
      <DropdownSeparator />
      <DropdownItem tone="danger" onClick={() => void cerrarSesion()} disabled={saliendo}>
        Cerrar sesión
      </DropdownItem>
    </DropdownMenu>
  )
}

/** Version reducida para pantallas sin sesion resuelta todavia. */
export function UserMenuSkeleton() {
  return (
    <Button size="sm" variant="ghost" disabled>
      …
    </Button>
  )
}
