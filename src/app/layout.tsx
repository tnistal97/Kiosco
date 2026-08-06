// src/app/layout.tsx
import './globals.css'
import { Toaster } from 'react-hot-toast'
import Navbar from '@/components/Navbar'
import { cookies } from 'next/headers'
import jwt from 'jsonwebtoken'
import { prisma } from '@/lib/prisma'

export const metadata = {
  title: 'Sistema de Kiosco',
  description: 'Gestión de ventas y stock',
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  let userName = ''
  let isAdmin = false

  try {
    const cookieStore = await cookies()
    const token = cookieStore.get('token')?.value
    if (token) {
      const { userId } = jwt.verify(token, process.env.JWT_SECRET!) as { userId: number }
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          role: { select: { name: true } },
        },
      })
      if (user) {
        userName = user.name
        isAdmin = user.role.name === 'admin'
      }
    }
  } catch (err) {
    console.error('Error decoding token in layout:', err)
    // no further action: middleware already redirected invalid tokens
  }

  return (
    <html lang="es">
      <body className="bg-gray-100 text-gray-800">
        <Navbar userName={userName} isAdmin={isAdmin} />
        <main className="min-h-screen flex flex-col">{children}</main>
        <Toaster position="top-center" />
      </body>
    </html>
  )
}
