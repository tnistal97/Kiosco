// src/app/layout.tsx
import './globals.css'
import { headers } from 'next/headers'
import { Toaster } from 'react-hot-toast'
import Navbar from '@/components/Navbar'
import { getSession } from '@/server/auth/session'

export const metadata = {
  title: 'Sistema de Kiosco',
  description: 'Gestión de ventas y stock',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Misma funcion de sesion que usan las APIs: una sola implementacion, que
  // ademas comprueba que el usuario siga activo y que la sesion no haya sido
  // revocada. Antes esto verificaba el JWT por su cuenta con jsonwebtoken y
  // consultaba Prisma directamente, sin ninguna de las dos comprobaciones.
  const cabeceras = await headers()
  const session = await getSession(new Request('http://localhost/', { headers: cabeceras }))

  return (
    <html lang="es">
      <body className="bg-gray-100 text-gray-800">
        <Navbar
          userName={session?.name ?? ''}
          isAdmin={session?.permissions.has('audit.view') ?? false}
        />
        <main className="min-h-screen flex flex-col">{children}</main>
        <Toaster position="top-center" />
      </body>
    </html>
  )
}
