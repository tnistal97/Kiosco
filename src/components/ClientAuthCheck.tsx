'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { apiRequest } from '@/lib/api-client'
import { parseSesion } from '@/modules/auth/dto'

export default function ClientAuthCheck({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    // Rutas públicas permitidas sin login
    if (pathname === '/' || pathname === '/login') {
      setChecking(false)
      return
    }

    const validate = async () => {
      try {
        const sesion = await apiRequest('/api/auth/validate', {
          method: 'POST',
          parse: parseSesion,
        })
        if (sesion.valid) setChecking(false)
        else router.push('/login')
      } catch {
        router.push('/login')
      }
    }

    void validate()
  }, [pathname, router])

  // Mientras se valida, no renderizamos children (evita parpadeo)
  if (checking) return null

  return <>{children}</>
}
