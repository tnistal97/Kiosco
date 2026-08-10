/**
 * Ayudantes de las pruebas de interfaz.
 */

import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { SessionProvider, type SesionCliente } from '@/components/shell/SessionProvider'
import { permissionsForRole } from '@/server/authz/permissions'

/**
 * El administrador, con los permisos QUE DE VERDAD TIENE.
 *
 * Se derivan del catalogo en vez de escribirse a mano: una lista literal se
 * queda vieja en silencio, y la prueba "ve todas las secciones" pasa a
 * comprobar que ve las secciones de hace tres fases. Paso exactamente eso: la
 * lista no tenia ni compras ni proveedores.
 */
export const SESION_ADMIN: SesionCliente = {
  userId: 1,
  name: 'Ana Duarte',
  username: 'admin',
  role: 'admin',
  branchId: 1,
  branchName: 'Almacen Centro',
  timeZone: 'America/Argentina/Buenos_Aires',
  permissions: [...permissionsForRole('admin')],
}

/** Tal como esta en el catalogo: sin `products.update`. */
export const SESION_REPOSITOR: SesionCliente = {
  userId: 2,
  name: 'Tomas Aguirre',
  username: 'repositor',
  role: 'repositor',
  branchId: 1,
  timeZone: 'America/Argentina/Buenos_Aires',
  branchName: 'Almacen Centro',
  permissions: ['products.view', 'stock.view', 'stock.adjust'],
}

/**
 * El rol que edita la ficha pero NO el precio.
 *
 * Es el caso que hace falta para comprobar la separacion de
 * `products.price.update`: el repositor no sirve porque ni siquiera puede
 * editar productos.
 */
export const SESION_COMPRAS: SesionCliente = {
  userId: 4,
  name: 'Delia Moran',
  username: 'compras',
  role: 'compras',
  branchId: 1,
  timeZone: 'America/Argentina/Buenos_Aires',
  branchName: 'Almacen Centro',
  permissions: [
    'products.view',
    'products.create',
    'products.update',
    'categories.manage',
    'stock.view',
    'stock.adjust',
    'suppliers.view',
    'suppliers.manage',
    'reports.view',
  ],
}

export const SESION_CAJERO: SesionCliente = {
  userId: 3,
  name: 'Lucia Bravo',
  username: 'cajero',
  role: 'cajero',
  branchId: 1,
  timeZone: 'America/Argentina/Buenos_Aires',
  branchName: 'Almacen Centro',
  permissions: [
    'sales.create',
    'sales.view',
    'products.view',
    'stock.view',
    'cash.view',
    'cash.count.create',
  ],
}

/** Monta con una sesion de cliente, como hace el armazon de la aplicacion. */
export function renderConSesion(
  ui: ReactElement,
  sesion: SesionCliente | null = SESION_ADMIN,
  opciones?: Omit<RenderOptions, 'wrapper'>,
) {
  function Envoltorio({ children }: { children: ReactNode }) {
    return <SessionProvider session={sesion}>{children}</SessionProvider>
  }
  return render(ui, { wrapper: Envoltorio, ...opciones })
}

/**
 * Simula una rafaga de lector de codigo de barras.
 *
 * Un lector USB escribe entre 5 y 20 ms por caracter y cierra con Enter. Lo
 * que distingue un lector de una persona es exactamente eso, asi que la
 * prueba tiene que reproducir el ritmo, no solo las teclas.
 */
export async function escanear(
  codigo: string,
  opciones: { msPorTecla?: number; destino?: EventTarget } = {},
): Promise<void> {
  const { msPorTecla = 8, destino = document } = opciones

  for (const caracter of codigo) {
    destino.dispatchEvent(
      new KeyboardEvent('keydown', { key: caracter, bubbles: true, cancelable: true }),
    )
    await esperar(msPorTecla)
  }
  destino.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) // prettier-ignore
}

/** Escribe al ritmo de una persona: demasiado lento para ser un lector. */
export async function tipearComoPersona(codigo: string): Promise<void> {
  await escanear(codigo, { msPorTecla: 130 })
}

export function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
