'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

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
        const res = await fetch('/api/auth/validate', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        })

        if (!res.ok) {
          router.push('/login')
        } else {
          setChecking(false)
        }
      } catch {
        router.push('/login')
      }
    }

    validate()
  }, [pathname, router])

  // Mientras se valida, no renderizamos children (evita parpadeo)
  if (checking) return null

  return <>{children}</>
}
