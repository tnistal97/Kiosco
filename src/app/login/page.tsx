// src/app/login/page.tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()

      if (res.ok) {
        toast.success('¡Sesión iniciada!', {
          style: { background: '#38a169', color: '#fff' },
        })
        // full page reload
        setTimeout(() => {
          window.location.href = '/caja'
        }, 800)
      } else {
        toast.error(data.error || 'Credenciales inválidas', {
          style: { background: '#e53e3e', color: '#fff' },
        })
      }

    } catch (err) {
      console.error(err)
      toast.error('Error del servidor', {
        style: { background: '#e53e3e', color: '#fff' },
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-300 dark:from-zinc-900 dark:to-zinc-800 px-4">
      <form
        onSubmit={handleSubmit}
        className="bg-white dark:bg-zinc-900 p-8 sm:p-10 rounded-2xl shadow-xl max-w-md w-full space-y-6 transition"
      >
        <h1 className="text-3xl font-bold text-center text-blue-600 dark:text-blue-400">
          Iniciar sesión
        </h1>

        <div className="space-y-4">
          <input
            type="text"
            placeholder="Usuario"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={isSubmitting}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
            required
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={isSubmitting}
            className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring focus:border-blue-300 dark:bg-zinc-800 dark:border-zinc-700 dark:text-zinc-100"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-medium transition disabled:opacity-70"
        >
          {isSubmitting ? 'Iniciando...' : 'Iniciar sesión'}
        </button>
      </form>
    </div>
  )
}
