// src/app/login/page.tsx
'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { apiRequest, mensajeDeError } from '@/lib/api-client'

/**
 * Destino despues de iniciar sesion.
 *
 * El middleware agrega `?next=` con la pantalla que el usuario intentaba
 * abrir. Solo se aceptan rutas internas: una que empiece con `//` o que
 * traiga esquema es una URL a otro sitio, y respetarla convertiria el login
 * en una redireccion abierta que sirve para pescar credenciales.
 */
function destinoSeguro(next: string | null): string {
  if (!next) return '/caja'
  if (!next.startsWith('/') || next.startsWith('//')) return '/caja'
  if (next.startsWith('/login')) return '/caja'
  return next
}

/**
 * `useSearchParams` obliga a un limite de Suspense: sin el, el build de Next
 * falla al intentar prerenderizar la pagina.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const searchParams = useSearchParams()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)

    try {
      await apiRequest('/api/auth/login', {
        method: 'POST',
        body: { username, password },
        parse: () => null,
      })

      toast.success('¡Sesión iniciada!', {
        style: { background: '#38a169', color: '#fff' },
      })

      // Recarga completa a proposito: el layout del servidor tiene que
      // volver a leer la sesion para pintar la navegacion.
      const destino = destinoSeguro(searchParams.get('next'))
      setTimeout(() => {
        window.location.href = destino
      }, 800)
    } catch (err) {
      toast.error(mensajeDeError(err, 'Credenciales inválidas'), {
        style: { background: '#e53e3e', color: '#fff' },
      })
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-100 to-blue-300 dark:from-zinc-900 dark:to-zinc-800 px-4">
      <form
        onSubmit={(e) => void handleSubmit(e)}
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
