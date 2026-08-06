// src/components/Navbar.tsx
'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  UserCircleIcon,
  ArrowRightOnRectangleIcon,
  ChartBarIcon,
  CurrencyDollarIcon,
  ShoppingBagIcon,
  ArchiveBoxIcon,
  BanknotesIcon,
} from '@heroicons/react/24/solid'
import CashControlModal from '@/components/CashControlModal'

interface NavbarProps {
  userName: string
  isAdmin: boolean
}

export default function Navbar({ userName, isAdmin }: NavbarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [isCashModalOpen, setCashModalOpen] = useState(false)

  // Don't show when on login page
  if (pathname === '/login') return null

  const handleLogout = async () => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    })
    router.replace('/login')
  }

  const baseLinks = [
    { href: '/caja',      label: 'Caja',       icon: CurrencyDollarIcon },
    { href: '/productos', label: 'Productos',  icon: ShoppingBagIcon    },
    { href: '/ventas',    label: 'Ventas',     icon: ArchiveBoxIcon     },
  ]

  const adminLinks = isAdmin
    ? [
        { href: '/admin/auditoria', label: 'Auditoría', icon: ChartBarIcon },
        { href: '/admin/sales',     label: 'Reporte',   icon: ChartBarIcon },
      ]
    : []

  const links = [...baseLinks, ...adminLinks]

  return (
    <>
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shadow sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo + Usuario */}
          <div className="flex items-center gap-6">
            <Link
              href="/"
              className="text-2xl font-bold text-blue-600 dark:text-blue-400 hover:opacity-80 transition"
            >
              🧃 KioscoApp
            </Link>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 dark:bg-blue-800 text-blue-800 dark:text-blue-100 text-sm font-medium shadow-inner">
              <UserCircleIcon className="w-5 h-5 flex-shrink-0" />
              <span className="truncate max-w-[120px]">{userName}</span>
            </div>
          </div>

          {/* Navegación */}
          <ul className="flex items-center space-x-4">
            {links.map(({ href, label, icon: Icon }) => {
              const isActive = pathname === href
              return (
                <li key={href}>
                  <Link
                    href={href}
                    className={`flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium transition ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {label}
                  </Link>
                </li>
              )
            })}

            {/* Turno / Cierre de caja */}
            <li>
              <button
                onClick={() => setCashModalOpen(true)}
                className="flex items-center gap-1 px-3 py-2 rounded-md text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
              >
                <BanknotesIcon className="w-4 h-4" />
                Cierre Caja
              </button>
            </li>
          </ul>

          {/* Logout */}
          <button
            onClick={handleLogout}
            className="flex items-center gap-1 px-3 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition"
          >
            <ArrowRightOnRectangleIcon className="w-5 h-5" />
            <span className="hidden sm:inline">Cerrar sesión</span>
          </button>
        </div>
      </nav>

      {/* Modal de control de caja */}
      <CashControlModal
        isOpen={isCashModalOpen}
        onClose={() => setCashModalOpen(false)}
      />
    </>
  )
}
