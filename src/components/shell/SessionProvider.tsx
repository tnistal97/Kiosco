'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Permission } from '@/server/authz/permissions'

/**
 * La sesion, del lado del navegador.
 *
 * Es una COPIA de lo que el servidor ya decidio, para que la interfaz pueda
 * esconder lo que el usuario no puede hacer. No autoriza nada: cada peticion
 * se comprueba de nuevo en el servidor contra la base. Si alguien edita este
 * objeto desde la consola, lo unico que consigue es ver botones que le van a
 * responder 403.
 *
 * Lleva solo lo que la interfaz necesita mostrar. Nada de tokens, nada de
 * hashes, nada de datos de otros usuarios.
 */
export interface SesionCliente {
  userId: number
  name: string
  username: string
  role: string
  branchId: number
  branchName: string
  permissions: string[]
}

interface Valor {
  session: SesionCliente | null
  permisos: ReadonlySet<string>
  puede: (permission: Permission) => boolean
}

const Ctx = createContext<Valor>({
  session: null,
  permisos: new Set(),
  puede: () => false,
})

export function SessionProvider({
  session,
  children,
}: {
  session: SesionCliente | null
  children: ReactNode
}) {
  const valor = useMemo<Valor>(() => {
    const permisos = new Set(session?.permissions ?? [])
    return { session, permisos, puede: (p: Permission) => permisos.has(p) }
  }, [session])

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function useSession(): Valor {
  return useContext(Ctx)
}

/**
 * `true` si la sesion tiene el permiso.
 *
 * Para esconder controles, nunca para decidir si una operacion es valida.
 */
export function usePermiso(permission: Permission): boolean {
  return useContext(Ctx).permisos.has(permission)
}
