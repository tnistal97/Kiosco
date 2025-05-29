'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DashboardPage() {
  const router = useRouter()

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) router.push('/login')
  }, [router])

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <a href="/productos" className="p-4 bg-white rounded shadow hover:bg-gray-50">🛒 Productos</a>
        <a href="/ventas" className="p-4 bg-white rounded shadow hover:bg-gray-50">💵 Ventas</a>
        <a href="/stock" className="p-4 bg-white rounded shadow hover:bg-gray-50">📦 Stock</a>
        <a href="/usuarios" className="p-4 bg-white rounded shadow hover:bg-gray-50">👥 Usuarios</a>
      </div>
    </div>
  )
}
