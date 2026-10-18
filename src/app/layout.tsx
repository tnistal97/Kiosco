import './globals.css'
import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/server/auth/session'
import { nombreDelComercio } from '@/server/comercio'
import { funcionesHabilitadas, permisosVisibles } from '@/lib/funciones'
import { ZONA_POR_DEFECTO } from '@/lib/tiempo'
import { AppShell } from '@/components/shell/AppShell'
import { SessionProvider, type SesionCliente } from '@/components/shell/SessionProvider'
import { SCRIPT_TEMA } from '@/components/shell/ThemeToggle'
import { ToastViewport } from '@/components/ui'

/**
 * El titulo es el nombre del comercio, leido al atender y no al construir.
 * El layout ya es dinamico --lee la cookie de sesion en cada peticion--, asi
 * que esto se evalua por peticion. Ver `@/server/comercio`.
 */
export function generateMetadata(): Metadata {
  const nombre = nombreDelComercio()
  return {
    title: nombre,
    description: 'Punto de venta, caja y stock',
    manifest: '/manifest.json',
    appleWebApp: { capable: true, title: nombre, statusBarStyle: 'default' },
  }
}

export const viewport: Viewport = {
  // `viewport-fit=cover` mas `h-dvh` es lo que hace que la caja llegue al
  // borde en un telefono con notch sin dejar una franja muerta.
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4f5f7',
}

/**
 * Datos de sesion que baja al navegador.
 *
 * Solo lo que la interfaz necesita para decidir que mostrar. La autorizacion
 * real la sigue haciendo el servidor en cada peticion; esto solo evita
 * dibujar botones que van a responder 403.
 */
async function sesionParaElCliente(): Promise<SesionCliente | null> {
  const cabeceras = await headers()
  const session = await getSession(new Request('http://localhost/', { headers: cabeceras }))
  if (!session) return null

  const sucursal = await prisma.branch.findUnique({
    where: { id: session.branchId },
    select: { name: true, timeZone: true },
  })

  return {
    userId: session.userId,
    name: session.name,
    username: session.username,
    role: session.role,
    branchId: session.branchId,
    branchName: sucursal?.name ?? 'Sucursal',
    // La zona del LOCAL viaja con la sesion para que ninguna pantalla tenga
    // que suponer que el dispositivo esta en el mismo huso que el comercio.
    // Ver docs/TIMEZONE_POLICY.md.
    timeZone: sucursal?.timeZone ?? ZONA_POR_DEFECTO,
    // Sin los permisos de las funciones que esta instalacion no usa (lotes,
    // compras): asi cada pantalla esconde lo suyo sola. El servidor sigue
    // autorizando con los permisos reales. Ver `@/lib/funciones`.
    permissions: permisosVisibles(session.permissions, funcionesHabilitadas()),
  }
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await sesionParaElCliente()

  return (
    <html lang="es">
      <head>
        {/* Antes de pintar, para que el tema claro no arranque con un
            fogonazo oscuro. */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      <body>
        {/* Primer elemento enfocable de la pagina: saltea la navegacion. */}
        <a
          href="#contenido"
          className="sr-only-focusable absolute left-3 top-3 z-100 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-ink-on-solid"
        >
          Saltar al contenido
        </a>

        <SessionProvider
          session={session}
          comercio={nombreDelComercio()}
          funciones={funcionesHabilitadas()}
        >
          <AppShell>{children}</AppShell>
        </SessionProvider>

        <ToastViewport />
      </body>
    </html>
  )
}
