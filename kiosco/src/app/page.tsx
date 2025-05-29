'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function Home() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    const validate = async () => {
      const token = localStorage.getItem('token')
      if (!token) {
        setChecking(false)
        return
      }

      const res = await fetch('/api/auth/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })

      if (res.ok) {
        router.push('/dashboard')
      } else {
        localStorage.removeItem('token')
        setChecking(false)
      }
    }

    validate()
  }, [router])

  if (checking) {
    return (
      <div className="flex items-center justify-center h-screen bg-[color:var(--color-background)] text-[color:var(--color-foreground)]">
        <p className="text-xl font-medium animate-pulse">Verificando sesión...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-300 dark:from-zinc-900 dark:to-zinc-800 px-4">
      <div className="bg-white dark:bg-zinc-900 text-zinc-800 dark:text-zinc-100 p-8 sm:p-10 rounded-2xl shadow-xl max-w-md w-full space-y-6 transition">
        <div className="space-y-2 text-center">
          <h1 className="text-4xl font-bold text-blue-700 dark:text-blue-400">🧃 KioscoApp</h1>
          <p className="text-zinc-600 dark:text-zinc-400 text-sm">
            Controlá productos, ventas y stock con una app simple, rápida y elegante.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.push('/login')}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition"
          >
            Iniciar sesión
          </button>
          <button
            onClick={() => alert('Contacto: soporte@kioscoapp.com')}
            className="text-sm text-zinc-500 hover:text-blue-600 transition"
          >
            ¿Necesitás ayuda?
          </button>
        </div>
      </div>
    </div>
  )
}
  