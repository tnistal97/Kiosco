import './globals.css'

export const metadata = {
  title: 'Sistema de Kiosco',
  description: 'Gestión de ventas y stock',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-gray-100 text-gray-800">
        <main className="min-h-screen flex flex-col">{children}</main>
      </body>
    </html>
  )
}
