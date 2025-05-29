'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) router.push('/login')
  }, [router])

  const cards = [
    { href: '/productos', icon: '🛒', label: 'Productos' },
    { href: '/ventas', icon: '💵', label: 'Ventas' },
    { href: '/stock', icon: '📦', label: 'Stock' },
    { href: '/usuarios', icon: '👥', label: 'Usuarios' },
  ]

  return (
    <div className="min-h-screen bg-[color:var(--color-background)] text-[color:var(--color-foreground)] p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-blue-700 dark:text-blue-400">📊 Panel de Control</h1>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-6">
          {cards.map((card) => (
            <a
              key={card.href}
              href={card.href}
              className="group p-6 bg-white dark:bg-zinc-900 rounded-2xl shadow-md hover:shadow-lg hover:ring-2 ring-blue-400 transition-all duration-200 flex flex-col items-center text-center"
            >
              <div className="text-4xl mb-2 group-hover:scale-110 transition-transform">{card.icon}</div>
              <span className="text-lg font-medium text-zinc-700 dark:text-zinc-100 group-hover:text-blue-600">
                {card.label}
              </span>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
