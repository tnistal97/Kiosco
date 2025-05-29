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

  if (checking) return <div className="flex items-center justify-center h-screen">Verificando sesión...</div>

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-blue-50 to-blue-100">
      <div className="bg-white p-10 rounded-lg shadow-md text-center w-full max-w-md">
        <h1 className="text-3xl font-bold mb-4 text-blue-700">Sistema de Kiosco</h1>
        <p className="text-gray-600 mb-6">
          Controlá tus productos, ventas y stock de manera simple y rápida.
        </p>
        <button
          onClick={() => router.push('/login')}
          className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
        >
          Iniciar sesión
        </button>
      </div>
    </div>
  )
}
