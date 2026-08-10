'use client'

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { Permission } from '@/server/authz/permissions'
import { ZONA_POR_DEFECTO, hoyEn, type FechaLocal } from '@/lib/tiempo'

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
  /**
   * La zona horaria DEL LOCAL, en formato IANA.
   *
   * Baja del servidor para que el navegador sepa donde empieza el dia sin
   * tener que suponer que el dispositivo esta en el mismo huso que el
   * comercio. Ver docs/TIMEZONE_POLICY.md.
   */
  timeZone: string
  permissions: string[]
}

interface Valor {
  session: SesionCliente | null
  permisos: ReadonlySet<string>
  puede: (permission: Permission) => boolean
  /**
   * Que dia es hoy EN EL LOCAL, como `AAAA-MM-DD`.
   *
   * Es lo que hay que mandarle a la API cuando se pide "hoy". Hasta la Fase 3D
   * cada pantalla lo armaba con `new Date()` del dispositivo, que es correcto
   * solo si el dispositivo esta en el huso del comercio.
   *
   * Queda un riesgo que ninguna correccion del lado del cliente puede cubrir:
   * un dispositivo con la FECHA mal puesta. Contra eso protege el servidor, que
   * es el que interpreta el rango y el unico que decide.
   */
  hoy: () => FechaLocal
}

const Ctx = createContext<Valor>({
  session: null,
  permisos: new Set(),
  puede: () => false,
  hoy: () => hoyEn(ZONA_POR_DEFECTO),
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
    const zona = session?.timeZone ?? ZONA_POR_DEFECTO
    return {
      session,
      permisos,
      puede: (p: Permission) => permisos.has(p),
      hoy: () => hoyEn(zona),
    }
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
